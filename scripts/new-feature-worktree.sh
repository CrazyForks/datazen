#!/usr/bin/env bash
# new-feature-worktree.sh — 创建并行开发轨道（子代理开发 Playbook 配套脚本）
#
# 用法: scripts/new-feature-worktree.sh <track> [base-branch]
#   <track>       轨道名；worktree 固定落在主检出的 .worktrees/datazen-<track>，分支 feature/<track>
#   [base-branch] 基分支，默认 main
#
# 主检出解析（**不信任调用方 cwd**，嵌套创建的根因就在这）:
#   1) 由脚本自身位置推导 <script>/..
#   2) 回退：git --git-common-dir 反推（从任意 linked worktree 调用都能回到主检出）
#   3) 两者都不是主检出 → 直接报错退出，绝不嵌套
#
# 自动完成（**每项独立失败，互不影响**）:
#   1. git worktree + 新分支                       【致命】失败即回滚
#   2. node_modules 软链到主检出                    【致命】失败即回滚（禁 pnpm install 的前提）
#   3. resolve-drivers --codegen-only --drivers=basic
#   4. generate-builtin-locales（产出 src/locales/builtinLocales.ts）
#   5. src/extensions/generated-locales.ts 拷贝（**已退役产物**，见下）
#   6. Pro 检出 packages/pro-extensions/sql-editor-pro（local remote 取 productivity/* 分支）
#   7. 拷贝主检出未跟踪的规格文档 / e2e/.env
#   8. tracks/<track>/ 目录
#
# 关于第 5 项 `src/extensions/generated-locales.ts`：
#   它**不是** `src/locales/builtinLocales.ts`（后者由 generate-builtin-locales.mjs 产出，两码事）。
#   驱动 locale 聚合链路的 codegen 已被 `i18n-drivers` 轨删除（docs/development/
#   driver-api-dependency-boundary.md §2.4.3），当前 `src/` `scripts/` `packages/` `e2e/`
#   内生产引用 0 命中，只在开发机上残留这份 gitignored 旧产物。仍然拷贝是为了让新 worktree
#   与开发机保持同一份文件状态，但它已无运行时作用。
#
# 关于第 6 项 Pro 检出（Pro 分支名与宿主分支名不同）:
#   Pro 是**独立 git 仓**、主仓 gitignored（.gitignore: `packages/pro-extensions/`）、
#   **按设计在 worktree 中不存在**。Pro 私有仓 origin 上只有 `main` 与
#   `codex/qb-editor-pro`；`productivity/*` 分支仅存于本地检出 ⇒ 直接按远端 URL
#   `git clone` 拿不到（会报「路径规格 ... 未匹配任何 git 已知文件」）。故此处以
#   **主检出的 Pro 检出作为 local remote** 克隆，其本地分支会一并成为克隆件的
#   `origin/<branch>`。
#   映射规则（可被 DATAZEN_PRO_BRANCH 覆盖）:
#     宿主 feature/<slug>  →  Pro productivity/<slug>  →  Pro feature/<slug>  →  Pro main
#
# 结尾固定输出「环境铺装报告」：逐项列出 铺好了什么 / 没铺成什么+原因 / 怎么手动补 /
# 不补的后果。**不许静默降级**。
#
# 环境变量:
#   DATAZEN_PRO_BRANCH       显式指定 Pro 分支（覆盖上面的映射规则）
#   NEW_WT_ROLLBACK=0        致命失败时不回滚（仅调试；会留下半成品）
#   NEW_WT_FORCE_FAIL=<step>  故障注入钩子（用于验证回滚路径），step 取下列步骤名：
#                            worktree / node_modules / resolve-drivers /
#                            builtin-locales / pro
set -euo pipefail

SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"

TRACK=${1:?usage: new-feature-worktree.sh <track> [base-branch]}
BASE=${2:-main}

# --------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------
die() {
  printf '\n✖ %s\n' "$*" >&2
  exit 1
}

note() { printf '▶ %s\n' "$*"; }

# 故障注入钩子：NEW_WT_FORCE_FAIL 与 $1 相等时让该步骤失败
maybe_fail() {
  if [ "${NEW_WT_FORCE_FAIL:-}" = "$1" ]; then
    printf '!! 故障注入（NEW_WT_FORCE_FAIL=%s）\n' "$1" >&2
    return 1
  fi
  return 0
}

# --------------------------------------------------------------------------
# 主检出解析
# --------------------------------------------------------------------------
# 主检出的特征：根下 .git 是**目录**，且 git-dir == git-common-dir。
# linked worktree 根下的 .git 是**文件**，且 git-dir 指向 .git/worktrees/<name>。
is_main_checkout() {
  local d=$1 gd gcd
  [ -n "$d" ] && [ -d "$d" ] || return 1
  [ -d "$d/.git" ] || return 1
  gd=$(git -C "$d" rev-parse --path-format=absolute --git-dir 2>/dev/null) || return 1
  gcd=$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  [ "$gd" = "$gcd" ]
}

