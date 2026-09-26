//! Pub/Sub subscribe loop, publish helper, and subscription registry.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use redis::aio::ConnectionLike;
use redis::AsyncCommands;
use serde::Serialize;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::connect::{open_pubsub_connection, ConnectionPlan};
use crate::driver::RedisDriver;

#[allow(dead_code)] // event name reserved for the Redis plugin Pub/Sub sink
pub const EVENT_NAME: &str = "redis-pubsub-message";

pub type PubSubEmitter = std::sync::Arc<dyn Fn(RedisPubSubMessageEvent) + Send + Sync>;

static PUBSUB_EMITTER: OnceLock<PubSubEmitter> = OnceLock::new();

/// Install the frontend event sink. Called once from the Redis plugin setup hook.
#[allow(dead_code)]
pub fn set_pubsub_emitter(emitter: PubSubEmitter) {
    let _ = PUBSUB_EMITTER.set(emitter);
}

fn emit_pubsub_message(event: RedisPubSubMessageEvent) {
    if let Some(emitter) = PUBSUB_EMITTER.get() {
        emitter(event);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisPubSubMessageEvent {
    pub connection_id: String,
    pub subscription_id: String,
    pub channel: String,
    pub payload: String,
    pub ts: u64,
}

/// Serializable info about an active subscription, returned to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionInfo {
    pub subscription_id: String,
    pub channels: Vec<String>,
    pub patterns: Vec<String>,
}

/// Aggregated Pub/Sub message statistics for a connection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PubSubStats {
    pub total_messages: u64,
    pub by_channel: HashMap<String, u64>,
}

struct SubscriptionEntry {
    #[allow(dead_code)]
    connection_id: String,
    channels: Vec<String>,
    patterns: Vec<String>,
    handle: JoinHandle<()>,
}

struct SubscriptionRegistry {
    subs: HashMap<String, SubscriptionEntry>,
    /// Per-connection message counters: connection_id -> (total, by_channel)
    stats: HashMap<String, (u64, HashMap<String, u64>)>,
}

static REGISTRY: OnceLock<Mutex<SubscriptionRegistry>> = OnceLock::new();

fn registry() -> &'static Mutex<SubscriptionRegistry> {
    REGISTRY.get_or_init(|| {
        Mutex::new(SubscriptionRegistry {
            subs: HashMap::new(),
            stats: HashMap::new(),
        })
    })
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Validate subscribe arguments (channels and/or patterns required; no empty names).
pub fn validate_subscribe_args(channels: &[String], patterns: &[String]) -> Result<(), String> {
    let ch: Vec<&str> = channels
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    let pat: Vec<&str> = patterns
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if ch.is_empty() && pat.is_empty() {
        return Err("at least one channel or pattern is required".into());
    }
    Ok(())
}

