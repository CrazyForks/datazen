# Track: scripts-gate

**Status**: READY_FOR_TEST
**Branch**: `feature/scripts-gate` (worktree `.worktrees/datazen-scripts-gate`)
**Base**: `96bdba7bc` (0 commits behind `main`)
**Commits**: `d226686ca` (task A), `ce4e9e838` (task B)
**Scope**: small, deliberately — two "the gate itself has a hole" findings, nothing else.

Two findings, found independently. Both are the same shape: a check that everybody
cites as evidence which, on inspection, is not actually wired to the thing it
claims to cover. Neither is a crash; each is a way for "it ran" to be mistaken
for "it was verified".

- **A** — a failed Pro build leaves a signed tree behind, and the next
  `resolve-pro` reuses it and exits 0.
- **B** — no file under `scripts/` has ever been in a `tsc` program.

---

## Task A — a failed build leaves a reusable signed tree

### The defect

`resolve-pro.mjs` short-circuits onto whatever already sits under
`builtin-ep/sql-editor-pro` when nobody names a source, and says so in a comment
at the top of the function: that is the CI contract, build the extension once and
let all 11 release variants share the tree.

The tree is only rewritten as the *last* step of `packEp`. Everything before it
can fail — the vite build, or the artifact-level host-key invariant that
`pack-ep-key-invariant` (`85594adb4`) added on purpose. When one of those fails,
`builtin-ep/sql-editor-pro` still holds the previous run's bytes **and the
previous run's signature**, and the next `resolve-pro --edition=pro` short-circuits
onto it and exits 0.

That is not hypothetical. It is one of the two traps the coordinator hit twice
while re-verifying BUG-002 end to end: first the tree-shaking false green, then
the "already staged, so skip the build" false green. Both times a run that had
not actually rebuilt the extension under test was accepted as a passing run.

`85594adb4` never touched `resolve-pro.mjs`, so this predates that track. It was
found by its Tester, not introduced by it.

**Why it matters beyond CI**: CI aborts on a non-zero exit, so CI cannot ship
this. It is a *local* hazard — and the local run is exactly where people look
when they want to know whether a change to the pipeline is safe.

### The fix: a sibling invalidation marker, not a deletion

`pack-ep.mjs` gains four exported helpers:

| helper | role |
| --- | --- |
| `stagingMarkerPath(dir)` | `<dir>.incomplete`, a **sibling** of the tree |
| `markStagingIncomplete(dir, reason)` | write the marker with a human-readable reason |
| `clearStagingIncomplete(dir)` | remove it |
| `stagedTreeComplete(dir)` | `!existsSync(marker)` — the trust predicate |

`packEp` becomes a thin wrapper around `packEpInner`. The wrapper marks the stage
**before** calling the inner body and re-marks it with the error on the way out;
the inner body clears it at the very end. `resolve-pro.mjs` replaces its inline
`hasPrebuiltFiles` computation with an exported `stagedTreeUsable(dir)` that
returns `false` when the marker is present, and both call sites (the
`--pro-prebuilt-url` branch and the git short-circuit) go through it.

Three properties this buys, none of which a deletion would:

1. **It survives the ugly failures.** A `throw` is the easy case. SIGKILL, OOM,
   a killed terminal — the marker is already on disk, so the tree is untrusted
   regardless of how the process died.
2. **It keeps the evidence.** Deleting the tree destroys the very artifact
   someone needs to find where the bypass came from. The marker leaves the old
   bytes readable and says, in one line, why they cannot be used.
3. **It is correct about what "done" means.** The tree is trusted exactly when
   the last staging run over it finished.

**Why a sibling file and not a file inside the tree**: `stagePackageTree` starts
with `rmSync(targetDir)`, so an in-tree marker would be destroyed by the next run
before it could be read. A sibling survives, and it also means CI's
`upload-artifact` of the tree carries no marker with it.

`ci-tauri-build.mjs` also learns about it: `checkProStagingReady` now reports the
marker in its `missing` list and emits an `::error::` naming the stale tree and
the command to re-run. `main()` already exits 1 when `missing` is non-empty, so
the pre-flight now refuses to ship a tree a failed run left behind.

### Two adjacent paths, closed in the same place

Found while in there, both on the "fail open" side of the same boundary:

- `downloadPrebuiltEp` extracted the tarball **over** the existing tree, so a
  prebuilt archive shipping fewer files inherited the previous
  `signature.sig` — a signature over bytes that are no longer on disk. The target
  is now `rmSync`'d first, and both the failure and the success path update the
  marker.
- `hasPrebuiltFiles` was **not** tightened to require `signature.sig`. It would
  be a real improvement, but it reaches into the `--pro-prebuilt-url` flow and CI
  already enforces it through `REQUIRED_PRO_STAGED_PATHS`. Out of scope; noted
  rather than done.

### What was deliberately not touched

`artifacts/.pack-ep-staging-*` still survives a failed build. That is the
`pack-ep-key-invariant` track's on-disk evidence path and its Tester ruled the
trade-off acceptable: `artifacts/` is gitignored, the short-circuit only ever
looks at `builtin-ep/`, and the work dir is cleared at `stagePackageTree` entry
on the next run. Clearing it here would destroy a debugging trail this track has
no standing to destroy.

### CI semantics — the part that had to stay unbroken

`release.yml` uploads `src-tauri/resources/builtin-ep/sql-editor-pro` as an
artifact and 11 variant jobs download it and run
`with-driver-inject.mjs … --edition=pro`. "resolve-pro uses it verbatim" is
written in the workflow as a comment. Breaking it would break releases.

It survives three independent ways:

1. a successful `packEp` clears the marker, so a complete tree is reusable;
2. the uploaded artifact contains only the tree — no marker — so a variant job
   that downloads it sees nothing to object to;
3. the `prepare-pro-extension` job's second step is `--mode=dzx`, and a
   dzx-only pack never writes or clears a marker.

Test: *"a complete staged tree is still shared verbatim by every variant"* runs
`resolvePro({edition: 'pro'})` three times with no source named and asserts all
three return `{prebuilt: true}` with the bytes unchanged.

### Evidence

`scripts/__tests__/pack-ep.staging-invalidation.test.ts` — 9 cases.

| run | result |
| --- | --- |
| before the fix | **5 failed / 4 passed** |
| after the fix | **9 passed** |
| existing related suites | **5 files, 120 passed, 3 skipped** |

The 3 skips are the real Pro-build integration tests; the Pro repo is not
checked out in this worktree.

The red run's smoking gun, verbatim from the failure output — the assertion was
that this line must **not** appear, because its presence is the bug:

```
"[resolve-pro] prebuilt EP already staged, skipping download"
```

The strongest single case is *"a failed pack leaves the old bytes and the old
signature byte-identical on disk"*: it pins the fact that the old tree is still
physically there (so the finding is real and not a red herring) while
`stagedTreeComplete` and `stagedTreeUsable` both report `false` (so it is
correctly untrusted). Deletion-based fixes cannot pass this case.

### Mutations, and what each one turned red

Restored from backup and re-verified green after each; `git diff` confirms the
sources are back.

| mutation | result |
| --- | --- |
| drop `clearStagingIncomplete` on the success path | **5 failed / 4 passed** — including the CI-sharing test |
| drop the `rmSync(target)` before extracting a prebuilt | **1 failed / 8 passed** — exactly the stale-signature case |
| drop the marker branch from `checkProStagingReady` | **1 failed / 20 passed** — exactly the ci-tauri-build test |

The first is the one that matters: it is the mutation that would break the CI
contract, and the suite catches it.

### Residual caveat

`*.incomplete` is gitignored, so a leftover marker will not show up in
`git status`. That is deliberate — a marker under `src-tauri/resources/` is
already gitignored as part of `builtin-ep/`, and a stray file in a status diff is
noise. The cost is that it is invisible in a casual `git status`. The counter is
that `checkProStagingReady` and `resolvePro` both say so loudly, with the path
and the reason, the moment anyone looks.

---

## Task B — `scripts/` was outside every `tsc` program

### The measurement that motivated it

`tsconfig.json` includes `["src", "packages/driver-sdk", "packages/extension-points",
"packages/wapp-sdk", "packages/ui", "packages/drivers/*/ui"]` and excludes
nothing. Not one line of that list reaches `scripts/`.

So the repo's habitual "whole-repo `tsc`, 0 errors" is **0% coverage** of the 23
`.ts` test files that guard the build pipeline — `pack-ep`, `resolve-pro`,
`sign-ep`, driver stash, CI scripts. The BUG-002 track's Tester had to run
`npx tsc --allowJs --checkJs` over `pack-ep.mjs` by hand.