resolve_main_checkout() {
  local cand common
  # 1) 脚本自身位置
  cand="$(cd -- "${SELF_DIR}/.." >/dev/null 2>&1 && pwd -P)"
  if is_main_checkout "$cand"; then printf '%s\n' "$cand"; return 0; fi
  # 2) git common dir 反推（从任意 linked worktree 调用都能回到主检出）
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  if [ -n "$common" ] && [ -d "$common" ]; then
    cand="$(cd -- "${common}/.." >/dev/null 2>&1 && pwd -P)"
    if is_main_checkout "$cand"; then printf '%s\n' "$cand"; return 0; fi
  fi
  return 1
}

MAIN="$(resolve_main_checkout)" || die \
"无法定位主检出。已尝试：① 脚本位置 ${SELF_DIR}/.. ② 当前目录的 git common dir。
本脚本**拒绝**用调用方 cwd 猜主检出（那正是嵌套创建的根因）。
请在主检出下执行本脚本。"

is_main_checkout "$MAIN" || die "解析出的 MAIN 不是主检出: ${MAIN}"

WT="${MAIN}/.worktrees/datazen-${TRACK}"
BRANCH="feature/${TRACK}"
PRO_REL="packages/pro-extensions/sql-editor-pro"
PRO_SRC="${MAIN}/${PRO_REL}"
PRO_DEST="${WT}/${PRO_REL}"

# 最后一道闸：worktree 路径必须落在主检出的 .worktrees 下
case "$WT" in
  "${MAIN}/.worktrees/"*) : ;;
  *) die "内部错误：worktree 路径越界 ${WT}" ;;
esac

if [ "$(pwd -P)" != "$MAIN" ]; then
  note "当前 cwd 不是主检出（$(pwd -P)）；已按脚本自身位置解析 MAIN=${MAIN}，不会嵌套创建。"
fi

# --------------------------------------------------------------------------
# 铺装状态记录
# --------------------------------------------------------------------------
declare -a OK_ITEMS=()
declare -a SK_NAME=() SK_WHY=() SK_MANUAL=() SK_CONS=()

ok() { OK_ITEMS+=("$1"); }

skipped() { # <名称> <原因> <手动补命令> <不补的后果>
  SK_NAME+=("$1")
  SK_WHY+=("$2")
  SK_MANUAL+=("$3")
  SK_CONS+=("$4")
}

# --------------------------------------------------------------------------
# 前置检查 + 前态快照：只回滚本次调用自己造出来的东西
# --------------------------------------------------------------------------
mkdir -p "${MAIN}/.worktrees"

if git -C "$MAIN" worktree list --porcelain | grep -Fqx "worktree ${WT}"; then
  # -F 是必须的：${WT} 含 ${TRACK}（无字符白名单的用户输入），当**正则**解释会出错。
  #   实测：模式 'worktree /a/b.c/d' 命中已登记的 'worktree /a/bXc/d'（假阳性）
  #   实测：${WT} 含 '*' ⇒ 正则不命中该字面路径（假阴性）
  #   实测：${WT} 含 '[' ⇒ grep 报错 exit 2 且 stderr 漏出 'brackets not balanced'
  # 可达性**两侧不同，别把「不可达」读成整类**：
  #   假阳性（第 1 条，需构造一个只在 '.' 位置不同的诱饵 worktree）在本仓库路径形态下
  #     不可达 —— 路径里只有 1 个点。
  #   假阴性（第 2 条）**完全可达，且是这四处里后果最重的**：TRACK 无字符白名单，
  #     而 '$' 是合法 git 分支名与合法目录名 ⇒ track 取名 'zz$' 就会让 L197 漏判，
  #     落到 `elif [ -d ]` 的 `rm -rf`，**整个脏检查被绕过、未提交改动真丢**。
  #     已由构造实验证实：只需 track 改名，无需诱饵、无需并发、无需机器上既有状态。
  # 本处误判后果：对**不存在**的工作区报「已登记」并让用户去清理，脚本拒绝启动。
  die "worktree 已登记: ${WT}
若是上次失败的半成品，先清理：git -C ${MAIN} worktree remove --force ${WT}"
fi
if [ -e "$WT" ]; then
  die "目录已存在但未登记为 worktree: ${WT}
本脚本**不会删除它**（可能包含你的工作）。确认无用后手动处理：rm -rf ${WT}"
fi

PRE_BRANCH_EXISTS=0
git -C "$MAIN" show-ref --verify --quiet "refs/heads/${BRANCH}" && PRE_BRANCH_EXISTS=1

