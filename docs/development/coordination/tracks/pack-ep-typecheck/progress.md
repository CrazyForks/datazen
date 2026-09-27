# pack-ep-typecheck — progress

- **Track**: pack-ep-typecheck
- **Branch**: `feature/pack-ep-typecheck` (base `feature/editor-productivity`)
- **Worktree**: `.worktrees/datazen-pack-ep-typecheck`
- **State**: `READY_FOR_TEST`
- **Coder note**: no `PASSED` / `TEST_DONE` is written by this track; that is the Tester's action.

## Objective

Put the security-critical packaging script `scripts/pack-ep.mjs` behind a real type
gate. Add type information only — never relax an option to get to zero errors.

## What was done

### 1. `scripts/pack-ep.mjs` — 78 checkJs errors → 0

Every error is resolved by adding JSDoc that states the real contract. No
`@ts-ignore`, no `@ts-nocheck`, no `any`, no assertion or cast, no deleted assertion,
no test touched.

| error code | count | how it was resolved |
|---|---|---|
| TS7006 implicit any param | 66 | `@param {…}` on the parameter |
| TS7034 / TS7005 implicit any variable | 4 | `@type {…}` on the declaration |
| TS7031 implicit any binding element | 2 | `@type {…}` on the destructured array |
| TS7019 implicit any rest param | 1 | typed replacer params, no `...rest: any` |
| TS7053 implicit any index | 1 | `@param {Record<string, Buffer>}` on the accumulator |
| TS6133 declared but never read | 1 | removed a genuinely dead binding (see below) |
| TS2339 property does not exist | 1 | options typedef (`opts = {}` inferred `{}`) |
| TS2322 type incompatible | 1 | precise `@type` on the result object |
| TS18046 value is `unknown` | 1 | **real defect fixed — BUG-001** |

New shared typedefs: `LogFn`, `HostRefScanOptions`, `HostKeyAssertOptions`,
`LogOptions`, `StageTreeOptions`, `PackEpResult`, `HostRefGroups`.

### 2. `scripts/sign-ep.mjs` — 9 → 0 (out of stated scope; see below)

`pack-ep.mjs` has `import { signEpPackage } from './sign-ep.mjs'`, so any program
checking `pack-ep.mjs` with `checkJs: true` also checks `sign-ep.mjs`. Its 9 errors
had to be cleared for the gate to exist at all.

### 3. The gate — `tsconfig.pack-ep.json` + `pnpm typecheck:pack-ep`

`"typecheck"` changed from `tsc --noEmit && pnpm typecheck:scripts` to
`tsc --noEmit && pnpm typecheck:scripts && pnpm typecheck:pack-ep`. CI
(`.github/workflows/ci.yml:56`) runs `pnpm typecheck`, so it is picked up with no
workflow edit.

**Why a config and not a `// @ts-check` pragma**: a config entry is resolved by the
compiler, so deleting or renaming the file becomes TS6053 and turns the gate red. A
source pragma stops being checked the moment someone edits the line above it.

**The three scripts programs do not mask each other** — each covers a different set:

| config | include / files | checkJs | checks the `.mjs` bodies? | in `pnpm typecheck`? |
|---|---|---|---|---|
| `tsconfig.scripts.json` | `include: scripts/__tests__` | off | no | yes |
| `tsconfig.pack-ep.json` (new) | `files:` the 2 packaging scripts | on | **yes** | **yes** |
| `tsconfig.scripts-checkjs.json` | `include: scripts` | on | yes | no — backlog, no CI reference |

No compiler option is relaxed in the new config: `checkJs` is on, and `strict`,
`noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `skipLibCheck` all inherit
from `tsconfig.json` unchanged.

## Measured results

Every number below is a command output, not a ledger.

| check | baseline | now |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | **exit 0**, 0 errors |
| `npx tsc -p tsconfig.scripts.json --noEmit` | exit 0 | **exit 0**, 0 errors |
| `npx tsc -p tsconfig.pack-ep.json --noEmit` | did not exist | **exit 0**, 0 errors |
| `pnpm --config.verify-deps-before-run=false typecheck` | — | **exit 0**, all three ran |
| `npx tsc -p tsconfig.scripts-checkjs.json --noEmit` (backlog) | 456 | **369** (−87 = 78 + 9) |
| `npx vitest run scripts/__tests__` | green | **27 files, 336 passed, 3 skipped, exit 0** |
| `npx vitest run` (full) | — | 478/480 files, 4812/4820 tests — see below |

### The 5 full-run failures are not this track's

- **4 × `security.test.ts`** — `ENOENT … packages/pro-extensions/sql-editor-pro/manifest.json`.
  That directory is gitignored and **absent from this worktree** (`ls` → no such
  directory). The test imports only `vitest`, `node:fs`, `node:path`,
  `../signaturePayload`, `../security` — none of which this track changed.
- **1 × `schemaStore.test.ts`** — `Test timed out in 5000ms`, the known flake.
  Isolated rerun: **56/56 passed**. `testTimeout` was not touched.

Note on the coordinator's branch-mismatch warning: the failure mode observed here is
ENOENT, **not** `expected '1.0.0' to be '1.1.0'`, because there is no Pro checkout at
all in this worktree. The `1.0.0` vs `1.1.0` scenario was never reached.

### `pnpm typecheck` and the worktree

Running `pnpm <script>` here aborts with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`
before any script body runs: pnpm's auto-deps check wants to purge the symlinked
`node_modules`. This is a worktree artifact, not a wiring defect — an **unchanged**
script (`pnpm typecheck:scripts`) fails identically. Bypassing the deps check
(`--config.verify-deps-before-run=false`, which installs nothing) runs the chain to
exit 0. `pnpm install` is forbidden on this track, so the check stays bypassed here
and works normally in CI.

