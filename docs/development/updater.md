# Auto-update (Tauri Updater)

DataZen ships several release SKUs (**Basic**, **All**, **Akulaku**), each with **its own** in-app update channel: signed bundles plus a matching manifest.

> **Why one manifest per SKU.** `tauri.conf.json` compiles a single updater endpoint into every build, and the Tauri updater picks a manifest entry by _platform_ alone (`darwin-aarch64`, `windows-x86_64`, …) — it has no notion of SKU. With one shared manifest, an `-all` / `-akulaku` install would be handed Basic's bundle and silently replaced by a Basic build, losing every driver Basic does not ship. So each SKU is built against its own endpoint (`scripts/ci-tauri-build.mjs`), publishes its own manifest (`scripts/generate-updater-latest-json.mjs`), and only self-updates when `DATAZEN_UPDATER_CHANNEL` is true (`src/lib/updater.ts`). The SKU list, manifest names and platform sets live in one place: `scripts/release-variants.mjs`.

## Key generation

Generate a minisign key pair once (keep the private key secret):

```bash
pnpm tauri signer generate -w ~/.tauri/datazen.key --ci -p ""
```

This writes:

- **Private key** — e.g. `~/.tauri/datazen.key` (never commit)
- **Public key** — e.g. `~/.tauri/datazen.key.pub`; paste into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`

Upload secrets to the GitHub **release** environment:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY --env release < ~/.tauri/datazen.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --env release --body ""
```

## CI / release signing

Store secrets in the GitHub **release** environment:

| Secret                               | Purpose                                         |
| ------------------------------------ | ----------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Private key contents or path (CI uses contents) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Optional minisign password                      |

**Every** matrix job receives the signing key and enables `createUpdaterArtifacts` when it is present; the pubkey compiled into `tauri.conf.json` is identical across SKUs, so one key signs them all. If the secret is missing, builds continue without updater artifacts and log a warning (that SKU then has no channel to publish).

Local signed build (Basic):

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/datazen.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""   # if applicable
DATAZEN_VARIANT=basic pnpm tauri:build:minimal -- --config '{"bundle":{"createUpdaterArtifacts":true}}'
```

Updater bundles:

| OS      | Artifacts               |
| ------- | ----------------------- |
| macOS   | `*.app.tar.gz` + `.sig` |
| Windows | NSIS `*.exe` + `.sig`   |
| Linux   | AppImage + `.sig`       |

Upload `.sig` files and updater archives to the GitHub release. The release workflow job **`release-updater-json`** runs `scripts/generate-updater-latest-json.mjs` once per SKU and uploads `latest.json` (Basic), `latest-all.json` and `latest-akulaku.json`. Basic is uploaded first so a variant problem can never stall the default channel.

A variant manifest only lists the platforms that SKU actually builds (Akulaku has no Linux leg). For non-Basic SKUs the generator **fails** rather than publishing a partial manifest: `check()` finds no entry for a missing platform and reports "up to date" forever, so those users would silently stop updating.

Verify after publish:

```bash
for m in latest latest-all latest-akulaku; do
  curl -sfL "https://github.com/flyxl/datazen/releases/latest/download/$m.json" \
    | jq '{variant, version, platforms: (.platforms | keys)}'
done
```

## App configuration

- **Endpoints** — `tauri.conf.json` defines the default (`latest.json`); `scripts/ci-tauri-build.mjs` overrides `plugins.updater.endpoints` per SKU at build time. Basic gets no override, so its compiled endpoint is byte-identical to what earlier releases shipped.
- **Variant identity** — `scripts/resolve-drivers.mjs` bakes `DATAZEN_VARIANT` and `DATAZEN_UPDATER_CHANNEL` into the gitignored `src/extensions/generated.ts`, from `--variant=<sku>` / `DATAZEN_VARIANT` (default `custom`).
- **Settings → General**: “Check for updates” (manual) and optional “Check on startup” (default off). Builds with no published channel (`custom`, private SKUs) show a **manual download** card instead and never self-update.
- `getUpdateChannel()` in `src/lib/updater.ts` is the single runtime gate: `auto` (has a channel) / `manual` (desktop build without one) / `none` (not a desktop build).

## Linux and other install channels

- **In-app updater:** Basic Linux builds publish **AppImage** + `.sig` in `latest.json`. Install or replace the AppImage when an update is offered.
- **deb / rpm:** Not served by the updater; download new packages from [GitHub Releases](https://github.com/flyxl/datazen/releases). See [`packaging.md`](packaging.md) for install commands and dependencies.
- **Homebrew / WinGet:** Package managers track release tags separately and follow the **Basic** artifacts only; they do not use `latest.json`. Pick one channel and stick to it, or disable “Check on startup” in Settings. If you installed the All/Akulaku installer by hand, keep updating that SKU from Releases — the updater will only ever offer a build of the SKU you installed.

## macOS install vs updater

Release DMGs may be unsigned with respect to **notarization** even when updater artifacts are minisign-signed. If Gatekeeper blocks launch, see [`packaging.md`](packaging.md) (`xattr -cr` workaround). Notarization is a release-ops checklist item, not required for the updater signature chain.

## Troubleshooting

- **Update check fails in dev**: local builds are `DATAZEN_VARIANT=custom` (no channel) and `createUpdaterArtifacts` is off by default; use a release build or pass `--variant=basic` explicitly.
- **Update UI shows a manual download card**: expected — this SKU has no published manifest.
- **Signature invalid**: pubkey in `tauri.conf.json` must match the private key used to sign the release.
- **A variant was replaced by Basic**: check that the build really is the SKU it claims (`currentVariant()`), that asset names carry the `-<sku>` suffix, and that the matching `latest-<sku>.json` was uploaded. The per-SKU manifest generator refuses to build a manifest from another SKU's artifacts, so this now fails the release job instead of reaching users.
- **Lost private key**: generate a new pair, update pubkey, and users on old keys cannot receive signed updates until they reinstall manually.
