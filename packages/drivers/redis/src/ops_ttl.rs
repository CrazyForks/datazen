//! TTL helpers: relative EXPIRE, absolute EXPIREAT, and SET KEEPTTL.

use redis::AsyncCommands;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TtlSpec {
    Persist,
    ExpireSecs(u64),
    ExpireAtUnix(i64),
}

pub fn resolve_ttl_seconds(ttl_seconds: i64) -> Result<TtlSpec, String> {
    match ttl_seconds {
        -1 => Ok(TtlSpec::Persist),
        n if n >= 0 => Ok(TtlSpec::ExpireSecs(n as u64)),
        _ => Err(format!("invalid ttl_seconds: {ttl_seconds}")),
    }
}

pub fn resolve_expire_at(expire_at: i64) -> Result<TtlSpec, String> {
    if expire_at <= 0 {
        return Err(format!(
            "invalid expire_at: {expire_at} (expected unix timestamp > 0)"
        ));
    }
    Ok(TtlSpec::ExpireAtUnix(expire_at))
}

pub async fn apply_ttl<C>(conn: &mut C, key: &str, spec: TtlSpec) -> Result<(), String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    match spec {
        TtlSpec::Persist => conn
            .persist::<_, i64>(key)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        TtlSpec::ExpireSecs(secs) => conn
            .expire::<_, i64>(key, secs as i64)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        TtlSpec::ExpireAtUnix(ts) => redis::cmd("EXPIREAT")
            .arg(key)
            .arg(ts)
            .query_async::<i64>(conn)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
    }
}

pub async fn set_expire_at_key<C>(conn: &mut C, key: &str, expire_at: i64) -> Result<(), String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    apply_ttl(conn, key, resolve_expire_at(expire_at)?).await
}

/// SET value. When `keep_ttl` is true, uses `SET key value KEEPTTL` (Redis ≥ 6).
pub async fn set_string_keep_ttl<C>(
    conn: &mut C,
    key: &str,
    value: &str,
    keep_ttl: bool,
) -> Result<(), String>
where
    C: AsyncCommands + redis::aio::ConnectionLike + Send,
{
    if keep_ttl {
        redis::cmd("SET")
            .arg(key)
            .arg(value)
            .arg("KEEPTTL")
            .query_async::<()>(conn)
            .await
            .map_err(|e| e.to_string())
    } else {
        conn.set(key, value).await.map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_seconds_persist_and_expire() {
        assert_eq!(resolve_ttl_seconds(-1).unwrap(), TtlSpec::Persist);
        assert_eq!(resolve_ttl_seconds(60).unwrap(), TtlSpec::ExpireSecs(60));
        assert!(resolve_ttl_seconds(-2).is_err());
    }

    #[test]
    fn expire_at_requires_positive() {
        assert_eq!(
            resolve_expire_at(1_700_000_000).unwrap(),
            TtlSpec::ExpireAtUnix(1_700_000_000)
        );
        assert!(resolve_expire_at(0).is_err());
        assert!(resolve_expire_at(-1).is_err());
    }
}
