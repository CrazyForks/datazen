#!/usr/bin/env bash
# Sabotage harness.
#
# Each mutation breaks exactly ONE product behaviour in a *product* file and
# asserts that a named test goes red. A mutation that leaves the suite green is
# a test that proves nothing, so those are reported as failures of the harness.
#
# The `@@` separator splits old text from new text; neither side may contain it.
# Every mutation is a valid, compiling change so a red test means "the behaviour
# is asserted", not "the module failed to parse".
#
# Usage: bash scripts/sabotage-history.sh
set -uo pipefail
cd "$(dirname "$0")/.."

FILES=(
  src/components/history/historyQuery.ts
  src/components/history/GlobalQueryHistoryDialog.tsx
  src/components/history/HistoryEntryCard.tsx
)
BACKUP=$(mktemp -d)
for f in "${FILES[@]}"; do
  mkdir -p "$BACKUP/$(dirname "$f")"
  cp "$f" "$BACKUP/$f"
done
RESTORE() { [ -d "$BACKUP" ] || return 0; for f in "${FILES[@]}"; do cp "$BACKUP/$f" "$f"; done; }
trap RESTORE EXIT

pass=0
fail=0

# $1 label, $2 file, $3 "old@@new", rest: test file globs
sabotage() {
  local label="$1" file="$2" edit="$3" SUITE="$4"
  shift 4
  RESTORE
  local old="${edit%%@@*}" new="${edit#*@@}"
  if ! grep -qF -- "$old" "$file"; then
    echo "  ⚠️  $label :: 锚点未命中,无法破坏 —— $file"
    fail=$((fail + 1))
    return
  fi
  OLD="$old" NEW="$new" TARGET="$file" python3 - <<'PY'
import os
p, old, new = os.environ['TARGET'], os.environ['OLD'], os.environ['NEW']
s = open(p, encoding='utf-8').read()
assert old in s, "anchor vanished"
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
  local out
  out=$(npx vitest run "$SUITE" 2>&1)
  if echo "$out" | grep -qE "Tests +[0-9]+ failed"; then
    local n
    n=$(echo "$out" | grep -oE "Tests +[0-9]+ failed" | head -1)
    printf '  ✅ %-46s %s\n' "$label" "$n"
    pass=$((pass + 1))
  else
    echo "  ❌ $label  —— 破坏后仍然全绿,该测试无效"
    echo "$out" | tail -4 | sed 's/^/       /'
    fail=$((fail + 1))
  fi
}

H=src/components/history/__tests__
# One directory filter: vitest 4 concatenates multiple positional args into a
# single filter, which then matches nothing and looks like a green run.
D="$H"

echo "── C: 如实披露截断 ──"
sabotage "isTruncated 恒假" src/components/history/historyQuery.ts \
  'return page.total > page.entries.length;@@return false;' "$D"
sabotage "提示里的 total 谎报为 shown" src/components/history/historyQuery.ts \
  '{ shown: page.entries.length, total: page.total }@@{ shown: page.total, total: page.total }' "$D"

echo "── 筛选透传到后端 ──"
sabotage "search 不再发送" src/components/history/historyQuery.ts \
  'search: search ? search : null,@@search: null,' "$D"
sabotage "since 恒为 undefined" src/components/history/historyQuery.ts \
  'return new Date(now.getTime() - days * 86_400_000).toISOString();@@return undefined;' "$D"
sabotage "sort 恒为 recent" src/components/history/historyQuery.ts \
  'order: state.sort,@@order: "recent",' "$D"
sabotage "status 筛选失效" src/components/history/historyQuery.ts \
  "if (status === 'failed') return entries.filter((e) => !e.success);@@if (status === 'failed') return entries;" "$D"

echo "── B: 单条删除 / 收藏 / 导出 ──"
sabotage "单条删除误用清空全部" src/components/history/GlobalQueryHistoryDialog.tsx \
  'await queryCommands.deleteQueryHistoryEntry(entry.id);@@await queryCommands.clearQueryHistory();' "$H/GlobalQueryHistoryDialog.test.tsx"
sabotage "收藏桥接传空 sql" src/components/history/GlobalQueryHistoryDialog.tsx \
  'addFavoriteQuery(entry.connectionId, name, entry.sql)@@addFavoriteQuery(entry.connectionId, name, "")' "$H/GlobalQueryHistoryDialog.test.tsx"
sabotage "导出丢弃语句正文" src/components/history/historyQuery.ts \
  "return parts.join('\n');@@return parts.filter((p) => p.startsWith('--')).join('\n');" "$D"
sabotage "取消保存也报成功" src/components/history/GlobalQueryHistoryDialog.tsx \
  "if (wrote) setNotice(t('query.historyExported', { count: chosen.length }));@@setNotice(t('query.historyExported', { count: chosen.length }));" "$H/GlobalQueryHistoryDialog.test.tsx"

echo
RESTORE
echo "── 还原校验 (逐字节) ──"
for f in "${FILES[@]}"; do
  if cmp -s "$f" "$BACKUP/$f"; then
    echo "  ✅ $f"
  else
    echo "  ❌ $f 与破坏前不一致"
    fail=$((fail + 1))
  fi
done
echo
echo "结果: $pass 项破坏成功变红, $fail 项异常"
RESTORE
rm -rf "$BACKUP"
trap - EXIT
exit $((fail > 0 ? 1 : 0))
