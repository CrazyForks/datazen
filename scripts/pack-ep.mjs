#!/usr/bin/env node
/**
 * pack-ep.mjs — build, rewrite, sign, and package privileged extensions (.dzx)
 * or stage them as Tauri builtin static resources (track B).
 *
 * The staged ESM bundle is loaded at runtime from a blob: URL with no module
 * resolution context, so every bare import (react, @codemirror/*, host
 * packages) is rewritten to the host shared-singleton table
 * (`globalThis.__DATAZEN_HOST__`, populated by the host entry) BEFORE signing —
 * signatures always cover the exact bytes that ship.
 *
 * Usage:
 *   node scripts/pack-ep.mjs --extension=sql-editor-pro
 *   node scripts/pack-ep.mjs --extension=sql-editor-pro --mode=dzx --out=artifacts/
 *   node scripts/pack-ep.mjs --extension=sql-editor-pro --mode=stage
 *   node scripts/pack-ep.mjs --extension=sql-editor-pro --mode=both
 *   node scripts/pack-ep.mjs --dir=/path/to/extension --mode=dzx --skip-build
 */

import { execSync } from 'child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { zipSync } from 'fflate';
import { signEpPackage } from './sign-ep.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..');
export const DEFAULT_PRO_DEST = resolve(ROOT, 'packages/pro-extensions/sql-editor-pro');
export const DEFAULT_BUILTIN_EP_ROOT = resolve(ROOT, 'src-tauri/resources/builtin-ep');
export const DEFAULT_DZX_OUT_DIR = resolve(ROOT, 'artifacts');

/** Relative paths that must exist in a staged / packed extension tree. */
export const REQUIRED_PACKAGE_PATHS = [
  'manifest.json',
  'dist/index.esm.js',
  'signature.sig',
];

/** Optional locale sources copied into locales/ when present. */
export const LOCALE_SOURCE_DIR = 'src/locales';

/**
 * Host shared-singleton table consumed by staged EP bundles at runtime
 * (track B: `builtin-ep` loaded from a blob: URL with no module resolution).
 *
 * Keys must cover the extension build's `external` list plus any bare
 * specifier used in dynamic `import()` inside the bundle. The host entry
 * (`src/main.tsx`) populates `globalThis.__DATAZEN_HOST__` with THE SAME keys —
 * keep both lists in sync or the blob-loaded bundle crashes on a missing key.
 * A pack-time throw on unmapped bare imports is intentional: fail here, not
 * in a user's WebView.
 */
export const HOST_GLOBAL_NAME = '__DATAZEN_HOST__';
export const HOST_SHARED_MODULES = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@datazen/ui',
  '@datazen/extension-points',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/lint',
  '@codemirror/autocomplete',
];

function hostGlobalRef(spec, globalName = HOST_GLOBAL_NAME) {
  return `globalThis.${globalName}[${JSON.stringify(spec)}]`;
}

function tmpVarFor(spec) {
  return `__host_${spec.replace(/[^A-Za-z0-9_$]/g, '_')}`;
}

function isBareSpecifier(spec) {
  return !(
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    spec.startsWith('http') ||
    spec.startsWith('blob:') ||
    spec.startsWith('data:')
  );
}

function unmappedError(kind, spec) {
  return new Error(
    `[pack-ep] unmapped bare ${kind} "${spec}" — add it to HOST_SHARED_MODULES ` +
      `and the host ${HOST_GLOBAL_NAME} table in src/main.tsx`,
  );
}

/** Split `D, {...}` / `D, * as ns` / `{...}` / `* as ns` / `D`. */
function splitDefault(clause) {
  const text = clause.trim();
  if (text.startsWith('*') || text.startsWith('{')) return { def: null, rest: text };
  const comma = text.indexOf(',');
  if (comma === -1) return { def: text, rest: null };
  return { def: text.slice(0, comma).trim(), rest: text.slice(comma + 1).trim() };
}

