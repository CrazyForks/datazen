import type { BatchOperationErrors } from './batchInvokes';

/**
 * Failure taxonomy + result summary of a batch write (PRD §4 I-8 / task book D-6).
 *
 * The Rust side answers a batch call with `{ ok_count, errors: [{ key, error }] }`
 * where `error` is the raw Redis reply text. Raw text is not a contract — locales
 * and Redis versions change it — so every consumer keys off {@link BatchFailureCode}
 * and only *shows* the message. That is what lets the banner group "why did these
 * 7 keys fail" without string equality on an English sentence.
 *
 * The companion rule (I-8): the keys whose identity appears in `errors` stay
 * checked, everything else is dropped from the selection. A producer that has no
 * per-key verdict — a whole-call throw, or a plain string summary — reports that
 * honestly instead of inventing one, and the banner renders the string as-is.
 */
export type BatchFailureCode = 'noAcl' | 'keyGone' | 'badValue' | 'network' | 'unknown';

/** i18n key per stable code — the banner renders `t(FAILURE_KEYS[code])`. */
export const BATCH_FAILURE_KEYS: Record<BatchFailureCode, string> = {
  noAcl: 'redis.tree.error.noAcl',
  keyGone: 'redis.tree.error.keyGone',
  badValue: 'redis.tree.error.badValue',
  network: 'redis.tree.error.network',
  unknown: 'redis.tree.error.unknown',
};

/** Ordered so the summary lists the most actionable reason first. */
export const BATCH_FAILURE_ORDER: BatchFailureCode[] = [
  'noAcl',
  'network',
  'badValue',
  'keyGone',
  'unknown',
];

const CODE_PATTERNS: [BatchFailureCode, RegExp][] = [
  ['noAcl', /NOPERM|WRONGUSER|NOAUTH|ACL|unauthori[sz]ed/i],
  // `slot` covers `CROSSSLOT …` / `MOVED …`: a batch the cluster could not route
  // as one unit, which is a transport-shape failure, not a per-key value problem.
  ['network', /connection|closed|reset|broken pipe|i\/o|timed? out|timeout|cluster|slot/i],
  ['badValue', /WRONGTYPE|invalid|malformed|not an? int|out of range|value too large/i],
  ['keyGone', /doesn'?t exist|no such key|not exist|expired/i],
];

/** Map a raw Redis error string onto its stable code. */
export function classifyBatchError(raw: string | undefined | null): BatchFailureCode {
  const message = (raw ?? '').trim();
  if (!message) return 'unknown';
  for (const [code, pattern] of CODE_PATTERNS) {
    if (pattern.test(message)) return code;
  }
  return 'unknown';
}

export interface BatchFailure {
  key: string;
  code: BatchFailureCode;
  /** Raw server message, shown as the detail line next to the classified reason. */
  message: string;
}

export type BatchActionKind = 'delete' | 'delete-pattern' | 'ttl' | 'rename';

export interface BatchResultSummary {
  action: BatchActionKind;
  ok: number;
  failed: number;
  failures: BatchFailure[];
}

/**
 * What the banner can be handed. A plain string stays supported — import /
 * export and the row actions have no per-key verdict to show — but every batch
 * write that *does* know which keys failed reports the structured form, because
 * I-8's "失败 M，可展开每条原因" cannot be rebuilt from a sentence.
 */
export type BatchSummaryPayload = string | BatchResultSummary;

/** Server-truth summary with the selection-consistent `ok` count. */
export function isBatchResultSummary(payload: BatchSummaryPayload): payload is BatchResultSummary {
  return typeof payload !== 'string';
}

/** Per-key errors of a `batch_*` reply ⇒ classified failures, server order kept. */
export function failuresFromErrors(errors: BatchOperationErrors[] | undefined): BatchFailure[] {
  return (errors ?? []).map((entry) => ({
    key: entry.key,
    code: classifyBatchError(entry.error),
    message: (entry.error ?? '').trim(),
  }));
}

export function batchSummary(
  action: BatchActionKind,
  ok: number,
  failures: BatchFailure[],
): BatchResultSummary {
  return { action, ok, failed: failures.length, failures };
}

/**
 * Whole-batch failure (the invoke itself threw, e.g. a dropped connection): the
 * backend gave us no per-key verdict, so *every* requested key is treated as
 * failed and stays selected. This is the safe side of I-8 — silently dropping a
 * selection the user has to re-do is worse than a stale checkbox.
 */
export function failuresForAllKeys(keys: string[], raw: string | undefined): BatchFailure[] {
  const code = classifyBatchError(raw);
  const message = (raw ?? '').trim();
  return keys.map((key) => ({ key, code, message }));
}

/** Names that the server reported as failed — the ones I-8 keeps checked. */
export function failedKeyNames(failures: BatchFailure[]): string[] {
  return failures.map((failure) => failure.key);
}

/** Group failures by code so the collapsed banner can say `3 × 无权限` etc. */
export function failuresByCode(
  failures: BatchFailure[],
): { code: BatchFailureCode; keys: string[] }[] {
  const buckets = new Map<BatchFailureCode, string[]>();
  for (const failure of failures) {
    const bucket = buckets.get(failure.code);
    if (bucket) bucket.push(failure.key);
    else buckets.set(failure.code, [failure.key]);
  }
  return BATCH_FAILURE_ORDER.filter((code) => buckets.has(code)).map((code) => ({
    code,
    keys: buckets.get(code)!,
  }));
}
