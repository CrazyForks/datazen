import { config as base } from './wdio.conf.js';
import { browser } from '@wdio/globals';
export const config: WebdriverIO.Config = {
  ...base,
  specs: ['../packages/drivers/postgres/e2e/sync-wave-one.ts', '../packages/drivers/mysql/e2e/sync-wave-one.ts'],
  before: async () => { await browser.url('tauri://localhost'); },
  after: async () => {},
};
