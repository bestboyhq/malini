import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const TEMP = join(tmpdir(), 'malini-bridge-tests');
mkdirSync(TEMP, { recursive: true });

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
