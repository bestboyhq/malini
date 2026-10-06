import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'$hyper-ui': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	test: {
		name: 'hyper-ui',
		include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
		exclude: ['node_modules/**'],
		environment: 'node',
		pool: 'threads',
		maxWorkers: 1,
		reporters: ['default'],
	},
});
