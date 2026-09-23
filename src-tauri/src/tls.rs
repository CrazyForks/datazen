//! Process-wide rustls backend selection.
//!
//! This workspace enables **both** rustls provider features: `aws-lc-rs` (via
//! `reqwest` / `hyper-rustls` / `tokio-rustls`) and `ring` (via `sqlx`,
//! `mongodb`, `redis`, `ureq` and `tauri-plugin-updater`). With two providers
//! compiled in, `rustls::ClientConfig::builder()` refuses to guess and panics:
//!
//! ```text
//! Could not automatically determine the process-level CryptoProvider from
//! Rustls crate features. Call CryptoProvider::install_default() before this
//! point to select a provider manually, ...
//! ```
//!
//! Installing a process-wide default up front removes that ambiguity for every
//! rustls user in the process, not just the tunnel module. Components that pass
//! an explicit provider (`sqlx`, `mongodb` and `ureq` all call
//! `ClientConfig::builder_with_provider`) are unaffected; components that rely
//! on auto-detection (the tunnel module, and `redis`'s `ClientConfig::builder()`)
//! get a working provider instead of a panic.

/// Install the process-wide rustls `CryptoProvider` if none is installed yet.
///
/// `aws-lc-rs` is chosen deliberately:
///
/// - it is rustls 0.23's **own** default provider, i.e. the one
///   `ClientConfig::builder()` would have picked on its own had only a single
///   provider feature been enabled, so this reproduces the intended behaviour
///   rather than overriding it;
/// - `tokio-rustls`'s default features and `reqwest`'s `rustls` feature both
///   enable `aws-lc-rs`, so the dominant TLS consumer here (reqwest: the AI
///   providers and the HTTP-based drivers) is built against it;
/// - the only other installer in the dependency tree (`tauri-plugin-updater`)
///   already guards with `CryptoProvider::get_default().is_none()` and discards
///   the `install_default` error, so it becomes a no-op rather than a conflict.
///
/// Safe to call repeatedly and from any thread: a losing racer simply receives
/// `Err` from `install_default`, which is ignored. Never panics.
///
/// Callers: `main()` (first statement, covering both the GUI and `--mcp-stdio`
/// entry points) and the tunnel TLS construction sites, so that library/test
/// embedders are covered too.
pub fn install_default_crypto_provider() {
    if tokio_rustls::rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = tokio_rustls::rustls::crypto::aws_lc_rs::default_provider().install_default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Idempotent and panic-free, including when a default already exists (the
    /// updater or an earlier call may have won the race).
    #[test]
    fn install_is_idempotent_and_selects_a_provider() {
        install_default_crypto_provider();
        install_default_crypto_provider();
        assert!(
            tokio_rustls::rustls::crypto::CryptoProvider::get_default().is_some(),
            "a default CryptoProvider must be installed"
        );
    }

    /// The exact call that used to panic: building a `ClientConfig` with both
    /// provider features compiled in.
    #[test]
    fn client_config_builder_works_after_install() {
        install_default_crypto_provider();
        let _ = tokio_rustls::rustls::ClientConfig::builder()
            .with_root_certificates(tokio_rustls::rustls::RootCertStore::empty())
            .with_no_client_auth();
    }

    /// [tester] BUG-004 (b) — components that rely on rustls' **auto-detection**
    /// (`ClientConfig::builder()`, no explicit provider) must resolve to the
    /// installed process default instead of panicking, and must share that same
    /// provider.
    ///
    /// That is precisely the call `redis 0.27` makes in
    /// `create_rustls_config` (`src/connection.rs:891`, reachable here because
    /// `datazen-driver-redis` enables `tokio-rustls-comp` → `tls-rustls`) and the
    /// call `tungstenite 0.26` makes for `wss://` (`src/tls.rs:135`). It is the
    /// compatibility claim behind choosing `aws-lc-rs` as the process default.
    #[test]
    fn test_tester_auto_detecting_builder_shares_the_installed_provider() {
        install_default_crypto_provider();
        let installed = tokio_rustls::rustls::crypto::CryptoProvider::get_default()
            .expect("install must leave a process-wide default provider");
        let config = tokio_rustls::rustls::ClientConfig::builder()
            .with_root_certificates(tokio_rustls::rustls::RootCertStore::empty())
            .with_no_client_auth();
        assert!(
            std::sync::Arc::ptr_eq(config.crypto_provider(), installed),
            "auto-detecting builders must reuse the process-wide default provider"
        );
    }

    /// [tester] BUG-004 (b)3 — the **construction sites**, not only `main()`,
    /// must install the provider.
    ///
    /// This guard is not redundant with the runtime tests: the test harness never
    /// runs `main()`, and because the provider is process-global, one install
    /// from any other test would keep the whole suite green even if a
    /// construction-site call were deleted. Only a source-level assertion pins
    /// that down (same style as `bootstrap::tests`).
    #[test]
    fn test_tester_every_entry_point_and_tls_construction_site_installs_the_provider() {
        let main_rs = include_str!("main.rs");
        let install_at = main_rs
            .find("datazen::install_default_crypto_provider()")
            .expect("main() must install the process-wide provider");
        let args_at = main_rs
            .find("let args: Vec<String> = std::env::args().collect();")
            .expect("main() must still parse argv");
        assert!(
            install_at < args_at,
            "the install must be main()'s first statement, before any TLS user"
        );
        // Both entry points funnel through main(): GUI and `--mcp-stdio`.
        assert!(main_rs.contains("datazen::run_mcp_stdio()"));
        assert!(main_rs.contains("datazen::run()"));

        let lib_rs = include_str!("lib.rs");
        assert!(lib_rs.contains("mod tls;"));
        assert!(lib_rs.contains("pub use tls::install_default_crypto_provider;"));

        // `https` proxy path: install before `ClientConfig::builder()`.
        let http_proxy = include_str!("tunnel/http_proxy.rs");
        let builder_at = http_proxy
            .find("let tls_config = ClientConfig::builder()")
            .expect("tls_connect builds a ClientConfig");
        let call_at = http_proxy
            .find("crate::tls::install_default_crypto_provider();")
            .expect("tls_connect must install the provider");
        assert!(
            call_at < builder_at,
            "the provider must be installed before the ClientConfig is built"
        );

        // `wss://` path: tungstenite builds its own ClientConfig internally, so
        // the install has to happen in `connect_ws` before the handshake.
        let websocket = include_str!("tunnel/websocket.rs");
        assert!(websocket.contains("crate::tls::install_default_crypto_provider();"));
    }
}
