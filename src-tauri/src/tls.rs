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
}
