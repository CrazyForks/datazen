import type { KeyEntry } from '@datazen/driver-sdk';
import type { ChildEntry } from '../shared/redisInvoke';

/** Flat row or expandable namespace folder in the key browser. */
export type KeyTreeRow =
  | {
      kind: 'folder';
      path: string;
      label: string;
      depth: number;
      count: number;
      /**
       * `count` is a lower bound: the level that produced this folder has an
       * open scan cursor, so the subtree holds keys not scanned yet (I-4 / D-5
       * renders these as `(n+)` rather than presenting a partial subset as a
       * total).
       */
      partial?: boolean;
      /**
       * Rendered only as a **path breadcrumb** of a row the R2 pattern matched
       * (redis-tree-ui-BUG-001, see `keyTreeFilter.ts`): the folder does not
       * match the pattern itself — it only owns rows that do. Such a row is
       * decoration: not clickable, no checkbox, not counted by
       * `data-row-count`, not part of any selection set.
       */
      breadcrumb?: boolean;
    }
  | { kind: 'key'; entry: KeyEntry; depth: number; label: string };

/**
 * Separator the tree is currently built with (PRD §3.2 R3). One character, and
 * the *caller* supplies it — there is no implicit default any more, because a
 * per-connection preference that silently falls back to `:` makes "the tree
 * re-groups instantly when I change the separator" untestable and untraceable.
 */
export const SEPARATOR_CHOICES = [':', '.', '/'] as const;
export const DEFAULT_SEPARATOR = ':';

/** Server-side default of `list_children` when no `sep` is sent. */
export function separatorsFor(sep: string): string[] {
  return sep ? [sep] : [DEFAULT_SEPARATOR];
}

/** Split a key into namespace segments using the first matching separator. */
export function splitKeyNamespace(key: string, separators: string[]): string[] {
  for (const sep of separators) {
    if (key.includes(sep)) {
      return key.split(sep).filter((s) => s.length > 0);
    }
  }
  return [key];
}

/**
 * Build a flat list of tree rows from key entries.
 * Folders are collapsed unless their path is in `expanded`.
 */
export function buildKeyTreeRows(
  keys: KeyEntry[],
  expanded: Set<string>,
  separators: string[],
): KeyTreeRow[] {
  type Node = {
    label: string;
    path: string;
    children: Map<string, Node>;
    entry?: KeyEntry;
  };

  const root: Node = { label: '', path: '', children: new Map() };

  for (const entry of keys) {
    const parts = splitKeyNamespace(entry.key, separators);
    let node = root;
    let path = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      path = path ? `${path}${separators[0] ?? ':'}${part}` : part;
      const isLeaf = i === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, { label: part, path, children: new Map() });
      }
      const child = node.children.get(part)!;
      if (isLeaf) {
        child.entry = entry;
      }
      node = child;
    }
  }

  const rows: KeyTreeRow[] = [];

  function walk(node: Node, depth: number) {
    const folders = [...node.children.values()].sort((a, b) => a.label.localeCompare(b.label));
    for (const child of folders) {
      const hasChildren = child.children.size > 0;
      if (hasChildren) {
        const count = countLeaves(child);
        rows.push({
          kind: 'folder',
          path: child.path,
          label: child.label,
          depth,
          count,
        });
        if (expanded.has(child.path)) {
          walk(child, depth + 1);
        }
      } else if (child.entry) {
        rows.push({
          kind: 'key',
          entry: child.entry,
          depth,
          label: child.label,
        });
      }
    }
  }

  walk(root, 0);
  return rows;
}

function countLeaves(node: { children: Map<string, unknown>; entry?: KeyEntry }): number {
  let n = node.entry ? 1 : 0;
  for (const child of node.children.values()) {
    n += countLeaves(child as { children: Map<string, unknown>; entry?: KeyEntry });
  }
  return n;
}

/**
 * True when `key` lives under `folderPrefix`.
 *
 * Server tree prefixes carry a trailing separator (`app:`), the client-built
 * fallback rows do not (`app`), and *either* may have been produced with a
 * separator other than the one now configured — so a bare `startsWith` would let
 * `app` swallow `apple`. The rule is therefore: the remainder must be non-empty
 * and the boundary must be a separator (the configured one, or any of
 * {@link SEPARATOR_CHOICES} for a prefix folded before the preference changed).
 */
