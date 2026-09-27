# pack-ep-typecheck-BUG-002 — `sign-ep.mjs` declared `sigDoc.version` as `string`; the value is the number `1`

- **Track**: pack-ep-typecheck
- **Status**: FIXED in this track (annotation tightened, not widened)
- **File**: `scripts/sign-ep.mjs`, `signEpPackage`'s `@returns`
- **Found by**: `tsc --checkJs` (TS2322) while putting `pack-ep.mjs` behind a type gate
- **Class**: lying annotation — the third bite of the "comment/annotation that asserts something untrue" family in this repo

## What was wrong

The `@returns` JSDoc on `signEpPackage` declared:

```js
 *     version: string,
```

The value it actually returns is `EP_SIGNATURE_VERSION`, which is the **number** `1`
(`sign-ep.mjs:26`). TypeScript refused to assign `1` to `string` and reported
`Type 'number' is not assignable to type 'string'`.

The annotation was the defect, not the code. Tightening it to `number` is the fix; the
alternative — loosening the declared type until `1` fits — would have hidden a real
mismatch.

## Why `number` is the true type (真实管线实测, not inference)

`packages/extension-points/src/signaturePayload.ts` is the canonical contract and is
what the host verifier uses:

- line 5: `export const EP_SIGNATURE_VERSION = 1;`
- line 18: `version: typeof EP_SIGNATURE_VERSION;` in `EpSignatureFile` — i.e. a number
- line 51: `if (sig.version !== EP_SIGNATURE_VERSION) { throw ... }` — a **strict**
  comparison

The verifier therefore rejects a document whose `version` is the string `"1"`. An
annotation saying `string` describes a document the host will refuse to load, and,
worse, describes one no type checker in the repo would catch.

## Fix

`sigDoc.version: string` → `sigDoc.version: number`.

## Also fixed in the same pass (same file, not a separate defect)

Two dead named imports were removed from the `node:crypto` import list:
`createPublicKey` and `sign` (lines 19–20). `tsc` flags both as TS6133
"declared but its value is never read", and the code signs through the default
`crypto` namespace (`crypto.sign(...)`, line 123) rather than the named binding.
Removing a binding that is never read is behaviour-preserving; leaving it would have
meant the gate could never be green without an `any` or an unused-ignore.

## Note on scope

`sign-ep.mjs` is not in this track's stated scope. It is a hard `import` of
`scripts/pack-ep.mjs` (`import { signEpPackage } from './sign-ep.mjs'`), so any tsc
program that checks `pack-ep.mjs` with `checkJs: true` pulls it in and type-checks it.
Measured before this change: 9 errors in `sign-ep.mjs`, 78 in `pack-ep.mjs`.
