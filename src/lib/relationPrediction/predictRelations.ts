/**
 * Foreign-key prediction from metadata alone.
 *
 * Answers "which tables are related?" for schemas that never declared a
 * constraint. It is pure: metadata in, ranked candidates out, no IPC and no data
 * access — so it is cheap enough to run on every selection change and testable
 * without a database.
 *
 * Design constraints, each one a defence against a wrong JOIN:
 *
 * - **A relationship can only target a key.** A source column is only considered
 *   against a target's primary key or a unique index. Pointing at an arbitrary
 *   column is not a foreign key, and allowing it is how `status_id` ends up
 *   related to `order_status` merely because the names line up.
 * - **Type family is a gate, not a score.** A `varchar` column is never related to
 *   an `integer` key, however well the names match. Some dialects would compare
 *   them happily through an implicit cast, so this cannot be left to the data.
 * - **Ambiguity abstains.** When two targets score comparably the candidate is
 *   marked and the caller must not apply it automatically.
 * - **Declared foreign keys win.** Columns already covered by a real constraint
 *   are skipped rather than predicted.
 *
 * The data-overlap probe is deliberately absent: it needs to query the database,
 * and it is the part that can hurt a production server. It belongs behind an
 * explicit user action, layered on top of these structural candidates.
 */

import {
  isGenericKeyName,
  normalizeDataType,
  normalizeIdentifier,
  qualifiedKeyNameForms,
  singularize,
  typeFamily,
} from './normalize';
import type {
  PredictionEvidence,
  PredictionOptions,
  PredictionTable,
  RelationCandidate,
} from './types';

/** Evidence weights. Tunable in one place so scoring stays inspectable. */
export const EVIDENCE_WEIGHTS = {
  targetIsPrimaryKey: 0.4,
  targetIsUnique: 0.3,
  nameMatchesTable: 0.4,
  nameMatchesTableStem: 0.4,
  /** Table names are commonly prefixed (`app_user`), the column is not. */
  nameMatchesPrefixedTable: 0.25,
  nameSuffixMatchesTable: 0.15,
  nameMatchesKey: 0.3,
  typeExact: 0.1,
  sourceIndexed: 0.1,
} as const;

export const DEFAULT_HIGH_THRESHOLD = 0.8;
export const DEFAULT_MEDIUM_THRESHOLD = 0.5;
export const DEFAULT_AMBIGUITY_MARGIN = 0.15;

/** A key a relationship may point at: the primary key or a unique index. */
interface TargetKey {
  table: PredictionTable;
  columns: readonly string[];
  isPrimaryKey: boolean;
}

/** One scored column-pair match, before grouping. */
interface PairMatch {
  source: PredictionTable;
  sourceColumn: string;
  target: PredictionTable;
  targetColumn: string;
  targetKey: TargetKey;
  score: number;
  evidence: PredictionEvidence[];
}

function evidence(
  code: PredictionEvidence['code'],
  weight: number,
  detail: string,
): PredictionEvidence {
  return { code, weight, detail };
}

/** Every key a relationship may target, per table id. */
function collectTargetKeys(tables: readonly PredictionTable[]): Map<string, TargetKey[]> {
  const keys = new Map<string, TargetKey[]>();
  for (const table of tables) {
    const tableKeys: TargetKey[] = [];
    if (table.primaryKey.length > 0) {
      tableKeys.push({ table, columns: table.primaryKey, isPrimaryKey: true });
    }
    for (const set of table.uniqueColumnSets) {
      if (set.length === 0) continue;
      // A unique index over the primary key adds no new target.
      const isSameAsPk =
        set.length === table.primaryKey.length &&
        set.every((column) => table.primaryKey.includes(column));
      if (isSameAsPk) continue;
      tableKeys.push({ table, columns: set, isPrimaryKey: false });
    }
    keys.set(table.id, tableKeys);
  }
  return keys;
}

/** Columns already covered by a declared foreign key on this table. */
function declaredForeignKeyColumns(table: PredictionTable): Set<string> {
  const covered = new Set<string>();
  for (const fk of table.declaredForeignKeys) {
    for (const column of fk.columns) covered.add(normalizeIdentifier(column));
  }
  return covered;
}

/**
 * Score one source column against one column of a target key.
 *
 * Returns `null` when no naming pattern applies or the types are incompatible —
 * a relationship must be *named*, not merely typed.
 */