/** Parse `{ a, b as c }` (braces included) into [{ orig, alias }]. */
function parseNamedItems(braced) {
  const inner = braced.trim().replace(/^\{/, '').replace(/\}$/, '');
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const m = item.match(/^([A-Za-z_$][\w$]*|default)\s+as\s+([A-Za-z_$][\w$]*)$/);
      return m ? { orig: m[1], alias: m[2] } : { orig: item, alias: item };
    });
}

function destructureNamed(named) {
  return named
    .map((n) => (n.alias === n.orig ? n.orig : `${n.orig}: ${n.alias}`))
    .join(', ');
}

/**
 * Rewrite one static `import <clause> from "<spec>"` into const bindings off
 * the host singleton table. Default imports get `??` interop because the
 * host namespace object is the source of truth for `.default`.
 */
function rewriteStaticImport(clauseRaw, spec, globalName) {
  const clause = clauseRaw.trim();
  const G = hostGlobalRef(spec, globalName);
  const tmp = tmpVarFor(spec);
  const { def, rest } = splitDefault(clause);

  if (rest !== null) {
    const nsMatch = rest.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (nsMatch) {
      if (def === null) return `const ${nsMatch[1]} = ${G};`;
      return [
        `const ${tmp} = ${G};`,
        `const ${def} = ${tmp}.default ?? ${tmp};`,
        `const ${nsMatch[1]} = ${tmp};`,
      ].join('\n');
    }
    if (rest.startsWith('{')) {
      const named = parseNamedItems(rest);
      const defaultItems = named.filter((n) => n.orig === 'default');
      const nonDefault = named.filter((n) => n.orig !== 'default');
      if (def === null && defaultItems.length === 0) {
        return `const { ${destructureNamed(named)} } = ${G};`;
      }
      const lines = [`const ${tmp} = ${G};`];
      if (def !== null) lines.push(`const ${def} = ${tmp}.default ?? ${tmp};`);
      for (const n of defaultItems) lines.push(`const ${n.alias} = ${tmp}.default ?? ${tmp};`);
      if (nonDefault.length > 0) lines.push(`const { ${destructureNamed(nonDefault)} } = ${tmp};`);
      return lines.join('\n');
    }
  }
  if (rest === null && def !== null) {
    return `const ${tmp} = ${G};\nconst ${def} = ${tmp}.default ?? ${tmp};`;
  }
  throw new Error(`[pack-ep] cannot parse import clause from "${spec}": ${clauseRaw}`);
}

/**
 * Rewrite `export { a, b as c } from "<spec>"` — destructure behind temp
 * locals, then re-export with the original exported names preserved.
 */
