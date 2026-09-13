use super::*;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn config_for(port: u16) -> ConnectionConfig {
    ConnectionConfig {
        id: "redis-test".into(),
        name: "redis-test".into(),
        database_type: "redis".into(),
        host: Some("127.0.0.1".into()),
        port: Some(port),
        database: Some("0".into()),
        schema: None,
        username: None,
        password: None,
        ssl_mode: SslMode::Disable,
        connection_timeout: 1,
        max_pool_size: 10,
        ssh_tunnel: None,
        color_tag: None,
        group: None,
        last_connected_at: None,
        server_version: None,
        read_only: false,
        pinned: false,
        options: None,
    }
}

#[tokio::test]
async fn test_connection_times_out_when_server_stops_responding() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let mut buf = [0; 1024];
        let _ = socket.read(&mut buf).await;
        let _ = socket.write_all(b"+OK\r\n").await;
        tokio::time::sleep(Duration::from_secs(30)).await;
    });

    let started = Instant::now();
    let err = RedisDriver::new()
        .test_connection(&config_for(port))
        .await
        .unwrap_err();

    assert!(started.elapsed() < Duration::from_secs(8));
    assert!(err.to_string().contains("timed out"));
}
