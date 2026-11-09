import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

const mainSrc = fileURLToPath(new URL('./src/main', import.meta.url));
const libSrc = fileURLToPath(new URL('./src/lib', import.meta.url));
const sharedSrc = fileURLToPath(new URL('./src/lib/shared', import.meta.url));
const contractSrc = fileURLToPath(new URL('./src/contract', import.meta.url));
const hyperUi = fileURLToPath(new URL('../../packages/hyper-ui/src', import.meta.url));
const TEMP = mkdtempSync(join(tmpdir(), 'malini-unit-tests-'));
process.once('exit', () => rmSync(TEMP, { recursive: true, force: true }));

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

/**
 * The main process additionally resolves `$main`, and `original-fs`, which
 * only Electron provides, to the plain Node `fs` it is a copy of.
 */
const nodeAlias = { ...rendererAlias, $main: mainSrc, 'original-fs': 'node:fs' };

/**
 * Unit tests only (docs/adr/0027): the main-process tests run on Node against
 * the real `node:sqlite` and the real filesystem; the renderer tests cover pure
 * functions on Node. Behavior is tested end to end in `tests/e2e`.
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
					unstubEnvs: true,
					env: {
						ELECTRON_OVERRIDE_DIST_PATH: '/unit-tests-never-launch-electron',
						MALINI_CLAUDE_UPDATES: 'off',
						TMPDIR: TEMP,
					},
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
						'src/lib/**/platform/**',
						'src/lib/**/*.platform.test.ts',
					],
					environment: 'node',
					pool: 'threads',
					maxWorkers: 1,
					env: { TMPDIR: TEMP },
				},
			},
			'../../packages/hyper-ui/vitest.config.ts',
		],
	},
});
