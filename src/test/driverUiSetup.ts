/**
 * i18n assembly for the path-driver UI suites (`vitest.drivers.config.ts`).
 *
 * Driver components read translations from the single shared `@datazen/ui`
 * registry and never import the host, so a driver test run has to register
 * dictionaries the same way the running app does:
 *   1. host eager dictionaries — loaded by the host app itself
 *      (`src/locales/index.ts` registers them on import);
 *   2. each driver pack — self-registered by `packages/drivers/<id>/locales`
 *      (in the app this module is reached through the driver UI entry that
 *      `src/extensions/generated.ts` imports).
 *
 * Host-only test runs keep using `./setup.ts`; this file exists so the driver
 * suites get real strings without any `src/**` import inside `packages/drivers`.
 */
import '../locales';
import '../../packages/drivers/redis/locales';
import '../../packages/drivers/mongodb/locales';