fn normalize_names(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn message_payload(msg: &redis::Msg) -> String {
    msg.get_payload::<String>()
        .or_else(|_| {
            msg.get_payload::<Vec<u8>>()
                .map(|b| String::from_utf8_lossy(&b).into_owned())
        })
        .unwrap_or_default()
}

pub async fn publish<C>(conn: &mut C, channel: &str, message: &str) -> Result<u64, String>
where
    C: AsyncCommands + ConnectionLike + Send,
{
    let channel = channel.trim();
    if channel.is_empty() {
        return Err("channel is required".into());
    }
    conn.publish(channel, message)
        .await
        .map_err(|e| e.to_string())
}

async fn remove_subscription(subscription_id: &str) {
    let mut reg = registry().lock().await;
    reg.subs.remove(subscription_id);
}

pub async fn unsubscribe(subscription_id: &str) -> Result<(), String> {
    let mut reg = registry().lock().await;
    let entry = reg
        .subs
        .remove(subscription_id)
        .ok_or_else(|| format!("subscription not found: {subscription_id}"))?;
    entry.handle.abort();
    Ok(())
}

pub async fn start_subscription(
    driver: &RedisDriver,
    connection_id: String,
    channels: Vec<String>,
    patterns: Vec<String>,
) -> Result<String, String> {
    validate_subscribe_args(&channels, &patterns)?;

    let plan = driver
        .connection_plan(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    let channels = normalize_names(&channels);
    let patterns = normalize_names(&patterns);
    if channels.is_empty() && patterns.is_empty() {
        return Err("at least one channel or pattern is required".into());
    }

    let subscription_id = uuid::Uuid::new_v4().to_string();
    let sub_id_for_task = subscription_id.clone();
    let conn_id_for_task = connection_id.clone();
    let sub_id_log = sub_id_for_task.clone();

    let channels_for_loop = channels.clone();
    let patterns_for_loop = patterns.clone();
    let conn_id_for_stats = connection_id.clone();
    let handle = tokio::spawn(async move {
        let result = run_subscribe_loop(
            &plan,
            &channels_for_loop,
            &patterns_for_loop,
            move |channel, payload| {
                // Increment per-connection stats
                {
                    // Stats are updated synchronously via blocking task
                    let channel_clone = channel.clone();
                    let conn_clone = conn_id_for_stats.clone();
                    tokio::spawn(async move {
                        let mut reg = registry().lock().await;
                        let entry = reg
                            .stats
                            .entry(conn_clone)
                            .or_insert_with(|| (0, HashMap::new()));
                        entry.0 += 1;
                        *entry.1.entry(channel_clone).or_insert(0) += 1;
                    });
                }
                emit_pubsub_message(RedisPubSubMessageEvent {
                    connection_id: conn_id_for_task.clone(),
                    subscription_id: sub_id_for_task.clone(),
                    channel,
                    payload,
                    ts: now_millis(),
                });
            },
        )
        .await;
        if let Err(e) = result {
            tracing::warn!(
                subscription_id = %sub_id_log,
                error = %e,
                "redis pubsub subscription ended with error"
            );
        }
        remove_subscription(&sub_id_log).await;
    });

    let mut reg = registry().lock().await;
    reg.subs.insert(
        subscription_id.clone(),
        SubscriptionEntry {
            connection_id,
            channels,
            patterns,
            handle,
        },
    );

    Ok(subscription_id)
}

/// List all active subscriptions for a given connection.
pub async fn list_active_subscriptions(connection_id: &str) -> Vec<SubscriptionInfo> {
    let reg = registry().lock().await;
    reg.subs
        .iter()
        .filter(|(_, e)| e.connection_id == connection_id)
        .map(|(id, e)| SubscriptionInfo {
            subscription_id: id.clone(),
            channels: e.channels.clone(),
            patterns: e.patterns.clone(),
        })
        .collect()
}

/// Get aggregated message statistics for a given connection.
pub async fn pubsub_stats(connection_id: &str) -> PubSubStats {
    let reg = registry().lock().await;
    match reg.stats.get(connection_id) {
        Some((total, by_channel)) => PubSubStats {
            total_messages: *total,
            by_channel: by_channel.clone(),
        },
        None => PubSubStats {
            total_messages: 0,
            by_channel: HashMap::new(),
        },
    }
}

async fn run_subscribe_loop<F>(
    plan: &ConnectionPlan,
    channels: &[String],
    patterns: &[String],
    mut on_message: F,
) -> Result<(), String>
where
    F: FnMut(String, String) + Send,
{
    let mut pubsub = open_pubsub_connection(plan)
        .await
        .map_err(|e| e.to_string())?;

    for ch in channels {
        pubsub
            .subscribe(ch)
            .await
            .map_err(|e| format!("SUBSCRIBE {ch}: {e}"))?;
    }
    for pat in patterns {
        pubsub
            .psubscribe(pat)
            .await
            .map_err(|e| format!("PSUBSCRIBE {pat}: {e}"))?;
    }

    let mut stream = pubsub.on_message();
    while let Some(msg) = stream.next().await {
        let channel = msg.get_channel_name().to_string();
        let payload = message_payload(&msg);
        on_message(channel, payload);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_subscribe_requires_channels_or_patterns() {
        assert!(validate_subscribe_args(&[], &[]).is_err());
        assert!(validate_subscribe_args(&["  ".into()], &[]).is_err());
    }

    #[test]
    fn validate_subscribe_accepts_channels() {
        assert!(validate_subscribe_args(&["news".into()], &[]).is_ok());
    }

    #[test]
    fn validate_subscribe_accepts_patterns() {
        assert!(validate_subscribe_args(&[], &["news.*".into()]).is_ok());
    }

    #[test]
    fn validate_subscribe_ignores_blank_entries() {
        assert!(validate_subscribe_args(&["  ".into(), "a".into()], &[]).is_ok());
    }

    #[tokio::test]
    async fn unsubscribe_unknown_id_returns_error() {
        let err = unsubscribe("nonexistent-subscription-id")
            .await
            .unwrap_err();
        assert!(err.contains("subscription not found"));
    }

    #[tokio::test]
    async fn list_active_subscriptions_empty_for_unknown_connection() {
        let subs = list_active_subscriptions("nonexistent-connection-id").await;
        assert!(subs.is_empty());
    }

    #[tokio::test]
    async fn pubsub_stats_returns_zero_for_unknown_connection() {
        let stats = pubsub_stats("nonexistent-connection-id").await;
        assert_eq!(stats.total_messages, 0);
        assert!(stats.by_channel.is_empty());
    }
}
