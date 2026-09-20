import './index'; // side effect: register eager host + driver dictionaries
import { t as translate } from '@datazen/ui';
import type { I18nKey } from './index';

/**
 * Standalone translation function for use outside React components (stores, utils).
 * Resolves through the single @datazen/ui engine; the active locale is kept in
 * sync with settingsStore.language by src/lib/localeSync.ts (host entry wiring).
 */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  return translate(key, params);
}
