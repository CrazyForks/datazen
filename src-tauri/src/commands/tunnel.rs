//! Tunnel entity IPC (independent of connection configs).

use super::error::{CmdExt, CommandError};
use super::AppState;
use datazen_driver_api::{SavedTunnel, SavedTunnelSummary, TunnelUsage};
use tauri::State;

pub(crate) async fn get_tunnels_impl(state: &AppState) -> Result<Vec<SavedTunnel>, CommandError> {
    Ok(state.store.get_tunnels().await)
}

pub(crate) async fn get_tunnel_impl(
    state: &AppState,
    id: String,
) -> Result<Option<SavedTunnel>, CommandError> {
    Ok(state.store.get_tunnel(&id).await)
}

pub(crate) async fn save_tunnel_impl(
    state: &AppState,
    tunnel: SavedTunnel,
) -> Result<(), CommandError> {
    tracing::info!(id = %tunnel.id, name = %tunnel.name, kind = ?tunnel.kind, "save_tunnel");
    state.store.save_tunnel(tunnel).await.cmd_err("save_tunnel")
}

pub(crate) async fn delete_tunnel_impl(state: &AppState, id: String) -> Result<(), CommandError> {
    tracing::info!(%id, "delete_tunnel");
    state
        .store
        .delete_tunnel(&id)
        .await
        .cmd_err("delete_tunnel")
}

/// Metadata-only projection of the stored tunnels for the selector.
///
/// Deliberately drops `ssh` / `http_proxy` / `websocket`: `get_tunnels` hands
/// the decrypted secrets to the webview, so the list path must not reuse it.
pub(crate) async fn get_tunnel_summaries_impl(
    state: &AppState,
) -> Result<Vec<SavedTunnelSummary>, CommandError> {
    Ok(state
        .store
        .get_tunnels()
        .await
        .into_iter()
        .map(|t| SavedTunnelSummary {
            id: t.id,
            name: t.name,
            kind: t.kind,
        })
        .collect())
}

/// Which connections reference `id`. `connection_ids` and `connection_names`
/// are positionally aligned.
pub(crate) async fn get_tunnel_usage_impl(
    state: &AppState,
    id: String,
) -> Result<TunnelUsage, CommandError> {
    let mut connection_ids = Vec::new();
    let mut connection_names = Vec::new();
    // An empty query must not sweep in connections whose reference is itself
    // empty: `materialize_tunnel_refs` treats "" as "no tunnel reference".
    if !id.is_empty() {
        for conn in state.store.get_connections().await {
            if conn.tunnel_id.as_deref() == Some(id.as_str()) {
                connection_ids.push(conn.id);
                connection_names.push(conn.name);
            }
        }
    }
    Ok(TunnelUsage {
        connection_ids,
        connection_names,
    })
}

/// Probe a saved tunnel against `target_host:target_port`; returns elapsed ms.
pub(crate) async fn test_tunnel_impl(
    state: &AppState,
    id: String,
    target_host: String,
    target_port: u16,
) -> Result<u64, CommandError> {
    let elapsed = state
        .connection_manager
        .test_tunnel(&id, &target_host, target_port)
        .await
        .cmd_err("test_tunnel")?;
    let elapsed_ms = elapsed.as_millis() as u64;
    tracing::info!(tunnel_id = %id, elapsed_ms, "test_tunnel OK");
    Ok(elapsed_ms)
}

#[tauri::command]
pub async fn get_tunnels(state: State<'_, AppState>) -> Result<Vec<SavedTunnel>, CommandError> {
    get_tunnels_impl(&state).await
}

