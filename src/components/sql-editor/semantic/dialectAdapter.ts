import {
  parseQualifiedNameText,
  unquoteBacktick,
  unquoteBracket,
  unquoteDouble,
} from './quoteHelper';
import {
  foldIdentifier,
  needsQuoting,
  wrapQuoted,
} from '../../../lib/sqlDialects/identifierQuoting';
import {
  listBuiltinDialectProfileIds,
  resolveSqlDialectProfile,
} from '../../../lib/sqlDialects/dialectProfile';
import { DB_REGISTRY } from '../../../lib/databaseTypes';
import type { QualifiedRelationId, SqlDialectAdapter } from './types';
import type { ResolvedSqlDialectProfile } from '../../../lib/sqlDialects/types';

function createAdapter(dialectId: string, profile: ResolvedSqlDialectProfile): SqlDialectAdapter {
  const { quoteStyle, foldCase, projectionAliasVisibility, parameterPolicy, reservedKeywords } =
    profile;
  const extraReserved = reservedKeywords
    ? new Set(reservedKeywords.map((k) => k.toLowerCase()))
    : undefined;

  return {
    dialectId,
    quoteStyle,
    foldUnquotedIdentifier: (value) => foldIdentifier(value, foldCase),
    shouldQuoteIdentifier: (value) => needsQuoting(value, quoteStyle, foldCase, extraReserved),
    quoteIdentifier: (value) => {
      if (quoteStyle === 'none') return value;
      return wrapQuoted(value, quoteStyle);
    },
    unquoteIdentifier: (value) => {
      const d = unquoteDouble(value);
      if (d !== null) return d;
      const b = unquoteBacktick(value);
      if (b !== null) return b;
      const br = unquoteBracket(value);
      if (br !== null) return br;
      if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) return value;
      return null;
    },
    parseQualifiedName: (text: string): QualifiedRelationId | null => parseQualifiedNameText(text),
    compareIdentifiers: (a, b) => foldIdentifier(a, foldCase) === foldIdentifier(b, foldCase),
    projectionAliasVisibility,
    parameterPolicy,
  };
}

const adapterCache = new Map<string, SqlDialectAdapter>();

/** Resolve a dialect adapter by dialect id or sqlDialect family string. */
export function getDialectAdapter(dialectId: string): SqlDialectAdapter {
  const key = dialectId.trim().toLowerCase() || 'standard';
  const cached = adapterCache.get(key);
  if (cached) return cached;

  // Profile resolution lives in `lib/sqlDialects` so that relation-key folding
  // is identical everywhere; see `resolveSqlDialectProfile`.
  const adapter = createAdapter(key, resolveSqlDialectProfile(key));
  adapterCache.set(key, adapter);
  return adapter;
}

export function listSupportedDialectIds(): readonly string[] {
  const ids = new Set<string>([...listBuiltinDialectProfileIds(), ...Object.keys(DB_REGISTRY)]);
  return Array.from(ids);
}