CREATED_WT=0
ROLLBACK_DONE=0
# 1 = worktree 因有未提交改动被**刻意保留**（安全策略；数据完好）。
# 只覆盖这一种成因：它的机制（分支仍被该 worktree 检出 ⇒ git 必然拒绝删除）
# 有独立正向对照实测支撑。worktree remove **失败**的成因**不**用标志表示 ——
# 那条路径改为「先试 branch -D，失败后当场查事实」，见下。
WT_KEPT_DIRTY=0

cleanup_hint() {
  printf '\n手动清理命令（确认无用后再执行）:\n  git -C %s worktree remove --force %s\n  git -C %s branch -D %s\n' \
    "$MAIN" "$WT" "$MAIN" "$BRANCH"
}

rollback() {
  local reason=$1 dirty
  [ "$ROLLBACK_DONE" -eq 1 ] && return 0
  ROLLBACK_DONE=1
  if [ "$CREATED_WT" -eq 1 ]; then
    printf '\n⛔ 致命步骤失败，回滚本次调用创建的半成品（原因: %s）\n' "$reason" >&2
  else
    # CREATED_WT=0 ⇒ worktree 从未创建成功并通过登记自检 ⇒ 本次调用**没有创建过
    # 任何需要回滚的对象**（NEW_WT_FORCE_FAIL=worktree 就在这一步之前炸，实测
    # ${WT} 一个文件都不存在）。此时印「回滚本次调用创建的半成品」是空话。
    printf '\n⛔ 致命步骤失败（原因: %s）\n' "$reason" >&2
    if [ -e "$WT" ]; then
      printf '⚠ worktree 未登记成功，回滚**不碰** %s（可能残留半成品，请人工确认后处理）\n' "$WT" >&2
    else
      printf 'ℹ 本次调用**尚未创建任何内容**（%s 不存在），无半成品可回滚。\n' "$WT" >&2
    fi
  fi

  if [ "$CREATED_WT" -eq 1 ]; then
    # -F 必须，理由同 L146。本处误判后果是四处里**最重**的：假阴性会落到下面的
    # `elif [ -d ]` ⇒ 对一个**仍登记着**的 worktree 执行 `rm -rf`。
    if git -C "$MAIN" worktree list --porcelain | grep -Fqx "worktree ${WT}"; then
      dirty=$(git -C "$WT" status --porcelain 2>/dev/null || true)
      if [ -n "$dirty" ]; then
        WT_KEPT_DIRTY=1
        printf '⚠ worktree 内有改动，**不自动删除**（避免丢失工作）：\n%s\n' "$dirty" >&2
        cleanup_hint >&2
      elif git -C "$MAIN" worktree remove --force "$WT" 2>/dev/null; then
        printf '✔ 已移除 worktree %s\n' "$WT" >&2
      else
        printf '⚠ worktree remove 失败，目录可能残留：%s\n' "$WT" >&2
        cleanup_hint >&2
      fi
    elif [ -d "$WT" ]; then
      # 未登记在 git worktree list 的裸目录 —— 正是「落在错误分支上」的半成品形态
      printf '✔ 已删除未登记的半成品目录 %s\n' "$WT" >&2
      rm -rf "$WT"
    fi
  fi

  if [ "$PRE_BRANCH_EXISTS" -eq 0 ] && git -C "$MAIN" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    if [ "$WT_KEPT_DIRTY" -eq 1 ]; then
      # 分支仍被上面那个「有改动因而保留」的 worktree 检出 ⇒ git 必然拒绝删除它
      # （实测：未跟踪文件与已跟踪文件被改两种脏形态下，worktree 与分支都完整留存）。
      # 刻意**不**再跑 branch -D：跑它只会让 git 拒绝，然后把**安全策略的必然结果**
      # 印成「删除失败，请手动删除」，读起来像回滚出了岔子 —— 那会诱导人手工
      # rm -rf，而那才是真正丢数据的一步。
      printf 'ℹ 分支 %s **未删除**：它仍被上面那个「有改动因而保留」的 worktree 检出，git 必然拒绝删除。\n' "$BRANCH" >&2
      printf '  这是**预期行为**，不是回滚失败：你的改动一条都没丢，也**不要**用 rm -rf 绕过。\n' >&2
      printf '  确认这些改动无用后，按上面「手动清理命令」的两条**按序**执行即可。\n' >&2
    elif git -C "$MAIN" branch -D "$BRANCH" >/dev/null 2>&1; then
      printf '✔ 已删除本次创建的分支 %s\n' "$BRANCH" >&2
    else
      # 删不掉时**当场查事实**，不预判成因 —— 这里刻意**不**写「因为 worktree 还在
      # 检出该分支所以 git 拒绝」：实测证明不同成因给出**相反**的事实。
      #   成因 A：worktree 被 git worktree lock 锁住 ⇒ remove 报「无法删除一个锁定
      #     的工作区」exit 128，worktree **仍在** worktree list 里，branch -D 被拒。
      #   成因 B：worktree 内有被 .gitignore 忽略的**不可删**目录 ⇒ remove 报
      #     Permission denied exit 255，git **已把它从 worktree list 摘掉**
      #     （目录残留但登记没了），此时 branch -D 反而**能**成功。
      # 成因 B 下若照基线继续跑 branch -D，分支会被正常删掉（基线行为）—— 既然
      # 删得掉就没什么要解释的；只有删不掉时，下面才按**实测到的**登记状态措辞。
      # -F 必须，理由同 L146。本处误判后果：假阳性会把诱饵当成本体，**直接对用户
      # 断言一句为假的事实**（并抑制下面「原因未确定」的兜底）；假阴性则退到兜底，
      # 诚实但不够具体。
      if git -C "$MAIN" worktree list --porcelain | grep -Fqx "worktree ${WT}"; then
        printf '⚠ 分支 %s **未删除**：worktree %s 仍在 git worktree 登记中。\n' "$BRANCH" "$WT" >&2
        printf '  请按上面「手动清理命令」的两条**按序**执行。\n' >&2
      else
        printf '⚠ 分支 %s **未删除**：worktree 已不在 git worktree 登记中，git 仍拒绝删除该分支。\n' "$BRANCH" >&2
        printf '  原因**未确定**（若上方提示目录残留，请先人工确认那个目录再处理）。\n' >&2
        printf '  请自行排查后，再按上面「手动清理命令」的两条**按序**执行。\n' >&2
      fi
    fi
  elif [ "$PRE_BRANCH_EXISTS" -eq 1 ]; then
    printf 'ℹ 分支 %s 在本次调用前就已存在，**未删除**\n' "$BRANCH" >&2
  fi
  printf '回滚结束。\n\n' >&2
}