function rewriteExportFrom(namesRaw, spec, globalName, counter) {
  const G = hostGlobalRef(spec, globalName);
  const items = namesRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const destructured = [];
  const exported = [];
  items.forEach((item, i) => {
    const local = `__e${counter}_${i}`;
    const m = item.match(/^([A-Za-z_$][\w$]*|default)\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (m) {
      destructured.push(`${m[1]}: ${local}`);
      exported.push(`${local} as ${m[2]}`);
    } else {
      destructured.push(`${item}: ${local}`);
      exported.push(`${local} as ${item}`);
    }
  });
  return `const { ${destructured.join(', ')} } = ${G};\nexport { ${exported.join(', ')} };`;
}

/**
 * Rewrite every bare import in a staged EP bundle to the host
 * shared-singleton table. Idempotent (a rewritten bundle has no bare imports
 * left, so a second pass is a no-op) and strict (unknown bare specifiers
 * throw instead of shipping a bundle that crashes at load).
 *
 * Handles: static imports (default/named/namespace), side-effect imports,
 * `export ... from`, and dynamic `import("...")`. Relative/absolute/URL
 * specifiers pass through untouched.
 */
export function rewriteEpImportsToHostGlobals(
  code,
  { modules = HOST_SHARED_MODULES, globalName = HOST_GLOBAL_NAME } = {},
) {
  const allowed = new Set(modules);
  const rewritten = new Set();
  let exportCounter = 0;

  // export * as ns from "bare"
  code = code.replace(
    /^[ \t]*export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["'][ \t]*;?[ \t]*$/gm,
    (full, ns, spec) => {
      if (!isBareSpecifier(spec)) return full;
      if (!allowed.has(spec)) throw unmappedError('re-export from', spec);
      rewritten.add(spec);
      return `const ${ns} = ${hostGlobalRef(spec, globalName)};\nexport { ${ns} };`;
    },
  );
  // export * from "bare" — cannot be expanded statically, always an error.
  code = code.replace(
    /^[ \t]*export\s+\*\s+from\s*["']([^"']+)["'][ \t]*;?[ \t]*$/gm,
    (full, spec) => {
      if (!isBareSpecifier(spec)) return full;
      throw new Error(
        `[pack-ep] cannot rewrite 'export * from "${spec}"' to host globals — ` +
          `enumerate named exports in the extension source instead`,
      );
    },
  );
  // export { ... } from "bare"
  code = code.replace(
    /^[ \t]*export\s+([^*;][^;]*?)\s+from\s*["']([^"']+)["'][ \t]*;?[ \t]*$/gm,
    (full, names, spec) => {
      if (!isBareSpecifier(spec)) return full;
      if (!allowed.has(spec)) throw unmappedError('re-export from', spec);
      rewritten.add(spec);
      return rewriteExportFrom(names, spec, globalName, exportCounter++);
    },
  );
  // static import ... from "bare"
  code = code.replace(
    /^[ \t]*import\s+([^"';]+?)\s+from\s*["']([^"']+)["'][ \t]*;?[ \t]*$/gm,
    (full, clause, spec) => {
      if (!isBareSpecifier(spec)) return full;
      if (!allowed.has(spec)) throw unmappedError('import from', spec);
      rewritten.add(spec);
      return rewriteStaticImport(clause, spec, globalName);
    },
  );
  // side-effect import "bare" — host already holds the singleton; elide.
  code = code.replace(
    /^[ \t]*import\s*["']([^"']+)["'][ \t]*;?[ \t]*$/gm,
    (full, spec) => {
      if (!isBareSpecifier(spec)) return full;
      if (!allowed.has(spec)) throw unmappedError('side-effect import', spec);
      rewritten.add(spec);
      return `/* [pack-ep] side-effect import "${spec}" elided — host provides the shared singleton */\nvoid 0;`;
    },
  );
  // dynamic import("bare") — e.g. lazily invoked Tauri/core bridges.
  code = code.replace(/import\(\s*["']([^"']+)["']\s*\)/g, (full, spec) => {
    if (!isBareSpecifier(spec)) return full;
    if (!allowed.has(spec)) throw unmappedError('dynamic import of', spec);
    rewritten.add(spec);
    return `(Promise.resolve(${hostGlobalRef(spec, globalName)}))`;
  });

  // Drop the stale sourcemap ref: the map is not staged (see stagePackageTree)
  // because rewriting invalidates its mappings.
  code = code.replace(/^[ \t]*\/\/#\s*sourceMappingURL=.*$/gm, '');

  return { code, rewritten: [...rewritten] };
}

/** Read → rewrite → write an EP bundle file in place. Returns rewritten specs. */
export function rewriteEpBundleFile(bundlePath, opts = {}) {
  const code = readFileSync(bundlePath, 'utf8');
  const { code: rewrittenCode, rewritten } = rewriteEpImportsToHostGlobals(code, opts);
  writeFileSync(bundlePath, rewrittenCode, 'utf8');
  return { bundlePath, rewritten };
}

export function parsePackArgs(argv = process.argv.slice(2)) {
  let extension = 'sql-editor-pro';
  let extensionDir = null;
  let mode = 'both';
  let outDir = DEFAULT_DZX_OUT_DIR;
  let stageDir = null;
  let skipBuild = false;

  for (const arg of argv) {
    if (arg.startsWith('--extension=')) {
      extension = arg.slice('--extension='.length);
    } else if (arg.startsWith('--dir=')) {
      extensionDir = arg.slice('--dir='.length);
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length);
    } else if (arg.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
    } else if (arg.startsWith('--stage-dir=')) {
      stageDir = arg.slice('--stage-dir='.length);
    } else if (arg === '--skip-build') {
      skipBuild = true;
    }
  }

  const resolvedExtensionDir =
    extensionDir ?? (extension === 'sql-editor-pro' ? DEFAULT_PRO_DEST : join(ROOT, 'packages/pro-extensions', extension));
  const resolvedStageDir =
    stageDir ?? join(DEFAULT_BUILTIN_EP_ROOT, extension);

  return {
    extension,
    extensionDir: resolve(resolvedExtensionDir),
    mode,
    outDir: resolve(outDir),
    stageDir: resolve(resolvedStageDir),
    skipBuild,
  };
}

export function readManifestVersion(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error(`[pack-ep] manifest.json missing string "version" at ${manifestPath}`);
  }
  return manifest.version;
}

export function buildExtensionLibrary(extensionDir, { log = console.log } = {}) {
  if (!existsSync(join(extensionDir, 'package.json'))) {
    throw new Error(`[pack-ep] extension package.json not found under ${extensionDir}`);
  }
  log(`[pack-ep] building extension library in ${extensionDir}`);
  execSync('npx vite build', {
    cwd: extensionDir,
    stdio: 'inherit',
    env: process.env,
  });
  const bundle = join(extensionDir, 'dist/index.esm.js');
  if (!existsSync(bundle)) {
    throw new Error(`[pack-ep] build did not produce dist/index.esm.js under ${extensionDir}`);
  }
}

export function syncLocales(extensionDir, targetRoot, { log = console.log } = {}) {
  const localesOut = join(targetRoot, 'locales');
  mkdirSync(localesOut, { recursive: true });

  const explicitLocalesDir = join(extensionDir, 'locales');
  if (existsSync(explicitLocalesDir)) {
    cpSync(explicitLocalesDir, localesOut, { recursive: true });
    log(`[pack-ep] copied locales/ from ${explicitLocalesDir}`);
    return;
  }

  const srcLocales = join(extensionDir, LOCALE_SOURCE_DIR);
  if (!existsSync(srcLocales)) {
    return;
  }

  for (const name of readdirSync(srcLocales)) {
    if (!/\.(ts|js|json)$/.test(name)) continue;
    cpSync(join(srcLocales, name), join(localesOut, name));
  }
  log(`[pack-ep] copied locale sources from ${srcLocales}`);
}

export function stagePackageTree(sourceDir, targetDir, { log = console.log, rewriteImports = true } = {}) {
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true });

  cpSync(join(sourceDir, 'manifest.json'), join(targetDir, 'manifest.json'));
  mkdirSync(join(targetDir, 'dist'), { recursive: true });
  cpSync(join(sourceDir, 'dist/index.esm.js'), join(targetDir, 'dist/index.esm.js'));
  if (rewriteImports) {
    // Track B: blob-loaded bundles cannot resolve bare imports — rewrite to
    // the host singleton table BEFORE signing (the signature covers shipped bytes).
    const stagedBundle = join(targetDir, 'dist/index.esm.js');
    const { rewritten } = rewriteEpBundleFile(stagedBundle);
    log(`[pack-ep] rewrote bare imports to ${HOST_GLOBAL_NAME}: ${rewritten.sort().join(', ')}`);
  }
  // NOTE: dist/index.esm.js.map is intentionally NOT staged — the import
  // rewrite invalidates its mappings. Debug against extension sources instead.
  syncLocales(sourceDir, targetDir, { log });
  signEpPackage({ packageDir: targetDir });
}

