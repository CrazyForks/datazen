# pack-ep-typecheck-BUG-004 — `scripts/e2e-screenshots/editor-blog-screenshots.ts` is in no tsc program at all

- **Track**: pack-ep-typecheck
- **Status**: OPEN — finding only. The `$comment` that misreported this was corrected; the coverage gap was not closed.
- **File**: `scripts/e2e-screenshots/editor-blog-screenshots.ts` (28 KB, tracked in git)

## The gap

`tsconfig.scripts.json` excludes `scripts/e2e-screenshots/` and its old `$comment`
justified the exclusion by saying the file

> "belongs to the e2e/tsconfig.json program (it declares the @wdio types)"

That justification is false, and the file is therefore in **zero** type-checked
programs. The same comment's next sentence ("It is currently in no program at all")
contradicted its first, and the first is the one a reader would act on.

## Evidence (真实管线实测)

`e2e/tsconfig.json` declares `"include": ["**/*.ts"]` with no `files` and no
`baseUrl`-relative prefix, so it resolves relative to `e2e/` — `**/*.ts` cannot match
`../scripts/...`. Structural argument; confirmed by measurement:

```
for cfg in tsconfig.json tsconfig.scripts.json tsconfig.scripts-checkjs.json \
          tsconfig.pack-ep.json e2e/tsconfig.json; do
  npx tsc -p "$cfg" --noEmit --listFiles | grep -c editor-blog-screenshots
done
```

| config | files listed | `editor-blog-screenshots` |
|---|---|---|
| `tsconfig.json` | 2179 | **0** |
| `tsconfig.scripts.json` | 266 | **0** |
| `tsconfig.scripts-checkjs.json` | — | **0** |
| `tsconfig.pack-ep.json` | — | **0** |
| `e2e/tsconfig.json` | 702 | **0** |

The non-zero file counts are shown deliberately: a `0` from a query that returns `0`
for everything is not evidence, and a `0` next to a working query is.

The spec does import `@wdio/globals` (`editor-blog-screenshots.ts:25`), so the
original comment was right that `@wdio` types are involved and wrong about which
program supplies them.

## What was changed, and what was not

**Changed** (in `tsconfig.scripts.json`): the `$comment` now states the measured fact
— the file is in zero programs, and `e2e/tsconfig.json` cannot reach it — and says
that putting it in a real program is a finding rather than something to do silently.

**Not changed:** the file still is not type-checked. A 28 KB WebdriverIO spec
compiling against `@wdio` and `e2e/helpers.ts` needs a program that declares those
types, and inventing one belongs to whoever owns the e2e toolchain — it is not a
side effect of a packaging type gate. It is also the file the exclusion is *for*, so
silently widening the program here would have been the "half-fix" this finding exists
to prevent.

## Suggested owner

The e2e toolchain track, together with whoever owns `e2e/tsconfig.json`. The
`@wdio` types are already declared there; the missing half is a `files` entry (or a
second config) that names this spec.