export function keyUnderFolder(key: string, folderPrefix: string, sep?: string): boolean {
  if (!key.startsWith(folderPrefix)) return false;
  const rest = key.slice(folderPrefix.length);
  if (rest.length === 0) return false;
  if (ANY_SEPARATOR_CHAR.test(folderPrefix[folderPrefix.length - 1] ?? '')) return true;
  return rest[0] === sep || ANY_SEPARATOR_CHAR.test(rest[0] ?? '');
}

/** Strip every separator this module can be asked to group on. */
const ANY_SEPARATOR = /[:./]+$/;
const ANY_SEPARATOR_CHAR = /[:./]/;

/**
 * Last namespace segment of a full key or folder prefix (for row labels).
 *
 * `sep` is the configured grouping separator and gets the first say, but the
 * scan can hand back a prefix built with another separator (server default `:`,
 * per-connection override), so the fallback still recognises every char in
 * {@link SEPARATOR_CHOICES} rather than mis-labelling `a.b.c` as one segment.
 */
export function folderLabel(prefix: string, sep?: string): string {
  const trimmed = prefix.replace(ANY_SEPARATOR, '');
  const configured = sep && sep.length > 0 ? trimmed.lastIndexOf(sep) : -1;
  let last = configured;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (ANY_SEPARATOR_CHAR.test(trimmed[i]!)) {
      last = Math.max(last, i);
      break;
    }
  }
  return last >= 0 ? trimmed.slice(last + 1) : trimmed;
}

function childToKeyEntry(child: Extract<ChildEntry, { kind: 'key' }>): KeyEntry {
  return {
    key: child.key,
    keyType: child.keyType,
    ttl: child.ttl,
    size: child.logicalLen,
    preview: '',
  };
}

/**
 * Flatten server-driven `list_children` levels into tree rows. Folders render
 * with an estimated count (`n+`) unless their level is `done`; expanded folders
 * recurse into their cached level.
 *
 * `partial` comes from the *parent* level's cursor, not the folder's own state:
 * an unexpanded folder's count is whatever the parent scan had accumulated when
 * it met the key, so a still-scanning parent can only ever under-report (I-4).
 */
export function buildServerTreeRows(
  levels: Record<string, { children: ChildEntry[]; done: boolean }>,
  expanded: Set<string>,
  sep?: string,
  prefix = '',
  depth = 0,
): KeyTreeRow[] {
  const level = levels[prefix];
  if (!level) return [];
  const rows: KeyTreeRow[] = [];
  const partial = !level.done;
  for (const child of level.children) {
    if (child.kind === 'folder') {
      rows.push({
        kind: 'folder',
        path: child.prefix,
        label: folderLabel(child.prefix, sep),
        depth,
        count: child.count,
        ...(partial ? { partial: true } : {}),
      });
      if (expanded.has(child.prefix)) {
        rows.push(...buildServerTreeRows(levels, expanded, sep, child.prefix, depth + 1));
      }
    } else {
      rows.push({
        kind: 'key',
        entry: childToKeyEntry(child),
        depth,
        label: folderLabel(child.key, sep),
      });
    }
  }
  return rows;
}

/**
 * Flat ("列表") rows for R3's view switch: every loaded key at depth 0 with its
 * *full* name as the label, i.e. no grouping at all. Same row spec and same
 * selection semantics as the tree — only the namespace folding is turned off,
 * which is what makes it the escape hatch for keys whose names contain the
 * configured separator.
 */
export function buildFlatTreeRows(keys: KeyEntry[]): KeyTreeRow[] {
  return keys.map((entry) => ({ kind: 'key', entry, depth: 0, label: entry.key }));
}

export const KEY_TYPE_FILTERS = [
  { value: 'all', labelKey: 'redis.typeAll' },
  { value: 'string', labelKey: 'redis.typeString' },
  { value: 'hash', labelKey: 'redis.typeHash' },
  { value: 'list', labelKey: 'redis.typeList' },
  { value: 'set', labelKey: 'redis.typeSet' },
  { value: 'zset', labelKey: 'redis.typeZset' },
  { value: 'stream', labelKey: 'redis.typeStream' },
] as const;
