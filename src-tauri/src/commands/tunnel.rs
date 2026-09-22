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
    for conn in state.store.get_connections().await {
        if conn.tunnel_id.as_deref() == Some(id.as_str()) {
            connection_ids.push(conn.id);
            connection_names.push(conn.name);
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
}
