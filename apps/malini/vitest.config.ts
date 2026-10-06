import { fileURLToPath } from 'node:url';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

const mainSrc = fileURLToPath(new URL('./src/main', import.meta.url));
const libSrc = fileURLToPath(new URL('./src/lib', import.meta.url));
const sharedSrc = fileURLToPath(new URL('./src/lib/shared', import.meta.url));
const contractSrc = fileURLToPath(new URL('./src/contract', import.meta.url));
const hyperUi = fileURLToPath(new URL('../../packages/hyper-ui/src', import.meta.url));

/**
 * The aliases the renderer compiles against, restated for vitest because it
 * does not read `electron.vite.config.ts`.
 */
const rendererAlias = {
	$lib: libSrc,
	$shared: sharedSrc,
	$contract: contractSrc,
	'$hyper-ui': hyperUi,
};

/** The main process additionally resolves `$main`. */
const nodeAlias = { ...rendererAlias, $main: mainSrc };

/**
 * Four kinds of project. The main-process tests run on Node against the real
 * `node:sqlite` and the real filesystem. The renderer tests run on Node too,
 * which resolves Svelte's server runtime: `$state` works, `$effect` is a no-op
 * and `mount()` throws, so they cover logic and source contracts. Anything
 * whose behavior depends on an effect running, or that has to mount a
 * component, is a `*.browser.test.ts` in the jsdom project, which asks for
 * the `browser` export condition so the real client runtime answers. The
 * hyper-ui projects are registered here so the one command CI runs collects
 * them.
 */
export default defineConfig({
	test: {
		projects: [
			{
				resolve: { alias: nodeAlias },
				test: {
					name: 'main',
					include: [
						'src/main/**/*.test.ts',
						'src/contract/**/*.test.ts',
						'src/lib/**/platform/**/*.test.ts',
						'src/lib/**/*.platform.test.ts',
					],
					environment: 'node',
					testTimeout: 30_000,
					env: { ELECTRON_OVERRIDE_DIST_PATH: '/unit-tests-never-launch-electron' },
				},
			},
			{
				plugins: [svelte({ configFile: false, preprocess: vitePreprocess() })],
				resolve: { alias: rendererAlias },
				test: {
					name: 'renderer',
					include: ['src/renderer/**/*.test.ts', 'src/lib/**/*.test.ts'],
					exclude: [
						'**/node_modules/**',
						'src/renderer/**/*.browser.test.ts',
						'src/lib/**/*.browser.test.ts',
						'src/lib/**/platform/**',
						'src/lib/**/*.platform.test.ts',
					],
					environment: 'node',
					pool: 'threads',
					maxWorkers: 1,
				},
			},
			{
				plugins: [svelte({ configFile: false, preprocess: vitePreprocess() })],
				resolve: {
					alias: rendererAlias,
					conditions: ['browser', 'development', 'module', 'import', 'default'],
				},
				test: {
					name: 'renderer-browser',
					include: ['src/renderer/**/*.browser.test.ts', 'src/lib/**/*.browser.test.ts'],
					exclude: ['**/node_modules/**'],
					setupFiles: ['./src/lib/shared/router/fixtures/browser-tier.setup.ts'],
					environment: 'jsdom',
					pool: 'threads',
					maxWorkers: 1,
				},
			},
			'../../packages/hyper-ui/vitest.config.ts',
			'../../packages/hyper-ui/src/components/toast/vitest.toast.config.ts',
			'../../packages/hyper-ui/src/components/text-input/vitest.form-tier.config.ts',
		],
	},
});