export function assertPackageLayout(packageDir) {
  const missing = REQUIRED_PACKAGE_PATHS.filter((rel) => !existsSync(join(packageDir, rel)));
  if (missing.length > 0) {
    throw new Error(`[pack-ep] incomplete package at ${packageDir}; missing: ${missing.join(', ')}`);
  }
}

export function listZipEntries(rootDir, currentDir = rootDir, acc = {}) {
  for (const name of readdirSync(currentDir, { withFileTypes: true })) {
    const abs = join(currentDir, name.name);
    const rel = relative(rootDir, abs).split('\\').join('/');
    if (name.isDirectory()) {
      listZipEntries(rootDir, abs, acc);
    } else {
      acc[rel] = readFileSync(abs);
    }
  }
  return acc;
}

export function createDzxArchive(packageDir, outFile) {
  assertPackageLayout(packageDir);
  const entries = listZipEntries(packageDir);
  const zipped = zipSync(entries, { level: 9 });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, Buffer.from(zipped));
  return outFile;
}

export function dzxFileName(extensionId, version) {
  return `${extensionId}-${version}.dzx`;
}

/**
 * @param {{
 *   extension?: string,
 *   extensionDir?: string,
 *   mode?: 'dzx' | 'stage' | 'both',
 *   outDir?: string,
 *   stageDir?: string,
 *   skipBuild?: boolean,
 *   log?: (...args: unknown[]) => void,
 * }} [opts]
 */
