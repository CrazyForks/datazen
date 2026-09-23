#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // First statement: select the process-wide rustls backend before anything
    // can build a TLS client config. Both the GUI and `--mcp-stdio` entry points
    // run through here, and without this any rustls user panics (see
    // `datazen::install_default_crypto_provider`).
    datazen::install_default_crypto_provider();

    let args: Vec<String> = std::env::args().collect();
    if datazen::is_mcp_stdio_mode(&args) {
        datazen::run_mcp_stdio();
    } else {
        datazen::run();
    }
}
