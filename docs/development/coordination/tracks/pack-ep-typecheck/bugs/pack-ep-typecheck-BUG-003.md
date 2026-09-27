# pack-ep-typecheck-BUG-003 — `tsconfig.scripts.json` `$comment` quotes error counts that do not reproduce

- **Track**: pack-ep-typecheck
- **Status**: OPEN — finding only, deliberately not fixed
- **File**: `tsconfig.scripts.json`, the "checkJs stays OFF" paragraph

## The claim

> "yields 343 errors across the .mjs files reachable from these tests (472 across all
> of scripts/)"

## Measurement at this track's base (`feature/editor-productivity`)

| quantity | how measured | comment says | measured |
|---|---|---|---|
| errors in `.mjs` reachable from `scripts/__tests__` | a config identical to `tsconfig.scripts.json` but with `checkJs: true`, `include: ["scripts/__tests__"]`, no excludes | 343 | 242 today; **329 at baseline** (242 + the 87 fixed here) |
| errors across `scripts/` (with `scripts/e2e-screenshots/` excluded) | `npx tsc -p tsconfig.scripts-checkjs.json --noEmit` | 472 | **456 at baseline**, 369 today |
| errors with `scripts/e2e-screenshots/` *included* | same but with the exclusion removed | (not this claim) | 670 — so the 472 cannot have included it |

The baseline figures are `measured_now + 87`, where 87 = 78 (`pack-ep.mjs`) + 9
(`sign-ep.mjs`), both of which were confirmed in the same program before this track
changed them.

## Why it was not "fixed" in passing

The direction of the discrepancy is the interesting part: the tree now has **fewer**
errors than the comment claims, so the comment is not describing a backlog that grew.
That is consistent with several different explanations — files simplified or removed
since the number was taken, a different base commit, or a measurement that included
something the current configs exclude. This track did not reproduce the original
measurement's basis, so rewriting the two numbers would replace one unverified figure
with another and destroy the only clue about where the original came from.

`tsconfig.scripts.json` was edited in this track (to correct a different, provable lie
in the same file — see `pack-ep-typecheck-BUG-004`'s sibling note in
`tsconfig.scripts.json`'s `$comment`). The stale numbers were left in place and
annotated with the command that measures the truth, rather than silently retyped.

## How to settle it

```
npx tsc -p tsconfig.scripts-checkjs.json --noEmit | grep -cE 'error TS'
```

If the number matters to a decision, take it live. A frozen count in a comment about
a moving target is the defect; the count itself is not load-bearing.
