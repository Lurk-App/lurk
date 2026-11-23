import { defineConfig } from '@playwright/test';

// The tour drives the built app (`npm run tour` builds it first) with real clicks and keeps
// screenshots per system in tour/out/<platform>/.
export default defineConfig({
  testDir: 'tour',
  timeout: 60_000,
  workers: 1,
  outputDir: 'test-results',
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
});