on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$CREATED_WT" -eq 1 ]; then
    if [ "$ROLLBACK_DONE" -eq 0 ] && [ "${NEW_WT_ROLLBACK:-1}" != "0" ]; then
      rollback "脚本以非零码 ${rc} 退出（未处理的失败）"
    elif [ "${NEW_WT_ROLLBACK:-1}" = "0" ]; then
      printf '\n⚠ NEW_WT_ROLLBACK=0：以下为半成品，清理命令：\n  git -C %s worktree remove --force %s\n  git -C %s branch -D %s\n' \
        "$MAIN" "$WT" "$MAIN" "$BRANCH" >&2
    fi
  fi
  exit "$rc"
}
trap on_exit EXIT

critical_fail() {
  printf '\n✖ %s\n' "$1" >&2
  if [ "${NEW_WT_ROLLBACK:-1}" = "0" ]; then
    printf '\n⚠ NEW_WT_ROLLBACK=0：保留半成品。清理命令：\n  git -C %s worktree remove --force %s\n  git -C %s branch -D %s\n' \
      "$MAIN" "$WT" "$MAIN" "$BRANCH" >&2
    exit 1
  fi
  rollback "$1"
  exit 1
}

# --------------------------------------------------------------------------
# 步骤 1：worktree + 分支（致命）
# --------------------------------------------------------------------------
note "创建 worktree ${WT}（分支 ${BRANCH}，基于 ${BASE}）"
maybe_fail "worktree" || critical_fail "worktree 创建（故障注入）"
if [ "$PRE_BRANCH_EXISTS" -eq 1 ]; then
  git -C "$MAIN" worktree add "$WT" "$BRANCH" || critical_fail "worktree add 失败"
  ok "worktree ${WT} @ ${BRANCH}（分支**本次调用前已存在**，已复用；回滚时不会删它）"
else
  git -C "$MAIN" worktree add -b "$BRANCH" "$WT" "$BASE" || critical_fail "worktree add -b 失败"
  ok "worktree ${WT} @ ${BRANCH}（新建，基于 ${BASE}）"
fi
CREATED_WT=1

# 落地自检：必须真的登记在 worktree list 里，且分支正确
# -F 必须，理由同 L146。本处误判后果：假阴性 ⇒ 对刚建好的 worktree 报
# 「未登记进 git worktree list（半成品）」并触发回滚（而回滚那处同样会误判，
# 见 L190 的说明）。
grep -Fqx "worktree ${WT}" < <(git -C "$MAIN" worktree list --porcelain) \
  || critical_fail "worktree 未登记进 git worktree list（半成品）"
_actual_branch=$(git -C "$WT" branch --show-current 2>/dev/null || true)
[ "$_actual_branch" = "$BRANCH" ] \
  || critical_fail "worktree 落在错误分支上（实际 ${_actual_branch:-<未知>}，期望 ${BRANCH}）"
