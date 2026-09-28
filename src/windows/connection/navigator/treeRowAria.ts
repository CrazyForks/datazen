import { TREE_TOP_LEVEL, ariaLevelOf, type VirtualTreeItemAria } from '@datazen/ui';
import type { UnifiedRow } from './types';

/**
 * The navigator's ARIA, in one place.
 *
 * This used to be spelled out eleven times inside `NavigatorTreeRow` — once per
 * row variant — and every spelling was a place where "is this row a branch?"
 * could be answered differently. Two rules are worth naming, because both look
 * like omissions and are not:
 *
 * 1. **`aria-level` is the announced depth, not the painted one.** Under a
 *    search the builder shifts `levelDepth` one rung up (the group header that
 *    used to sit between them is gone), while `paddingLeft` keeps following
 *    `depth`. The two numbers are deliberately *not* harmonised: the indent is
 *    what the eye follows, the level is what the screen reader announces, and
 *    `ariaLevelOf` is the only conversion between them.
 * 2. **A leaf has no `aria-expanded` at all.** Not `false` — absent. A
 *    `false` on a row with no child list tells assistive tech the node is
 *    collapsed and therefore activatable, which is a lie about a table.
 *    "Does this row own a child list" is row-model knowledge, so the answer
 *    lives here rather than being defaulted by the shared shell.
 *
 * `empty-group` and `no-connections` are *decoration*: a hint block, not a
 * tree item, and they get no role and no level at all.
 */
export function navigatorRowAria(row: UnifiedRow): VirtualTreeItemAria | null {
  switch (row.type) {
    case 'section':
    case 'group':
      // The roots: there is no parent rung above them, so they announce at
      // `TREE_TOP_LEVEL` exactly as they always did.
      return { role: 'treeitem', 'aria-level': TREE_TOP_LEVEL, 'aria-expanded': row.expanded };

    case 'connection':
      return {
        role: 'treeitem',
        'aria-level': ariaLevelOf(row),
        'aria-expanded': connectionExpandedState(row),
      };

    case 'db':
    case 'schema':
    case 'category':
      return { role: 'treeitem', 'aria-level': ariaLevelOf(row), 'aria-expanded': row.expanded };

    case 'namespace-node':
      return { role: 'treeitem', 'aria-level': ariaLevelOf(row), 'aria-expanded': row.expanded };

    case 'table':
    case 'object':
    case 'kv-db':
    case 'db-loading':
      return { role: 'treeitem', 'aria-level': ariaLevelOf(row) };

    case 'empty-group':
    case 'no-connections':
      return null;
  }
}

/**
 * Whether a connection row may disclose a child list.
 *
 * Only a connected or connecting connection owns one. An idle or failed
 * connection has nothing to expand, and `aria-expanded` on it would offer the
 * user a disclosure that does nothing. The chevron button and the treeitem both
 * read this, which is why it is a function and not an inline ternary.
 */
export function connectionExpandedState(row: Extract<UnifiedRow, { type: 'connection' }>) {
  return row.status === 'connected' || row.status === 'connecting' ? row.expanded : undefined;
}

/** Branch probe for the shared shell: does this row own a child list? */
export function isNavigatorBranch(row: UnifiedRow): boolean {
  switch (row.type) {
    case 'section':
    case 'group':
    case 'connection':
      return true;
    case 'db':
    case 'schema':
    case 'category':
      return true;
    case 'namespace-node':
      return !row.isLeaf;
    default:
      return false;
  }
}