File counts in `scripts/`: **23 `.ts`**, **46 `.mjs`** (41 top-level + 5
`__tests__/*.test.mjs`), 0 `.js`. The brief said "5 `.mjs`", which matches the
five under `__tests__/` rather than the 46 that are actually there.

### What each option actually costs — measured, not guessed

All four run with the repo's real `compilerOptions`; only the listed knobs differ.
Baseline for comparison: `npx tsc --noEmit` = **exit 0, 0 errors**.

| # | program | options | errors | of which `.mjs` | of which `.ts` |
| --- | --- | --- | --- | --- | --- |
| 1 | `scripts` | (none) | 378 | — | 183 |
| 2 | `scripts` | `allowJs` | 326 | 0 | 131 |
| 3 | `scripts` | `allowJs` + `checkJs` | 798 | 472 | 326 |
| 4 | `scripts/__tests__` | `allowJs` + `checkJs` | 368 | 343 | 25 |

Row 1 vs row 2 is the whole argument for `allowJs`: with it off, 33
`TS7016` "`.mjs` implicitly has an `any` type" errors fire and another 44
follow them downstream, because once a module is `any` every callback handed to it
is an implicit `any` too. The gate would be *green* while checking nothing —
precisely the failure mode this track exists to close, reproduced in miniature.
`allowJs` is not a relaxation here; it is the minimum for the gate to see the
module under test.

### The scheme that shipped

**`tsconfig.scripts.json`** — `extends ./tsconfig.json`, `allowJs: true`,
`checkJs: false`, `include: ["scripts/__tests__"]`.
**Result: 0 errors.**

**`checkJs` stays off**, and this is the measured reason: turning it on reports
**456 errors, every one of them inside a `.mjs` body, 0 in any `.ts`** (measured
after the fixes below, over all of `scripts/` with `e2e-screenshots` excluded).
Almost all are missing JSDoc in a codebase that predates the gate. That is a real
backlog. Forcing it to zero in a small-scope track would mean either annotating
46 files or loosening the options, and the brief says do neither.

`tsconfig.scripts-checkjs.json` + `pnpm typecheck:scripts:checkjs` make the number
measurable so a follow-up can ratchet it. It is **not** wired into `pnpm
typecheck` or into CI on purpose: a command that always fails teaches people to
ignore it, which is the exact disease being treated here.

`pnpm typecheck:scripts` **is** wired into `pnpm typecheck`, so the CI step at
`ci.yml:56` picks it up without a workflow edit.

### Reaching 0: five JSDoc corrections, each of which *adds* information

Nothing was loosened. No `any`, no deleted assertion, no weakened option. Each
of these was wrong or missing before, and each is now a strictly stronger
contract:

| file | what was wrong |
| --- | --- |
| `sign-ep.mjs` | `signEpPackage` had no `@returns`, so `sigDoc.files` inferred as `{}` and every assertion about the signature document was unchecked (TS7053) |
| `ci-tauri-build.mjs` | `buildTauriArgs` and `writeTauriConfigFile` had no `@param`, so TS synthesized their option types from the **default initializers alone** — `target = null` typed as `null \| undefined`, `features = []` typed as `never[]` — and rejected the real call sites for passing what they should |
| `check-ci-docs-consistency.mjs` | `checkCiMatrixDrivers`' `@returns` omitted `mentioned`, which the function has always returned and the test has always read |
| `with-driver-inject.mjs` | `runWithDriverInject`'s `@param` omitted `runResolvePro` / `runRestorePro`, both honoured by the body (`:96`, `:106`) and relied on by the tests |
| `with-driver-inject.mjs` | `planDriverInjectLifecycle`'s `@param` documented only the object form; the legacy bare-function form (`typeof opts === 'function'`) is handled by the body and has a test, but was undeclared |

The first one is the one worth dwelling on: `signEpPackage` is the function the
BUG-002 key invariant depends on, and its return type was `{}` to the type
checker.

One test-side line: `ci-tauri-build.test.ts` collected log lines into an
un-annotated `const notices = []` (TS7034/TS7005), now `const notices: string[] = []`.

These are annotation corrections, not opportunistic feature work — each is the
minimum needed for the type to be true, and they were enumerated before any was
written.

### Registered, not fixed