ok "登记自检通过：git worktree list 命中且 HEAD = ${BRANCH}"

# --------------------------------------------------------------------------
# 步骤 2：node_modules 软链（致命）
# --------------------------------------------------------------------------
note "node_modules 软链（禁 pnpm install，各 worktree 靠软链）"
maybe_fail "node_modules" || critical_fail "node_modules 软链（故障注入）"
if [ -L "${WT}/node_modules" ]; then
  ok "node_modules 已是软链：$(readlink "${WT}/node_modules")"
elif [ -e "${WT}/node_modules" ]; then
  skipped "node_modules 软链" "目标已是实体目录（不是软链）" \
    "rm -rf ${WT}/node_modules && ln -s ${MAIN}/node_modules ${WT}/node_modules" \
    "依赖解析走 worktree 内的实体目录，与主检出可能版本漂移；宿主测试可能整体失败。"
else
  ln -s "${MAIN}/node_modules" "${WT}/node_modules" || critical_fail "node_modules 软链失败"
  ok "node_modules → ${MAIN}/node_modules"
fi

# --------------------------------------------------------------------------
# 步骤 3：三层 codegen（各自独立失败）
# --------------------------------------------------------------------------
note "第 1 层 codegen：resolve-drivers --codegen-only --drivers=basic"
if maybe_fail "resolve-drivers" \
  && ( cd "$WT" && node scripts/resolve-drivers.mjs --codegen-only --drivers=basic ) >/dev/null 2>&1; then
  ok "generated.ts / driver_init.rs / .driver-features.json / generated-pro.ts / capabilities/default.json"
else
  skipped "第 1 层 codegen（resolve-drivers）" "命令非零退出或被故障注入" \
    "cd ${WT} && node scripts/resolve-drivers.mjs --codegen-only --drivers=basic" \
    "src/extensions/generated.ts 等缺失 → 前端 DB_REGISTRY 为空、驱动相关用例大面积失败（与你的改动无关）。"
fi

note "第 2 层 codegen：generate-builtin-locales（产出 src/locales/builtinLocales.ts）"
if maybe_fail "builtin-locales" \
  && ( cd "$WT" && node scripts/generate-builtin-locales.mjs ) >/dev/null 2>&1; then
  ok "src/locales/builtinLocales.ts（宿主内置词条，**不是** generated-locales.ts）"
else
  skipped "第 2 层 codegen（generate-builtin-locales）" "命令非零退出或被故障注入" \
    "cd ${WT} && node scripts/generate-builtin-locales.mjs" \
    "src/locales/builtinLocales.ts 缺失 → i18n 用例与 tsc 失败（与你的改动无关）。"
fi

note "第 3 层 codegen：src/extensions/generated-locales.ts（从主检出拷贝）"
GL_MAIN="${MAIN}/src/extensions/generated-locales.ts"
GL_WT="${WT}/src/extensions/generated-locales.ts"
if [ -f "$GL_MAIN" ]; then
  mkdir -p "$(dirname "$GL_WT")"
  if cp "$GL_MAIN" "$GL_WT" 2>/dev/null; then
    ok "src/extensions/generated-locales.ts（拷贝自主检出；**已退役产物**，当前无生产引用）"
  else
    skipped "第 3 层 codegen（generated-locales.ts）" "拷贝失败" \
      "cp ${GL_MAIN} ${GL_WT}" \
      "该文件当前**无生产引用**，缺失不产生运行时失败；仅当你的分支恢复驱动 locale 聚合时才有影响。"
  fi
else
  skipped "第 3 层 codegen（generated-locales.ts）" "主检出也不存在（该产物已被 i18n-drivers 轨退役）" \
    "（通常无需补；若你的分支仍在产出它：cd ${WT} && node scripts/resolve-drivers.mjs --codegen-only --drivers=all）" \
    "该文件当前**无生产引用**（src/ scripts/ packages/ e2e/ 内 0 命中），缺失不产生失败。**不要**把它与 src/locales/builtinLocales.ts 混为一谈。"
fi

