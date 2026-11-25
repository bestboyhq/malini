import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	globalSetup: './tests/e2e/unpack-electron.ts',
	timeout: 30_000,
	fullyParallel: true,
	workers: process.env['CI'] ? 2 : '33%',
	retries: process.env['CI'] ? 1 : 0,
	reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
	use: { trace: 'retain-on-failure' },
});
