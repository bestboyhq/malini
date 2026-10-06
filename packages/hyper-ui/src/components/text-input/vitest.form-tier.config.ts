import { fileURLToPath } from 'node:url';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	root: fileURLToPath(new URL('../..', import.meta.url)),
	plugins: [svelte({ configFile: false, preprocess: vitePreprocess() })],
	clearScreen: false,
	resolve: { conditions: ['browser', 'development', 'module', 'import', 'default'] },
	test: {
		name: 'hyper-ui-form-tier',
		dir: fileURLToPath(new URL('..', import.meta.url)),
		include: ['**/*.spec.ts'],
		exclude: ['toast/**', '**/node_modules/**'],
		environment: 'jsdom',
		pool: 'threads',
		maxWorkers: 1,
		reporters: ['default'],
	},
});
