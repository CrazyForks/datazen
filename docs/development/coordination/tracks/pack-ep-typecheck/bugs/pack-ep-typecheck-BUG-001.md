# pack-ep-typecheck-BUG-001 — `pack-ep.mjs` failure handler could itself throw, silently skipping the staging marker

- **Track**: pack-ep-typecheck
- **Status**: FIXED in this track (behaviour change — see "Fix")
- **File**: `scripts/pack-ep.mjs`, `packEp`'s `catch` block
- **Found by**: `tsc --checkJs` (TS18046, `'err' is of type 'unknown'`) while putting the file behind a type gate
- **Severity judgement**: latent, not currently triggerable — see the evidence grades below

## What was wrong

`packEp` marks a staged tree incomplete when a run fails, so `resolve-pro` will not
reuse the previous build's bytes:

```js
} catch (err) {
  if (stagesTree) {
    markStagingIncomplete(
      stageDir,
      `pack-ep FAILED for ${extension} at ${new Date().toISOString()}: ${err.message}`,
    );
```

`err` is whatever was thrown. Reading `.message` off it is an unguarded property
access on a value whose type JavaScript does not constrain.

## Evidence, by grade

**机制论证 → confirmed by 真实管线实测 (the language mechanism, isolated):**
running the two shapes over five thrown values gives

| thrown      | old form (`.message`)                                   | new form (`instanceof Error`) |
|-------------|--------------------------------------------------------|-------------------------------|
| `Error`     | `boom`                                                  | `boom`                        |
| `'boom'`    | `undefined`                                             | `boom`                        |
| `null`      | **throws `TypeError` inside the catch**                 | `null`                        |
| `undefined` | **throws `TypeError` inside the catch**                 | `undefined`                   |
| `{msg}`     | `undefined`                                             | `[object Object]`             |

So for a `null`/`undefined` throw the old form does not merely lose the reason: the
`TypeError` is raised *inside the catch block*, `markStagingIncomplete` is never
reached, and the original failure is replaced by the `TypeError`. That is precisely
the hole the `*.incomplete` marker exists to close — the marker is not written, so
the stale tree looks complete to `resolve-pro`.

**Not established: that pack-ep.mjs hits this today.** Every explicit `throw` in the
file constructs an `Error` (`new Error(...)`, or `unmappedError` / `hostKeyError`,
which both return `new Error`). Its callees (`execSync`, `fs`, `JSON.parse`, fflate)
also throw `Error`s on their failure paths. There is therefore no currently
reachable non-`Error` throw, and this is filed as a latent hole in a safety
mechanism — not as an observed production failure.

**真实管线实测 (project convention):** the sibling `sign-ep.mjs` CLI entry point
already uses exactly the hardened form
(`err instanceof Error ? err.message : String(err)`). The fix makes the two
consistent rather than inventing a house style.

## Fix

```js
`pack-ep FAILED for ${extension} at ${new Date().toISOString()}: ${
  err instanceof Error ? err.message : String(err)
}`,
```

The `throw err;` re-throw below it is unchanged, so the caller still receives the
original value.

## Why this was not silenced

The alternative ways to make TS18046 disappear are a non-null assertion, a cast, or
an `any` cast on the catch variable. Each silences the checker without making the
handler safe. The task for this track forbade all of them, and all three would have
produced a green gate over a mechanism that can still fail to write its marker.