#[tauri::command]
pub async fn get_tunnel(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<SavedTunnel>, CommandError> {
    get_tunnel_impl(&state, id).await
}

#[tauri::command]
pub async fn save_tunnel(
    state: State<'_, AppState>,
    tunnel: SavedTunnel,
) -> Result<(), CommandError> {
    save_tunnel_impl(&state, tunnel).await
}

#[tauri::command]
pub async fn delete_tunnel(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    delete_tunnel_impl(&state, id).await
}

#[tauri::command]
pub async fn get_tunnel_summaries(
    state: State<'_, AppState>,
) -> Result<Vec<SavedTunnelSummary>, CommandError> {
    get_tunnel_summaries_impl(&state).await
}

#[tauri::command]
pub async fn get_tunnel_usage(
    state: State<'_, AppState>,
    id: String,
) -> Result<TunnelUsage, CommandError> {
    get_tunnel_usage_impl(&state, id).await
}

#[tauri::command]
pub async fn test_tunnel(
    state: State<'_, AppState>,
    id: String,
    target_host: String,
    target_port: u16,
) -> Result<u64, CommandError> {
    test_tunnel_impl(&state, id, target_host, target_port).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{SshTunnelConfig, TunnelKind};
    use crate::testing::app_state::{sample_postgres_config, TestAppState};

    const SSH_PASSWORD: &str = "ssh-password-secret";
    const SSH_PASSPHRASE: &str = "ssh-passphrase-secret";
    const SSH_HOST: &str = "bastion.internal";

    fn saved_ssh_tunnel(id: &str, name: &str) -> SavedTunnel {
        SavedTunnel {
            id: id.into(),
            name: name.into(),
            kind: TunnelKind::Ssh,
            ssh: Some(SshTunnelConfig {
                enabled: true,
                host: SSH_HOST.into(),
                port: 2222,
                username: "ubuntu".into(),
                auth_method: "password".into(),
                password: Some(SSH_PASSWORD.into()),
                private_key_path: None,
                passphrase: Some(SSH_PASSPHRASE.into()),
                jump: None,
            }),
            http_proxy: None,
            websocket: None,
        }
    }

    fn assert_no_secret_leak(json: &str) {
        for needle in [
            SSH_PASSWORD,
            SSH_PASSPHRASE,
            SSH_HOST,
            "ubuntu",
            "password",
            "passphrase",
            "authToken",
            "auth_token",
            "privateKeyPath",
        ] {
            assert!(
                !json.contains(needle),
                "IPC payload leaked `{needle}`: {json}"
            );
        }
    }

    #[tokio::test]
    async fn summaries_drop_every_tunnel_secret() {
        let test = TestAppState::new().await;
        test.store
            .save_tunnel(saved_ssh_tunnel("t1", "Prod Bastion"))
            .await
            .unwrap();

        let summaries = get_tunnel_summaries_impl(&test.state).await.unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "t1");
        assert_eq!(summaries[0].name, "Prod Bastion");
        assert_eq!(summaries[0].kind, TunnelKind::Ssh);

        let json = serde_json::to_string(&summaries).unwrap();
        assert_no_secret_leak(&json);
        let value: serde_json::Value = serde_json::to_value(&summaries).unwrap();
        assert_eq!(
            value,
            serde_json::json!([{ "id": "t1", "name": "Prod Bastion", "kind": "ssh" }]),
            "the summary must expose exactly id/name/kind"
        );
    }

    #[tokio::test]
    async fn usage_lists_referencing_connections_in_order() {
        let test = TestAppState::new().await;
        test.store
            .save_tunnel(saved_ssh_tunnel("t1", "Prod Bastion"))
            .await
            .unwrap();
        test.store
            .save_tunnel(saved_ssh_tunnel("t2", "Other Bastion"))
            .await
            .unwrap();

        let mut hit = sample_postgres_config("conn-hit");
        hit.name = "Hit".into();
        hit.tunnel_id = Some("t1".into());
        test.store.save_connection(hit).await.unwrap();

        let mut other = sample_postgres_config("conn-other");
        other.name = "Other".into();
        other.tunnel_id = Some("t2".into());
        test.store.save_connection(other).await.unwrap();

        let usage = get_tunnel_usage_impl(&test.state, "t1".into())
            .await
            .unwrap();
        assert_eq!(usage.connection_ids, vec!["conn-hit".to_string()]);
        assert_eq!(usage.connection_names, vec!["Hit".to_string()]);

        let json = serde_json::to_string(&usage).unwrap();
        assert_no_secret_leak(&json);

        // Miss path: a stored tunnel nobody references returns empty arrays.
        let miss = get_tunnel_usage_impl(&test.state, "t2-missing".into())
            .await
            .unwrap();
        assert!(miss.connection_ids.is_empty());
        assert!(miss.connection_names.is_empty());

        let miss_unknown = get_tunnel_usage_impl(&test.state, "no-such-tunnel".into())
            .await
            .unwrap();
        assert!(miss_unknown.connection_ids.is_empty());
        assert!(miss_unknown.connection_names.is_empty());
    }

    #[tokio::test]
    async fn test_tunnel_rejects_unknown_tunnel_id() {
        let test = TestAppState::new().await;
        let err = test_tunnel_impl(
            &test.state,
            "missing-tunnel".into(),
            "127.0.0.1".into(),
            5432,
        )
        .await
        .expect_err("an unknown tunnel id must fail the probe");
        assert!(
            err.to_string().contains("missing-tunnel"),
            "error must name the offending tunnel: {err}"
        );
    }

    #[tokio::test]
    async fn test_tunnel_rejects_tunnel_without_a_tunnel_config() {
        let test = TestAppState::new().await;
        test.store
            .save_tunnel(SavedTunnel {
                id: "t-none".into(),
                name: "Disabled".into(),
                kind: TunnelKind::None,
                ssh: None,
                http_proxy: None,
                websocket: None,
            })
            .await
            .unwrap();

        let err = test_tunnel_impl(&test.state, "t-none".into(), "127.0.0.1".into(), 5432)
            .await
            .expect_err("a tunnel with no configuration must not report success");
        assert!(
            err.to_string().contains("resolved to no tunnel"),
            "unexpected error: {err}"
        );
    }

    // ── [tester] independent verification additions ──────────────────

    #[tokio::test]
    async fn test_tester_summaries_are_empty_for_an_empty_store() {
        let test = TestAppState::new().await;
        let summaries = get_tunnel_summaries_impl(&test.state).await.unwrap();
        assert!(
            summaries.is_empty(),
            "an empty store must project to an empty summary list"
        );
    }

    #[tokio::test]
    async fn test_tester_summaries_keep_store_order_and_drop_secrets_for_every_kind() {
        use crate::db::{HttpProxyTunnelConfig, WebSocketTunnelConfig};

        let test = TestAppState::new().await;
        test.store
            .save_tunnel(saved_ssh_tunnel("t1", "Bastion"))
            .await
            .unwrap();
        test.store
            .save_tunnel(SavedTunnel {
                id: "t2".into(),
                name: "Corp proxy".into(),
                kind: TunnelKind::HttpProxy,
                ssh: None,
                http_proxy: Some(HttpProxyTunnelConfig {
                    enabled: true,
                    host: "proxy.corp".into(),
                    port: 8080,
                    scheme: "http".into(),
                    username: Some("proxy-user".into()),
                    password: Some("proxy-password-secret".into()),
                    headers: None,
                    connect_timeout_secs: 30,
                }),
                websocket: None,
            })
            .await
            .unwrap();
        test.store
            .save_tunnel(SavedTunnel {
                id: "t3".into(),
                name: "Relay".into(),
                kind: TunnelKind::WebSocket,
                ssh: None,
                http_proxy: None,
                websocket: Some(WebSocketTunnelConfig {
                    enabled: true,
                    url: "wss://relay.corp/v1".into(),
                    auth_token: Some("ws-auth-token-secret".into()),
                    headers: None,
                    connect_timeout_secs: 30,
                    ping_interval_secs: 30,
                    mode: "datazen_v1".into(),
                }),
            })
            .await
            .unwrap();

        let summaries = get_tunnel_summaries_impl(&test.state).await.unwrap();
        assert_eq!(
            summaries.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["t1", "t2", "t3"],
            "summaries must preserve store order"
        );
        assert_eq!(
            summaries.iter().map(|s| s.kind).collect::<Vec<_>>(),
            vec![
                TunnelKind::Ssh,
                TunnelKind::HttpProxy,
                TunnelKind::WebSocket
            ]
        );

        // Every kind's secrets must be gone, not just SSH's.
        let json = serde_json::to_string(&summaries).unwrap();
        for needle in [
            SSH_PASSWORD,
            SSH_PASSPHRASE,
            SSH_HOST,
            "proxy-password-secret",
            "proxy-user",
            "proxy.corp",
            "ws-auth-token-secret",
            "relay.corp",
        ] {
            assert!(!json.contains(needle), "summary leaked `{needle}`: {json}");
        }
    }

    #[tokio::test]
    async fn test_tester_usage_is_positionally_aligned_across_multiple_hits() {
        let test = TestAppState::new().await;
        test.store
            .save_tunnel(saved_ssh_tunnel("t1", "Bastion"))
            .await
            .unwrap();

        // Deliberately insert in an order where the ids and the names do not
        // sort alike, so a positional mix-up cannot cancel out.
        for (id, name) in [("c-b", "Bravo"), ("c-a", "Alpha"), ("c-c", "Charlie")] {
            let mut conn = sample_postgres_config(id);
            conn.name = name.into();
            conn.tunnel_id = Some("t1".into());
            test.store.save_connection(conn).await.unwrap();
        }

        // Non-matching neighbours: one direct connection (`None`) and one on a
        // different tunnel.
        let mut direct = sample_postgres_config("c-direct");
        direct.name = "Direct".into();
        direct.tunnel_id = None;
        test.store.save_connection(direct).await.unwrap();

        let mut other = sample_postgres_config("c-other");
        other.name = "Other".into();
        other.tunnel_id = Some("t-other".into());
        test.store.save_connection(other).await.unwrap();

        let usage = get_tunnel_usage_impl(&test.state, "t1".into())
            .await
            .unwrap();
        assert_eq!(
            usage.connection_ids,
            vec!["c-b".to_string(), "c-a".to_string(), "c-c".to_string()],
            "ids must come back in store order"
        );
        assert_eq!(
            usage.connection_names,
            vec![
                "Bravo".to_string(),
                "Alpha".to_string(),
                "Charlie".to_string()
            ],
            "each name must stay aligned with its own id"
        );
        assert_eq!(usage.connection_ids.len(), usage.connection_names.len());
    }

    #[tokio::test]
    async fn test_tester_usage_with_empty_id_matches_no_real_reference() {
        let test = TestAppState::new().await;
        test.store
            .save_tunnel(saved_ssh_tunnel("t1", "Bastion"))
            .await
            .unwrap();

        let mut referenced = sample_postgres_config("c-ref");
        referenced.tunnel_id = Some("t1".into());
        test.store.save_connection(referenced).await.unwrap();

        let mut direct = sample_postgres_config("c-direct");
        direct.tunnel_id = None;
        test.store.save_connection(direct).await.unwrap();

        // `None` must never match; an empty query must not sweep in every
        // direct connection (none of them carries an empty-string reference).
        let usage = get_tunnel_usage_impl(&test.state, String::new())
            .await
            .unwrap();
        assert!(usage.connection_ids.is_empty(), "{usage:?}");
        assert!(usage.connection_names.is_empty(), "{usage:?}");
    }

    #[tokio::test]
    async fn test_tester_test_tunnel_rejects_ssh_kind_without_ssh_config() {
        let test = TestAppState::new().await;
        test.store
            .save_tunnel(SavedTunnel {
                id: "t-ssh-broken".into(),
                name: "Broken".into(),
                kind: TunnelKind::Ssh,
                ssh: None,
                http_proxy: None,
                websocket: None,
            })
            .await
            .unwrap();

        let err = test_tunnel_impl(&test.state, "t-ssh-broken".into(), "127.0.0.1".into(), 5432)
            .await
            .expect_err("kind=ssh with no ssh config must not report success");
        assert!(
            err.to_string().contains("sshTunnel is missing or disabled"),
            "unexpected error: {err}"
        );
    }

    #[tokio::test]
    async fn test_tester_test_tunnel_rejects_disabled_ssh_tunnel() {
        let test = TestAppState::new().await;
        let mut tunnel = saved_ssh_tunnel("t-ssh-off", "Disabled");
        if let Some(ssh) = tunnel.ssh.as_mut() {
            ssh.enabled = false;
        }
        test.store.save_tunnel(tunnel).await.unwrap();

        let err = test_tunnel_impl(&test.state, "t-ssh-off".into(), "127.0.0.1".into(), 5432)
            .await
            .expect_err("a disabled ssh tunnel must not report success");
        assert!(
            err.to_string().contains("sshTunnel is missing or disabled"),
            "unexpected error: {err}"
        );
    }

    /// [tester] Success path: the probe must reach `Ok(elapsed_ms)` and tear the
    /// tunnel down without panicking.
    ///
    /// The fixture is a local TCP listener that answers an HTTP `CONNECT` with
    /// `200`, so the assertion also holds if the lazily-started proxy path is
    /// ever made to dial eagerly (see `tunnel-backend-BUG-001`).
    #[tokio::test]
    async fn test_tester_test_tunnel_success_path_with_local_proxy_fixture() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind proxy fixture");
        let proxy_port = listener.local_addr().expect("fixture addr").port();
        let fixture = tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    let _ = stream.read(&mut buf).await;
                    let _ = stream
                        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                        .await;
                    let _ = stream.shutdown().await;
                });
            }
        });

        let test = TestAppState::new().await;
        test.store
            .save_tunnel(SavedTunnel {
                id: "t-proxy".into(),
                name: "Local proxy".into(),
                kind: TunnelKind::HttpProxy,
                ssh: None,
                http_proxy: Some(crate::db::HttpProxyTunnelConfig {
                    enabled: true,
                    host: "127.0.0.1".into(),
                    port: proxy_port,
                    scheme: "http".into(),
                    username: None,
                    password: None,
                    headers: None,
                    connect_timeout_secs: 5,
                }),
                websocket: None,
            })
            .await
            .unwrap();

        let elapsed_ms = test_tunnel_impl(&test.state, "t-proxy".into(), "127.0.0.1".into(), 5432)
            .await
            .expect("the probe must succeed for a reachable local proxy fixture");
        assert!(
            elapsed_ms < 5_000,
            "probe took suspiciously long: {elapsed_ms}ms"
        );

        fixture.abort();
    }

    // ── tunnel-backend-BUG-001: unreachable proxy / relay must not pass ──

    /// A `127.0.0.1` port the OS just handed out and that nothing listens on.
    async fn closed_local_port() -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind probe port");
        let port = listener.local_addr().expect("probe addr").port();
        drop(listener);
        port
    }

    fn saved_proxy_tunnel(id: &str, port: u16) -> SavedTunnel {
        SavedTunnel {
            id: id.into(),
            name: "Proxy".into(),
            kind: TunnelKind::HttpProxy,
            ssh: None,
            http_proxy: Some(crate::db::HttpProxyTunnelConfig {
                enabled: true,
                host: "127.0.0.1".into(),
                port,
                scheme: "http".into(),
                username: None,
                password: None,
                headers: None,
                connect_timeout_secs: 2,
            }),
            websocket: None,
        }
    }

    fn saved_websocket_tunnel(id: &str, port: u16) -> SavedTunnel {
        SavedTunnel {
            id: id.into(),
            name: "Relay".into(),
            kind: TunnelKind::WebSocket,
            ssh: None,
            http_proxy: None,
            websocket: Some(crate::db::WebSocketTunnelConfig {
                enabled: true,
                url: format!("ws://127.0.0.1:{port}/tunnel"),
                auth_token: None,
                headers: None,
                connect_timeout_secs: 2,
                ping_interval_secs: 0,
                mode: "datazen_v1".into(),
            }),
        }
    }

    /// BUG-001 regression: `HttpProxyTunnel::start` only binds the local
    /// listener, so the probe used to answer `Ok(0)` for a proxy on a closed
    /// port. It must report `Err`.
    #[tokio::test]
    async fn test_tunnel_rejects_unreachable_http_proxy_endpoint() {
        let test = TestAppState::new().await;
        let port = closed_local_port().await;
        test.store
            .save_tunnel(saved_proxy_tunnel("t-dead-proxy", port))
            .await
            .unwrap();

        let err = test_tunnel_impl(&test.state, "t-dead-proxy".into(), "127.0.0.1".into(), 5432)
            .await
            .expect_err("an unreachable proxy must not be reported as reachable");
        assert!(
            err.to_string().contains("connect to proxy"),
            "unexpected error: {err}"
        );
    }

    /// A reachable proxy that *rejects* the CONNECT must fail too: this proves
    /// the probe performs a real CONNECT handshake, not a bare TCP connect.
    #[tokio::test]
    async fn test_tunnel_rejects_proxy_that_refuses_connect() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind proxy fixture");
        let port = listener.local_addr().expect("fixture addr").port();
        let fixture = tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    let _ = stream.read(&mut buf).await;
                    let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\n\r\n").await;
                    let _ = stream.shutdown().await;
                });
            }
        });

        let test = TestAppState::new().await;
        test.store
            .save_tunnel(saved_proxy_tunnel("t-refusing-proxy", port))
            .await
            .unwrap();

        let err = test_tunnel_impl(
            &test.state,
            "t-refusing-proxy".into(),
            "127.0.0.1".into(),
            5432,
        )
        .await
        .expect_err("a proxy that refuses CONNECT must not be reported as reachable");
        assert!(
            err.to_string().contains("CONNECT rejected"),
            "unexpected error: {err}"
        );

        fixture.abort();
    }

    /// BUG-001 regression: `WebSocketTunnel::start` only binds the local
    /// listener, so the probe used to answer `Ok(0)` for a relay on a closed
    /// port. It must report `Err`.
    #[tokio::test]
    async fn test_tunnel_rejects_unreachable_websocket_endpoint() {
        let test = TestAppState::new().await;
        let port = closed_local_port().await;
        test.store
            .save_tunnel(saved_websocket_tunnel("t-dead-relay", port))
            .await
            .unwrap();

        let err = test_tunnel_impl(&test.state, "t-dead-relay".into(), "127.0.0.1".into(), 5432)
            .await
            .expect_err("an unreachable relay must not be reported as reachable");
        assert!(
            !err.to_string().is_empty(),
            "the probe error must carry a message"
        );
    }

    /// The mirror of the failure tests: a relay that really answers the
    /// `datazen_v1` `open` with `opened` must pass, so the fix cannot be
    /// "always return Err for WebSocket".
    #[tokio::test]
    async fn test_tunnel_probes_websocket_relay_end_to_end() {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind relay fixture");
        let port = listener.local_addr().expect("fixture addr").port();
        let fixture = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
                        return;
                    };
                    if let Some(Ok(Message::Text(text))) = ws.next().await {
                        let open: serde_json::Value =
                            serde_json::from_str(&text).unwrap_or_default();
                        let ack = if open.get("op").and_then(|v| v.as_str()) == Some("open") {
                            r#"{"op":"opened"}"#
                        } else {
                            r#"{"op":"error","message":"unexpected frame"}"#
                        };
                        let _ = ws.send(Message::Text(ack.to_string().into())).await;
                        // Hold the socket until the probe closes it.
                        while let Some(Ok(msg)) = ws.next().await {
                            if msg.is_close() {
                                break;
                            }
                        }
                    }
                });
            }
        });

        let test = TestAppState::new().await;
        test.store
            .save_tunnel(saved_websocket_tunnel("t-live-relay", port))
            .await
            .unwrap();

        let elapsed_ms =
            test_tunnel_impl(&test.state, "t-live-relay".into(), "127.0.0.1".into(), 5432)
                .await
                .expect("a relay that acks the open must pass the probe");
        assert!(
            elapsed_ms < 5_000,
            "probe took suspiciously long: {elapsed_ms}ms"
        );

        fixture.abort();
    }

    /// SSH has always dialed eagerly, so this pins that an unreachable bastion
    /// is reported as unreachable rather than optimistically succeeding.
    #[tokio::test]
    async fn test_tunnel_rejects_unreachable_ssh_bastion() {
        let test = TestAppState::new().await;
        let port = closed_local_port().await;
        test.store
            .save_tunnel(SavedTunnel {
                id: "t-dead-bastion".into(),
                name: "Bastion".into(),
                kind: TunnelKind::Ssh,
                ssh: Some(SshTunnelConfig {
                    enabled: true,
                    host: "127.0.0.1".into(),
                    port,
                    username: "ubuntu".into(),
                    auth_method: "password".into(),
                    password: Some("secret".into()),
                    private_key_path: None,
                    passphrase: None,
                    jump: None,
                }),
                http_proxy: None,
                websocket: None,
            })
            .await
            .unwrap();

        let err = test_tunnel_impl(
            &test.state,
            "t-dead-bastion".into(),
            "127.0.0.1".into(),
            5432,
        )
        .await
        .expect_err("an unreachable bastion must not be reported as reachable");
        assert!(
            err.to_string().contains("SSH connect"),
            "unexpected error: {err}"
        );
    }
}
