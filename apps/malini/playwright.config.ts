import { defineConfig } from '@playwright/test';

const PERFORMANCE = /-performance\.spec\.ts$/u;

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 30_000,
	fullyParallel: true,
	workers: process.env['CI'] ? 2 : '33%',
	retries: 0,
	reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
	use: { trace: 'retain-on-failure' },
	projects: [
		{ name: 'app', testIgnore: PERFORMANCE },
		{ name: 'performance', testMatch: PERFORMANCE, workers: 1, dependencies: ['app'] },
	],
});
