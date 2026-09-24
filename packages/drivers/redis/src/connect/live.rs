//! Plan building and the live-connection openers for the three topologies (pub/sub included).

use super::cluster::open_cluster_conn_with_fallback;
use super::parse::non_empty;
use super::parse::opt_string;
use super::parse::parse_db_index;
use super::parse::parse_node_urls;
use super::parse::parse_sentinel_urls;
use super::parse::parse_tls;
use super::parse::parse_topology;
use super::plan::ClusterPlan;
use super::plan::ConnectionPlan;
use super::plan::RedisLiveConn;
use super::plan::SentinelPlan;
use super::plan::StandalonePlan;
use super::plan::TlsPlan;
use super::plan::Topology;
use super::sentinel::open_sentinel_conn;
use super::sentinel::open_sentinel_pubsub;
use super::sentinel::plaintext_sentinel_plan;
use super::sentinel::plaintext_url;
use super::standalone::open_standalone_conn_with_fallback;
use super::standalone::open_standalone_pubsub;
use super::standalone::open_standalone_pubsub_with_fallback;
use super::standalone::PREFER_TLS_PROBE;
use super::tls::build_node_url;
use datazen_driver_api::{ConnectionConfig, DriverError};
use std::time::Duration;

pub fn build_connection_plan(config: &ConnectionConfig) -> Result<ConnectionPlan, DriverError> {
    let opts = config.options.as_ref();
    let topology = parse_topology(opts);
    let tls = parse_tls(opts, &config.ssl_mode);
    let connect_timeout = Duration::from_secs(config.connection_timeout.max(1) as u64);

    match topology {
        Topology::Standalone => {
            let host = config.host.as_deref().unwrap_or("127.0.0.1");
            let port = config.port.unwrap_or(6379);
            let db_index = parse_db_index(config.database.as_deref())?;
            let url = build_node_url(&tls, host, port, None, None, Some(db_index));
            Ok(ConnectionPlan::Standalone(StandalonePlan {
                url,
                username: non_empty(config.username.as_deref()),
                password: non_empty(config.password.as_deref()),
                tls,
                db_index,
                connect_timeout,
            }))
        }
        Topology::Cluster => {
            let node_urls = parse_node_urls(opts, config, &tls, None)?;
            if node_urls.is_empty() {
                return Err(DriverError::InvalidConfig(
                    "cluster topology requires at least one cluster node".into(),
                ));
            }
            Ok(ConnectionPlan::Cluster(ClusterPlan {
                node_urls,
                username: non_empty(config.username.as_deref()),
                password: non_empty(config.password.as_deref()),
                tls,
                connect_timeout,
            }))
        }
        Topology::Sentinel => {
            let master_name = opt_string(opts, "sentinelMasterName").ok_or_else(|| {
                DriverError::InvalidConfig("sentinel topology requires sentinelMasterName".into())
            })?;
            let sentinel_password = opt_string(opts, "sentinelNodePassword");
            let sentinel_urls =
                parse_sentinel_urls(opts, config, &tls, sentinel_password.as_deref())?;
            if sentinel_urls.is_empty() {
                return Err(DriverError::InvalidConfig(
                    "sentinel topology requires at least one sentinel node".into(),
                ));
            }
            Ok(ConnectionPlan::Sentinel(SentinelPlan {
                sentinel_urls,
                master_name,
                sentinel_password,
                username: non_empty(config.username.as_deref()),
                password: non_empty(config.password.as_deref()),
                tls,
                db_index: parse_db_index(config.database.as_deref())?,
                connect_timeout,
            }))
        }
    }
}

/// Open a dedicated Pub/Sub connection for SUBSCRIBE / PSUBSCRIBE.
///
/// Cluster topology uses the first seed node as a standalone client (Pub/Sub is
/// node-local on Cluster).
pub async fn open_pubsub_connection(
    plan: &ConnectionPlan,
) -> Result<redis::aio::PubSub, DriverError> {
    match plan {
        ConnectionPlan::Standalone(p) => {
            open_standalone_pubsub_with_fallback(
                &p.url,
                &p.tls,
                p.username.as_deref(),
                p.password.as_deref(),
                p.connect_timeout,
            )
            .await
        }
        ConnectionPlan::Cluster(p) => {
            let url = p.node_urls.first().ok_or_else(|| {
                DriverError::InvalidConfig(
                    "cluster topology requires at least one cluster node".into(),
                )
            })?;
            let tls_timeout = if p.tls.prefer_fallback {
                p.connect_timeout.min(PREFER_TLS_PROBE)
            } else {
                p.connect_timeout
            };
            let mut attempt = open_standalone_pubsub(
                url,
                &p.tls,
                p.username.as_deref(),
                p.password.as_deref(),
                tls_timeout,
            )
            .await;
            if matches!(attempt, Err(DriverError::ConnectionFailed(_))) && p.tls.prefer_fallback {
                attempt = open_standalone_pubsub(
                    &plaintext_url(url),
                    &TlsPlan::plaintext(),
                    p.username.as_deref(),
                    p.password.as_deref(),
                    p.connect_timeout,
                )
                .await;
            }
            attempt
        }
        ConnectionPlan::Sentinel(p) => {
            let mut attempt = open_sentinel_pubsub(p, p.connect_timeout).await;
            if matches!(attempt, Err(DriverError::ConnectionFailed(_))) && p.tls.prefer_fallback {
                attempt =
                    open_sentinel_pubsub(&plaintext_sentinel_plan(p), p.connect_timeout).await;
            }
            attempt
        }
    }
}

pub async fn open_live_conn(plan: &ConnectionPlan) -> Result<RedisLiveConn, DriverError> {
    match plan {
        ConnectionPlan::Standalone(p) => {
            let connection = open_standalone_conn_with_fallback(
                &p.url,
                &p.tls,
                p.username.as_deref(),
                p.password.as_deref(),
                p.connect_timeout,
            )
            .await?;
            Ok(RedisLiveConn::Standalone(connection))
        }
        ConnectionPlan::Cluster(p) => {
            let connection = open_cluster_conn_with_fallback(
                &p.node_urls,
                p.username.as_deref(),
                p.password.as_deref(),
                &p.tls,
                p.connect_timeout,
            )
            .await?;
            Ok(RedisLiveConn::Cluster(connection))
        }
        ConnectionPlan::Sentinel(p) => {
            let mut attempt = open_sentinel_conn(p, p.connect_timeout).await;
            if matches!(attempt, Err(DriverError::ConnectionFailed(_))) && p.tls.prefer_fallback {
                attempt = open_sentinel_conn(&plaintext_sentinel_plan(p), p.connect_timeout).await;
            }
            let (client, connection) = attempt?;
            Ok(RedisLiveConn::Sentinel { client, connection })
        }
    }
}
