import { fileURLToPath } from 'node:url';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	plugins: [svelte({ configFile: false, preprocess: vitePreprocess() })],
	clearScreen: false,
	resolve: { conditions: ['browser', 'development', 'module', 'import', 'default'] },
	test: {
		include: ['*.spec.ts'],
		environment: 'jsdom',
		pool: 'threads',
		maxWorkers: 1,
		reporters: ['default'],
	},
});
