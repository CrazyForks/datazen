import { redisCommandInvoke, type RedisInvokeFn } from '../shared/redisInvoke';

/**
 * Driver-command seam for the batch write operations of the key tree
 * (`delete_keys` / `batch_delete_pattern` / `batch_set_ttl` /
 * `batch_rename_prefix` / `count_matching`).
 *
 * Lives in its own module (D-1) so the header action group, the pattern strip and
 * the row delete all call one place, and so a test can substitute `invoke`
 * without pulling any UI into the graph. Every payload key is camelCase — the
 * Tauri layer maps to the Rust snake_case args (frontend convention).
 */

export interface BatchOperationErrors {
  key: string;
  error: string;
}

export interface BatchDeleteResult {
  deleted: number;
  errors: BatchOperationErrors[];
}

export interface BatchSetTtlResult {
  updated: number;
  errors: BatchOperationErrors[];
}

export interface BatchRenameResult {
  renamed: number;
  errors: BatchOperationErrors[];
}

export type PluginInvokeFn = RedisInvokeFn;

export async function invokeDeleteKeys(
  dbSessionId: string,
  dbIndex: number,
  keys: string[],
  invoke: PluginInvokeFn = redisCommandInvoke,
): Promise<number> {
  return (await invoke('redis', 'delete_keys', {
    dbSessionId: dbSessionId,
    dbIndex: dbIndex,
    keys,
  })) as number;
}

export async function invokeBatchDeletePattern(
  dbSessionId: string,
  dbIndex: number,
  pattern: string,
  invoke: PluginInvokeFn = redisCommandInvoke,
): Promise<BatchDeleteResult> {
  return (await invoke('redis', 'batch_delete_pattern', {
    dbSessionId: dbSessionId,
    dbIndex: dbIndex,
    pattern,
  })) as BatchDeleteResult;
}

export async function invokeBatchSetTtl(
  dbSessionId: string,
  dbIndex: number,
  keys: string[],
  ttlSeconds: number,
  invoke: PluginInvokeFn = redisCommandInvoke,
): Promise<BatchSetTtlResult> {
  return (await invoke('redis', 'batch_set_ttl', {
    dbSessionId: dbSessionId,
    dbIndex: dbIndex,
    keys,
    ttlSeconds: ttlSeconds,
  })) as BatchSetTtlResult;
}

export async function invokeBatchRenamePrefix(
  dbSessionId: string,
  dbIndex: number,
  oldPrefix: string,
  newPrefix: string,
  keys: string[] | undefined,
  invoke: PluginInvokeFn = redisCommandInvoke,
): Promise<BatchRenameResult> {
  return (await invoke('redis', 'batch_rename_prefix', {
    dbSessionId: dbSessionId,
    dbIndex: dbIndex,
    oldPrefix: oldPrefix,
    newPrefix: newPrefix,
    keys: keys ?? null,
  })) as BatchRenameResult;
}

export async function invokeCountMatching(
  dbSessionId: string,
  dbIndex: number,
  pattern: string,
  invoke: PluginInvokeFn = redisCommandInvoke,
): Promise<number> {
  return (await invoke('redis', 'count_matching', {
    dbSessionId: dbSessionId,
    dbIndex: dbIndex,
    pattern,
  })) as number;
}
