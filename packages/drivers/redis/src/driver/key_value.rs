//! KeyValueDriver trait implementation for RedisDriver.

use async_trait::async_trait;
use datazen_driver_api::*;

use crate::driver::RedisDriver;

#[async_trait]
impl KeyValueDriver for RedisDriver {
    fn driver_type(&self) -> DatabaseType {
        "redis".to_string()
    }

    async fn scan_keys_with_info(
        &self,
        handle: &ConnectionHandle,
        db_index: u32,
        pattern: &str,
        cursor: u64,
        count: u32,
    ) -> Result<(u64, Vec<KeyEntry>, u64), DriverError> {
        // Trait path: no type filter, logical size (not MEMORY USAGE), no budget
        // override. Full options (keyType / withMemory / budget) are available
        // via the scan_keys command; this projection keeps only what the host
        // trait has slots for.
        let page = RedisDriver::scan_keys_with_info(
            self, handle, db_index, pattern, cursor, count, None, false, false, None,
        )
        .await?;
        Ok((page.next_cursor, page.entries, page.dbsize))
    }
}
