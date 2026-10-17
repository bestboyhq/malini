import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));

function readJsonVersion(path: string): string {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
	const version = (parsed as { version?: unknown }).version;
	if (typeof version !== 'string') {
		throw new Error(`${path} has no string "version"`);
	}
	return version;
}

describe('the desktop app declares one version', () => {
	it('is a release version in apps/malini/package.json', () => {
		expect(readJsonVersion(join(appRoot, 'package.json'))).toMatch(/^\d+\.\d+\.\d+/u);
	});
});