# --------------------------------------------------------------------------
# 步骤 4：Pro 检出（独立失败 + 优雅降级）
# --------------------------------------------------------------------------
# 统计「读 Pro manifest」的用例数，让后果文案不写死数字
count_pro_manifest_tests() {
  local f="${WT}/packages/extension-points/src/__tests__/security.test.ts" n
  [ -f "$f" ] || { printf '0'; return 0; }
  # 模式是**字面常量**（无变量插值），但意图明显是子串字面匹配 ⇒ 同样加 -F，
  # 免得 3 个 '.' 变成通配符。此处误判后果仅为**计数**失真（报「0 条」），
  # 方向保守、不涉及数据安全，优先级低于上面四处。
  grep -Fq 'pro-extensions/sql-editor-pro/manifest.json' "$f" || { printf '0'; return 0; }
  n=$(awk '
    /describe\(.*EXTENSION_POINTS_VERSION/ { inblk = 1 }
    inblk && /^  it\(/ { if (buf ~ /readProManifest/) c++; buf = $0 "\n"; next }
    inblk { buf = buf $0 "\n" }
    END { printf "%d", c + 0 }
  ' "$f")
  printf '%s' "${n:-0}"
}

read_host_ep_version() {
  local f="${WT}/packages/extension-points/src/security.ts" v
  [ -f "$f" ] || { printf ''; return 0; }
  v=$(sed -n "s/^export const EXTENSION_POINTS_VERSION = '\([^']*\)'.*/\1/p" "$f" | head -1)
  printf '%s' "$v"
}

# Pro 侧 manifest 声明的 extensionPointsVersion（读不到就返回空串）
read_pro_ep_version() {
  local f="$1/manifest.json"
  [ -f "$f" ] || { printf ''; return 0; }
  node -e 'try{const m=require(process.argv[1]);process.stdout.write(String((m.engines||{}).extensionPointsVersion||""))}catch(e){}' "$f" 2>/dev/null || printf ''
}

# 契约版本交叉核对：Pro 落在 main（ep 1.0.0）上会让 1.0.0 manifest 撞上 1.1.0 宿主。
# **两条路径都必须做，判定与措辞都收敛到这里**：
#   实测（修前）：核对只挂在克隆路径上。Pro 检出**已存在**（跳过克隆）时，
#   同一处版本不匹配会让报告**零条 ⚠** —— 用户看到一条 ✅ 且带着
#   manifest extensionPointsVersion=1.0.0，却没有任何一处说它和宿主 1.1.0 对不上；
#   而 security.test.ts 的「the Pro manifest declares the same version」照样
#   **断言失败**（不是 ENOENT）。有无其他环节兜住：没有（实测）。
#   共用一份文案 ⇒ 两条路径对同一处不匹配给出同一个 ⚠，读起来是同一个问题。
#   $1 = Pro 检出目录；$2 = 措辞里指代 Pro 分支的名字（两条路径各自的真实分支）
#
# 关于「读不到」：修前克隆路径把「读不到」和「一致」并进同一个 else，印出
# 「Pro/宿主 EP 契约版本一致：<未声明> = 1.1.0」—— 实测（预存 Pro 无 manifest.json
# / manifest.json 为空两种夹具）这行既自相矛盾又是对用户**断言了一句为假的话**。
# 直接把这段照搬给预存路径，等于把该缺陷复制到一条原本静默的路径上 ⇒ 这里拆成三态。
# 注意：「读不到」**不算**不一致，因此这里只出一条 ✅，不制造 ⚠ 噪声。
check_ep_contract() {
  local dir=$1 label=$2 pro_ep host_ep
  pro_ep=$(read_pro_ep_version "$dir")
  host_ep=$(read_host_ep_version)
  if [ -n "$host_ep" ] && [ -n "$pro_ep" ] && [ "$host_ep" != "$pro_ep" ]; then
    skipped "Pro/宿主 EP 契约版本一致性" "Pro ${label} 的 manifest 声明 extensionPointsVersion=${pro_ep}，宿主 security.ts 为 ${host_ep}" \
      "cd ${dir} && git log --oneline -5 manifest.json   # 找一个已同步的 Pro 分支后 git -C ${dir} checkout <那个分支>" \
      "packages/extension-points/src/__tests__/security.test.ts 的「the Pro manifest declares the same version」会**断言失败**（不是 ENOENT），极易被误记为自己的缺陷。"
  elif [ -n "$host_ep" ] && [ -n "$pro_ep" ]; then
    ok "Pro/宿主 EP 契约版本一致：${pro_ep} = ${host_ep}"
  else
    ok "Pro/宿主 EP 契约版本**未核对**（读不到即无法断言一致）：Pro=${pro_ep:-<未声明>} 宿主=${host_ep:-<未声明>}"
  fi
}

PRO_N=$(count_pro_manifest_tests)
if [ "$PRO_N" -gt 0 ]; then
  PRO_CONSEQUENCE="packages/extension-points/src/__tests__/security.test.ts 中读取该 manifest 的 ${PRO_N} 个用例会 ENOENT 失败（ENOENT: .../${PRO_REL}/manifest.json）——该失败与你的改动无关，请勿记为缺陷。"
else
  PRO_CONSEQUENCE="本分支没有读取该 manifest 的用例，暂无已知测试后果；但 scripts/pack-ep.mjs / scripts/resolve-pro.mjs 的 pro 打包路径不可用。"
fi

PRO_MANUAL="git clone ${PRO_SRC} ${PRO_DEST}
# 主检出无 Pro 检出时改用远端（注意：远端只有 main / codex/qb-editor-pro，取不到 productivity/*）：
#   git clone git@github.com:flyxl/datazen-extension-sql-editor-pro.git ${PRO_DEST}
#   git -C ${PRO_DEST} fetch <某个已有 productivity/* 的本地检出> '+refs/heads/*:refs/remotes/local/*'
git -C ${PRO_DEST} checkout <pro-branch>"

note "Pro 检出（独立 git 仓，主仓 gitignored，按设计在 worktree 中不存在）"
if [ -e "$PRO_DEST" ]; then
  _pro_exist_branch=$(git -C "$PRO_DEST" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  _pro_exist_ep=$(read_pro_ep_version "$PRO_DEST")
  ok "Pro 检出已存在：${PRO_DEST}（跳过克隆；分支 ${_pro_exist_branch:-<未知>}，manifest extensionPointsVersion=${_pro_exist_ep:-<未声明>}）"
  # 预存检出与克隆件是**同一个** EP 契约版本问题 ⇒ 用同一个核对、同一份措辞。
  # 跳过克隆不代表版本就对：预存检出停在未同步的分支上时，报告同样必须把它推进「⚠ 未铺成」。
  check_ep_contract "$PRO_DEST" "${_pro_exist_branch:-<未知>}"
elif maybe_fail "pro" && [ -d "$PRO_SRC/.git" ]; then
  # local remote：主检出的 Pro 检出持有 productivity/* 等**仅本地**分支
  _pro_branch="${DATAZEN_PRO_BRANCH:-}"
  if [ -z "$_pro_branch" ]; then
    for _cand in "productivity/${TRACK}" "feature/${TRACK}" "main"; do
      if git -C "$PRO_SRC" show-ref --verify --quiet "refs/heads/${_cand}"; then
        _pro_branch="$_cand"
        break
      fi
    done
  fi
  if [ -z "$_pro_branch" ]; then
    skipped "Pro 检出" "源仓 ${PRO_SRC} 中不存在 productivity/${TRACK} / feature/${TRACK} / main" \
      "${PRO_MANUAL}（也可用 DATAZEN_PRO_BRANCH=<pro-branch> 显式指定）" \
      "$PRO_CONSEQUENCE"
  elif git clone --quiet --no-hardlinks "$PRO_SRC" "$PRO_DEST" 2>/dev/null \
    && git -C "$PRO_DEST" checkout --quiet "$_pro_branch" 2>/dev/null; then
    # 铺装成功 ≠ 版本正确：Pro 落在 main（ep 1.0.0）上时，克隆/checkout 依然成功，
    # 紧接着的版本交叉核对却会把它推进「⚠ 未铺成」。不标版本，读者会看到同一个
    # Pro 检出同时出现在 ✅ 与 ⚠ 两处而以为报告自相矛盾。⇒ 在 ✅ 条目上标出
    # 分支与 manifest 的 extensionPointsVersion，让两处指向同一个值。
    _pro_ep=$(read_pro_ep_version "$PRO_DEST")
    ok "Pro 检出：${PRO_DEST} @ ${_pro_branch}（从主检出作为 local remote 克隆；manifest extensionPointsVersion=${_pro_ep:-<未声明>}）"
    if [ -n "${DATAZEN_PRO_BRANCH:-}" ]; then
      ok "Pro 分支来源：DATAZEN_PRO_BRANCH 显式指定 = ${_pro_branch}"
    else
      ok "Pro 分支来源：映射规则 宿主 ${BRANCH} → Pro ${_pro_branch}"
    fi
    if [ -d "${PRO_SRC}/node_modules" ] && [ ! -e "${PRO_DEST}/node_modules" ]; then
      if ln -s "${PRO_SRC}/node_modules" "${PRO_DEST}/node_modules" 2>/dev/null; then
        ok "Pro node_modules → ${PRO_SRC}/node_modules"
      else
        skipped "Pro node_modules 软链" "ln 失败" \
          "ln -s ${PRO_SRC}/node_modules ${PRO_DEST}/node_modules" \
          "Pro 自身测试（pnpm test:pro）无法解析依赖；宿主测试不受影响。"
      fi
    else
      skipped "Pro node_modules 软链" "源 Pro 检出没有 node_modules，或目标已存在" \
        "cd ${PRO_SRC} && npm install   # 仅 Pro 仓；宿主 worktree 仍靠根级软链" \
        "Pro 自身测试（pnpm test:pro）无法解析依赖；宿主测试不受影响。"
    fi
    check_ep_contract "$PRO_DEST" "$_pro_branch"
  else
    skipped "Pro 检出" "从 ${PRO_SRC} 克隆或 checkout ${_pro_branch} 失败（磁盘/权限/仓库损坏）" \
      "$PRO_MANUAL" \
      "$PRO_CONSEQUENCE"
  fi
else
  skipped "Pro 检出" "主检出没有 Pro 检出（${PRO_SRC} 非 git 仓），或被故障注入" \
    "$PRO_MANUAL" \
    "$PRO_CONSEQUENCE"
fi

# --------------------------------------------------------------------------
# 步骤 5：规格文档 / e2e/.env / tracks 目录
# --------------------------------------------------------------------------
note "拷贝主检出未跟踪的规格文档（保持未跟踪，禁止 git add）"
_doc_n=0
while IFS= read -r f; do
  rel="${f#"${MAIN}/"}"
  rel="${rel%/}"
  src="${MAIN}/${rel}"
  dest="${WT}/${rel}"
  if [ -d "$src" ]; then
    mkdir -p "$(dirname "$dest")"
    cp -R "$src" "$(dirname "$dest")/" && _doc_n=$((_doc_n + 1))
  elif [ -f "$src" ]; then
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest" && _doc_n=$((_doc_n + 1))
  fi
done < <(git -C "$MAIN" status --porcelain docs/development | awk '$1=="??"{print $2}')
if [ "$_doc_n" -gt 0 ]; then
  ok "未跟踪规格文档 ${_doc_n} 项（保持未跟踪，**禁止 git add**）"
else
  ok "主检出无未跟踪规格文档（无需拷贝）"
fi

if [ -f "${MAIN}/e2e/.env" ]; then
  if cp "${MAIN}/e2e/.env" "${WT}/e2e/.env" 2>/dev/null; then
    ok "e2e/.env 已拷贝"
  else
    skipped "e2e/.env" "拷贝失败" "cp ${MAIN}/e2e/.env ${WT}/e2e/.env" \
      "E2E 缺环境变量；Host 单测不受影响。"
  fi
else
  ok "主检出无 e2e/.env（无需拷贝）"
fi

note "coordination tracks 目录（方案 B：禁止修改或软链 hub.md）"
mkdir -p "${WT}/docs/development/coordination/tracks/${TRACK}"
ok "docs/development/coordination/tracks/${TRACK}/"

# --------------------------------------------------------------------------
# 环境铺装报告
# --------------------------------------------------------------------------
BAR="════════════════════════════════════════════════════════════════════"
printf '\n%s\n' "$BAR"
printf '  环境铺装报告 / ENVIRONMENT PROVISIONING REPORT\n'
printf '  worktree : %s\n' "$WT"
printf '  分支     : %s（基于 %s）\n' "$BRANCH" "$BASE"
printf '  主检出   : %s\n' "$MAIN"
printf '%s\n' "$BAR"

printf '\n✅ 已铺好（%d 项）\n' "${#OK_ITEMS[@]}"
if [ "${#OK_ITEMS[@]}" -eq 0 ]; then
  printf '   （无）\n'
else
  printf '   • %s\n' "${OK_ITEMS[@]}"
fi

if [ "${#SK_NAME[@]}" -eq 0 ]; then
  printf '\n⚠ 未铺成：0 项 —— 轨道开箱即用。\n'
else
  printf '\n⚠ 未铺成（%d 项）—— **开箱不再完全即用**，逐项处置如下：\n' "${#SK_NAME[@]}"
  _i=0
  while [ "$_i" -lt "${#SK_NAME[@]}" ]; do
    printf '\n   [%d] %s\n' "$((_i + 1))" "${SK_NAME[$_i]}"
    printf '       原因    : %s\n' "${SK_WHY[$_i]}"
    printf '       手动补  :\n'
    printf '%s\n' "${SK_MANUAL[$_i]}" | sed 's/^/                /'
    printf '       不补后果: %s\n' "${SK_CONS[$_i]}"
    _i=$((_i + 1))
  done
fi

printf '\n%s\n' "$BAR"
printf '轨道就绪。代理简报必须写明:\n'
printf '  - 工作目录 %s（禁止修改主检出与其他 worktree）\n' "$WT"
printf '  - 环境注意三件套: Grep 工具搜索(禁 bash 全仓 grep) / CARGO_TARGET_DIR 策略 / 禁 add 未跟踪文档\n'
printf '  - 进度管理: 维护 tracks/%s/progress.md，禁止修改或提交 hub.md\n' "$TRACK"
printf '  - 活性与死亡恢复协议见 docs/development/subagent/README.md\n'
if [ "${#SK_NAME[@]}" -gt 0 ]; then
  printf '\n如需彻底清理本轨道（确认无用后）：\n'
  printf '  git -C %s worktree remove --force %s\n' "$MAIN" "$WT"
  printf '  git -C %s branch -D %s\n' "$MAIN" "$BRANCH"
fi
printf '\n'
