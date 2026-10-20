import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		exclude: ['node_modules/**', 'dist/**'],
		environment: 'node',
		pool: 'threads',
		maxWorkers: 1,
		reporters: ['default'],
	},
});