export function packEp(opts = {}) {
  const parsed = parsePackArgs();
  const extension = opts.extension ?? parsed.extension;
  const extensionDir = resolve(opts.extensionDir ?? parsed.extensionDir);
  const mode = opts.mode ?? parsed.mode;
  const outDir = resolve(opts.outDir ?? parsed.outDir);
  const stageDir = resolve(opts.stageDir ?? join(DEFAULT_BUILTIN_EP_ROOT, extension));
  const skipBuild = opts.skipBuild ?? parsed.skipBuild;
  const log = opts.log ?? console.log.bind(console);

  let effectiveExtensionDir = extensionDir;
  if (!existsSync(effectiveExtensionDir)) {
    if (extension === 'sql-editor-pro' && existsSync(DEFAULT_PRO_DEST)) {
      log(`[pack-ep] specified dir not found: ${effectiveExtensionDir}, falling back to ${DEFAULT_PRO_DEST}`);
      effectiveExtensionDir = DEFAULT_PRO_DEST;
    } else {
      throw new Error(`[pack-ep] extension directory not found: ${effectiveExtensionDir}`);
    }
  }

  if (!skipBuild) {
    buildExtensionLibrary(effectiveExtensionDir, { log });
  } else if (!existsSync(join(effectiveExtensionDir, 'dist/index.esm.js'))) {
    throw new Error(
      `[pack-ep] --skip-build requires existing dist/index.esm.js under ${effectiveExtensionDir}`,
    );
  }

  const workDir = join(outDir, `.pack-ep-staging-${extension}`);
  stagePackageTree(effectiveExtensionDir, workDir, { log });
  assertPackageLayout(workDir);

  const manifestVersion = readManifestVersion(join(workDir, 'manifest.json'));
  const dzxName = dzxFileName(extension, manifestVersion);
  const dzxPath = join(outDir, dzxName);

  const result = {
    extension,
    extensionDir,
    stageDir,
    workDir,
    manifestVersion,
    dzxPath: null,
    staged: false,
  };

  if (mode === 'stage' || mode === 'both') {
    stagePackageTree(workDir, stageDir, { log });
    result.staged = true;
    log(`[pack-ep] staged signed extension to ${stageDir}`);
  }

  if (mode === 'dzx' || mode === 'both') {
    createDzxArchive(workDir, dzxPath);
    result.dzxPath = dzxPath;
    log(`[pack-ep] wrote ${dzxPath}`);
  }

  if (mode !== 'stage' && mode !== 'dzx' && mode !== 'both') {
    throw new Error(`[pack-ep] unknown mode "${mode}" (expected dzx, stage, or both)`);
  }

  rmSync(workDir, { recursive: true, force: true });
  return result;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try {
    packEp();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