- **`scripts/e2e-screenshots/editor-blog-screenshots.ts` is in no program at
  all.** It is a WebdriverIO spec (`import { browser, $ } from '@wdio/globals'`,
  importing `e2e/helpers.ts`) that happens to sit under `scripts/`. Pulling it in
  drags 195 more errors from `e2e/helpers.ts`, which belongs to the
  `e2e/tsconfig.json` program — that config is where the `@wdio` types are
  declared. Excluded from the scripts gate, **not** silently dropped: it is a
  second instance of this track's own finding, and the honest fix is to move the
  spec to `e2e/specs/` and type it in the e2e program. Out of scope here.
- **The 5 `.mjs` test files under `scripts/__tests__/`** are in the gate's
  program but not checked (`checkJs: false`). They are covered only by the opt-in
  `typecheck:scripts:checkjs`, where they account for 49 of the 456.
- **456 `checkJs` errors** in the `.mjs` bodies, itemized in
  `tsconfig.scripts-checkjs.json`'s comment. Largest: `pack-ep.mjs` 78,
  `resolve-drivers.mjs` 57, `check-driver-import-boundaries.mjs` 32.

---

## Acceptance criteria

| criterion | result |
| --- | --- |
| `npx tsc --noEmit` (existing gate) | **exit 0, 0 errors** (unchanged) |
| new scripts gate runs and is clean | **`npx tsc -p tsconfig.scripts.json --noEmit` → exit 0, 0 errors** |
| scripts `.mjs` under `checkJs` | **456 errors reported, all in `.mjs` bodies, 0 in `.ts`** — measured, not forced green |
| A: failed build ⇒ no reuse of the stale signed tree | 9/9 new tests; **red before the fix (5 failed / 4 passed)** |
| A: CI normal build ⇒ short-circuit unchanged | 3 consecutive `resolvePro` calls all `{prebuilt: true}`, bytes unchanged |
| `npx vitest run` all green | **475 files: 1 failed / 474 passed. 4770 cases: 4 failed / 4763 passed / 3 skipped** — the 4 are a pre-existing environment gap, see below |
| no `any`, no bare `unwrap` | none introduced |

### The 4 remaining failures: environmental, and not fixed on purpose

All 4 are in one file, `packages/extension-points/src/__tests__/security.test.ts`,
all with the same cause:

```
Error: ENOENT: no such file or directory, open
  '.../packages/pro-extensions/sql-editor-pro/manifest.json'
```

The test reads the real Pro extension's manifest. This worktree has no Pro
checkout: `ls -a packages/pro-extensions` is empty, `git ls-tree 96bdba7bc --
packages/pro-extensions` returns nothing (the Pro subpackage is its own git
repository per AGENTS.md and is gitignored at base, `.gitignore:68` — a rule that
predates this branch), and `git diff 96bdba7bc..HEAD --stat` lists 12 files, none
of them in that test's import graph or on that path.

The main checkout has the Pro repo, which is why the coordinator's 467-file
baseline was green. This track was told not to touch the Pro repo, so it was left
alone and the gap is reported rather than papered over.

Full run: **251.65s**, `Test Files 1 failed | 474 passed (475)`, `Tests 4 failed
| 4763 passed | 3 skipped (4770)`. The 3 skips are the real Pro-build integration
tests — the same missing-Pro-repo cause.

Known 4 flakes under concurrent load (`schemaStore.test.ts` ×1,
`DataTransferWindow.test.tsx` ×3, 5s budget marginal, individually 68/68 green) —
unrelated to this track, left alone, `testTimeout` untouched. They did not fire
in this run.

Scripts suites after both tasks: **27 files, 336 passed, 3 skipped**.

---

## Files changed

```
d226686ca  scripts/pack-ep.mjs                          +105
           scripts/resolve-pro.mjs                       +58
           scripts/ci-tauri-build.mjs                   +18
           scripts/__tests__/pack-ep.staging-invalidation.test.ts   (new, 9 cases)
           .gitignore                                   (*.incomplete)
ce4e9e838  tsconfig.scripts.json                        (new)
           tsconfig.scripts-checkjs.json                (new)
           package.json                                 (typecheck:scripts wired)
           scripts/ci-tauri-build.mjs, resolve-pro.mjs,
           with-driver-inject.mjs, sign-ep.mjs,
           check-ci-docs-consistency.mjs                (JSDoc corrections)
           scripts/__tests__/ci-tauri-build.test.ts     (1 line)
```