## Red → green evidence that the gate really covers `pack-ep.mjs`

1. Injected at the end of `pack-ep.mjs`:
   ```js
   /* TYPEGATE-MUTATION-PROBE */
   const __typecheck_probe__ = 1;
   __typecheck_probe__.toUpperCase();
   ```
2. `npx tsc -p tsconfig.pack-ep.json --noEmit` → **exit 2**, and the output **names
   the file**:
   ```
   scripts/pack-ep.mjs(1136,21): error TS2339: Property 'toUpperCase' does not exist on type '1'.
   ```
3. With the probe still in place, the two pre-existing gates stayed **green**:
   `tsc -p tsconfig.scripts.json --noEmit` → exit 0; `tsc --noEmit` → exit 0. So the
   new gate is not redundant with them, and neither of them was already doing this
   job.
4. Probe removed; gate → **exit 0**. `md5sum scripts/pack-ep.mjs` is identical before
   and after the mutation (`956c10fcfec125fa6de8600d6632d316`), and
   `grep -c TYPEGATE-MUTATION-PROBE` → 0.

(An earlier probe using a TS-only annotation produced TS8010 instead; it was replaced
by the real type error above so the evidence is about type checking, not syntax.)

## Findings

| file | summary |
|---|---|
| `bugs/pack-ep-typecheck-BUG-001.md` | `packEp`'s catch read `err.message` unguarded — a `null`/`undefined` throw made the handler itself throw and the `*.incomplete` marker never got written. **Fixed** (behaviour change, flagged). |
| `bugs/pack-ep-typecheck-BUG-002.md` | `sign-ep.mjs` declared `sigDoc.version: string`; the value is the number `1` and the host verifier strict-compares it. **Fixed** by tightening to `number`. |
| `bugs/pack-ep-typecheck-BUG-003.md` | `tsconfig.scripts.json` quotes 343/472 errors; measured baseline is 329/456. **Open** — cause not reproduced, so not retyped. |
| `bugs/pack-ep-typecheck-BUG-004.md` | `scripts/e2e-screenshots/editor-blog-screenshots.ts` is in **zero** tsc programs. **Open.** |
| `bugs/pack-ep-typecheck-BUG-005.md` | retired `generated-locales.ts` still referenced by `.gitignore:64` and `check-driver-import-boundaries.mjs:94`. **Open.** |

### On BUG-001: what kind of fix this is

This is the one place where the change is **not** purely additive type information.
`err instanceof Error ? err.message : String(err)` is a two-token behaviour change.
It was made because the honest alternative — asserting `err` is an `Error` — would
have made the gate green over a handler that can still fail to write the marker the
marker exists to provide. The demonstration table is in the bug file; the short
version is that for `throw null` the old form raises a `TypeError` **inside the
catch**, so `markStagingIncomplete` is never reached.

Every other behavioural edit is removal of code that provably cannot run:
`createPublicKey` / `sign` dead imports in `sign-ep.mjs` (TS6133; signing goes
through `crypto.sign`), and the unused `opts` binding in `packEpInner`.

## Task D, delivered

1. **`tsconfig.scripts.json` `$comment`** — the claim that
   `editor-blog-screenshots.ts` "belongs to the e2e/tsconfig.json program" was false.
   Replaced with the measured fact (zero programs; `e2e/tsconfig.json`'s
   `include: ["**/*.ts"]` resolves relative to `e2e/`). Kept BUG-003's stale counts
   visible rather than silently retyped, and pointed the reader at the command that
   measures the truth.
2. **`.gitignore` `*.incomplete`** — line kept, with a comment. One deviation from
   the instruction's wording, made deliberately: the instruction said the directory
   rule "is what actually does the work", but measurement shows that is only true for
   a marker inside `src-tauri/resources/builtin-ep/`. A root-level `foo.incomplete` is
   matched by `*.incomplete` and by nothing else, and `--stage-dir` can point
   anywhere. The comment states both facts. Writing the instruction's literal wording
   would have created a new lying comment — the exact defect class this track exists
   to remove.

## Not done, on purpose

- No tsconfig option relaxed anywhere; `checkJs` was only ever turned **on**.
- No `any`, `@ts-ignore`, `@ts-nocheck`, assertion, or cast added to silence a checker.
- `scripts/resolve-drivers.mjs` (57 errors) and the other backlog files untouched —
  another track's scope.
- `tsconfig.scripts-checkjs.json` left out of `pnpm typecheck`; it stays a backlog.
- No Pro checkout cloned; no `pnpm install`; no `testTimeout` change.
- No merge / rebase / cherry-pick / reset; no `git add -A` / `git add .`; `hub.md`
  untouched.
- `security.test.ts`'s 4 ENOENT failures not "fixed" — the Pro manifest is a
  gitignored artifact this track has no business fabricating.