function scoreAgainstKeyColumn(
  source: PredictionTable,
  column: PredictionTable['columns'][number],
  targetKey: TargetKey,
  targetColumnName: string,
): { nameWeight: number; targetColumn: string; evidence: PredictionEvidence[] } | null {
  const sourceName = normalizeIdentifier(column.name);
  if (!sourceName) return null;

  const targetColumn = targetKey.table.columns.find(
    (candidate) => normalizeIdentifier(candidate.name) === normalizeIdentifier(targetColumnName),
  );
  if (!targetColumn) return null;

  // ── Type gate: families must agree, or the relationship is impossible ──
  if (typeFamily(column.dataType) !== typeFamily(targetColumn.dataType)) return null;

  const found: PredictionEvidence[] = [];
  const normalizedKeyColumn = normalizeIdentifier(targetColumnName);

  // ── Naming evidence ──
  const forms = qualifiedKeyNameForms(targetKey.table.name, targetColumnName);
  const stem = normalizeIdentifier(singularize(targetKey.table.name));

  let nameWeight = 0;
  if (forms.includes(sourceName)) {
    const isStemForm = sourceName === `${stem}_${normalizedKeyColumn}`;
    nameWeight = EVIDENCE_WEIGHTS.nameMatchesTable;
    found.push(
      evidence(
        isStemForm ? 'name-matches-table-stem' : 'name-matches-table',
        nameWeight,
        `${column.name} names ${targetKey.table.name}.${targetColumnName}`,
      ),
    );
  } else if (forms.some((form) => sourceName.endsWith(`_${form}`))) {
    // `t_user_id` and friends: a short prefix on an otherwise exact form.
    nameWeight = EVIDENCE_WEIGHTS.nameSuffixMatchesTable;
    found.push(
      evidence(
        'name-suffix-matches-table',
        nameWeight,
        `${column.name} ends with a name for ${targetKey.table.name}.${targetColumnName}`,
      ),
    );
  } else if (
    // `app_user` referenced by `user_id`: the column names the table's
    // distinguishing word, while the table carries a prefix the column drops.
    // Weaker than an exact match, because two prefixed tables can share that word
    // — which is exactly the case the ambiguity check exists for.
    sourceName.endsWith(`_${normalizedKeyColumn}`) &&
    stem.endsWith(`_${sourceName.slice(0, -(normalizedKeyColumn.length + 1))}`) &&
    sourceName !== normalizedKeyColumn
  ) {
    nameWeight = EVIDENCE_WEIGHTS.nameMatchesPrefixedTable;
    found.push(
      evidence(
        'name-matches-table-stem',
        nameWeight,
        `${column.name} names the distinguishing word of ${targetKey.table.name}.${targetColumnName}`,
      ),
    );
  } else if (
    !isGenericKeyName(targetColumnName) &&
    sourceName === normalizedKeyColumn &&
    source.id !== targetKey.table.id
  ) {
    // A domain-named key referenced by its own name (`user_id` → `users.user_id`).
    // Generic `id` is excluded: every table has one, so matching on it would
    // relate everything to everything.
    nameWeight = EVIDENCE_WEIGHTS.nameMatchesKey;
    found.push(
      evidence(
        'name-matches-key',
        nameWeight,
        `${column.name} shares the key name ${targetColumnName}`,
      ),
    );
  }

  if (nameWeight === 0) return null;

  // ── Structural evidence ──
  const keyWeight = targetKey.isPrimaryKey
    ? EVIDENCE_WEIGHTS.targetIsPrimaryKey
    : EVIDENCE_WEIGHTS.targetIsUnique;
  found.push(
    evidence(
      targetKey.isPrimaryKey ? 'target-is-primary-key' : 'target-is-unique',
      keyWeight,
      `${targetKey.table.name}.${targetColumnName} is ${
        targetKey.isPrimaryKey ? 'the primary key' : 'unique'
      }`,
    ),
  );

  if (normalizeDataType(column.dataType) === normalizeDataType(targetColumn.dataType)) {
    found.push(evidence('type-exact', EVIDENCE_WEIGHTS.typeExact, `type ${column.dataType}`));
  } else {
    found.push(
      evidence(
        'type-compatible',
        0,
        `${column.dataType} is compatible with ${targetColumn.dataType}`,
      ),
    );
  }

  if (column.indexed) {
    found.push(evidence('source-indexed', EVIDENCE_WEIGHTS.sourceIndexed, 'column is indexed'));
  }

  return { nameWeight, targetColumn: targetColumnName, evidence: found };
}

/**
 * Score one source column against a whole target key.
 *
 * A composite key is tried column by column — `parent_no` names the `no` part of
 * `parents(id, no)` — and the strongest naming match wins. The grouping pass then
 * reassembles the pairs that belong to the same key.
 */
function scoreColumnAgainstKey(
  source: PredictionTable,
  column: PredictionTable['columns'][number],
  targetKey: TargetKey,
): { score: number; targetColumn: string; evidence: PredictionEvidence[] } | null {
  let best: ReturnType<typeof scoreAgainstKeyColumn> = null;

  for (const keyColumn of targetKey.columns) {
    const attempt = scoreAgainstKeyColumn(source, column, targetKey, keyColumn);
    if (!attempt) continue;
    if (!best || attempt.nameWeight > best.nameWeight) best = attempt;
  }
  if (!best) return null;

  // Recompute the total from the winning attempt's own evidence so the score and
  // the explanation can never disagree.
  const score = best.evidence.reduce((total, item) => total + item.weight, 0);
  return { score, targetColumn: best.targetColumn, evidence: best.evidence };
}

/** Deterministic candidate id, stable across re-prediction. */
function candidateId(
  fromTable: string,
  toTable: string,
  pairs: readonly { left: string; right: string }[],
): string {
  const rendered = pairs.map((pair) => `${pair.left}=${pair.right}`).join(',');
  return `predicted-${fromTable}-${toTable}-${rendered}`;
}

