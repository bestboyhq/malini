import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const TEMP = mkdtempSync(join(tmpdir(), 'malini-bridge-tests-'));
process.once('exit', () => rmSync(TEMP, { recursive: true, force: true }));

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		exclude: ['node_modules/**', 'dist/**'],
		environment: 'node',
		pool: 'threads',
		maxWorkers: 1,
		reporters: ['default'],
		env: { TMPDIR: TEMP },
	},
});
