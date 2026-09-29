/** R3 tester's isolated live Data Transfer acceptance run. */
import { config as base } from './wdio.conf.js';
import { browser } from '@wdio/globals';

export const config: WebdriverIO.Config = {
  ...base,
  specs: [
    './specs/journeys/data-transfer-structure-mapping-r3-structure.ts',
    './specs/journeys/data-transfer-structure-mapping-r3-portability.ts',
  ],
  maxInstances: 1,
  maxInstancesPerCapability: 1,
  // The journey owns uniquely named databases and app connections. Avoid the
  // shared worker DB setup and teardown hooks from the general Host suite.
  before: async () => {
    await browser.url('tauri://localhost');
  },
  after: async () => {},
};