/**
 * Infer relationships among `tables`.
 *
 * Results are sorted by descending score, then by id, so the output is stable.
 */
export function predictRelations(
  tables: readonly PredictionTable[],
  options: PredictionOptions = {},
): RelationCandidate[] {
  if (tables.length < 2) return [];

  const highThreshold = options.highThreshold ?? DEFAULT_HIGH_THRESHOLD;
  const mediumThreshold = options.mediumThreshold ?? DEFAULT_MEDIUM_THRESHOLD;
  const ambiguityMargin = options.ambiguityMargin ?? DEFAULT_AMBIGUITY_MARGIN;
  const allowCrossSchema = options.allowCrossSchema ?? false;

  const keysByTable = collectTargetKeys(tables);
  const matches: PairMatch[] = [];

  for (const source of tables) {
    const covered = declaredForeignKeyColumns(source);
    for (const column of source.columns) {
      // Ground truth first: a declared constraint is not something to predict.
      if (covered.has(normalizeIdentifier(column.name))) continue;

      for (const target of tables) {
        if (target.id === source.id) continue;
        if (!allowCrossSchema && target.schema !== source.schema) continue;

        for (const targetKey of keysByTable.get(target.id) ?? []) {
          const scored = scoreColumnAgainstKey(source, column, targetKey);
          if (!scored) continue;
          matches.push({
            source,
            sourceColumn: column.name,
            target,
            targetColumn: scored.targetColumn,
            targetKey,
            score: scored.score,
            evidence: scored.evidence,
          });
        }
      }
    }
  }

  // ── Ambiguity: one source column matching several targets ──
  const bySourceColumn = new Map<string, PairMatch[]>();
  for (const match of matches) {
    const key = `${match.source.id}\u0000${normalizeIdentifier(match.sourceColumn)}`;
    const bucket = bySourceColumn.get(key);
    if (bucket) bucket.push(match);
    else bySourceColumn.set(key, [match]);
  }

  const ambiguousColumns = new Set<string>();
  for (const [key, bucket] of bySourceColumn) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => b.score - a.score);
    // Distinct targets only: two keys of the same table are not a conflict.
    const topTargets = new Set([sorted[0]!.target.id, sorted[1]!.target.id]);
    if (topTargets.size < 2) continue;
    if (sorted[0]!.score - sorted[1]!.score <= ambiguityMargin) ambiguousColumns.add(key);
  }

  // ── Composite grouping ──
  // Two source columns that both reference the *same composite* key form one
  // relationship. Two columns referencing the same single-column key do not:
  // `orders.billing_address_id` and `orders.shipping_address_id` are two
  // relationships to one table, and merging them would invent an AND that
  // matches nothing.
  const grouped = new Map<string, PairMatch[]>();
  const order: string[] = [];
  for (const match of matches) {
    const compositeKey = match.targetKey.columns.length > 1;
    const groupId = compositeKey
      ? `composite\u0000${match.source.id}\u0000${match.target.id}\u0000${match.targetKey.columns.join(',')}`
      : `pair\u0000${match.source.id}\u0000${match.target.id}\u0000${normalizeIdentifier(match.sourceColumn)}`;
    const bucket = grouped.get(groupId);
    if (bucket) bucket.push(match);
    else {
      grouped.set(groupId, [match]);
      order.push(groupId);
    }
  }

  const candidates: RelationCandidate[] = [];
  for (const groupId of order) {
    const group = grouped.get(groupId)!;
    // A composite relationship is only complete when every column of the key is
    // covered; a partial match would generate an ON clause missing a predicate.
    const isComposite = groupId.startsWith('composite\u0000');
    if (isComposite) {
      const matched = new Set(group.map((m) => normalizeIdentifier(m.targetColumn)));
      const complete = group[0]!.targetKey.columns.every((column) =>
        matched.has(normalizeIdentifier(column)),
      );
      if (!complete) continue;
    }

    const best = group.reduce((a, b) => (b.score > a.score ? b : a));
    const pairs = group
      .map((m) => ({ left: m.sourceColumn, right: m.targetColumn }))
      .sort((a, b) => (a.left < b.left ? -1 : a.left > b.left ? 1 : 0));

    if (best.score < mediumThreshold) continue;

    const ambiguous = group.some((m) =>
      ambiguousColumns.has(`${m.source.id}\u0000${normalizeIdentifier(m.sourceColumn)}`),
    );

    const evidenceList = best.evidence.slice();
    if (ambiguous) {
      evidenceList.push(
        evidence('ambiguous', 0, 'more than one table matches this column equally well'),
      );
    }

    candidates.push({
      id: candidateId(best.source.id, best.target.id, pairs),
      fromTable: best.source.id,
      toTable: best.target.id,
      columnPairs: pairs,
      score: Math.round(best.score * 1000) / 1000,
      // An ambiguous candidate is never high, whatever it scored.
      tier: !ambiguous && best.score >= highThreshold ? 'high' : 'medium',
      evidence: evidenceList,
      ambiguous,
    });
  }

  return candidates.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
