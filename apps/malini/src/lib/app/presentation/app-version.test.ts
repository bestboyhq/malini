import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));
const rendererRoot = fileURLToPath(new URL('../../../', import.meta.url));

const SEMVER_LITERAL = /['"`]\d+\.\d+\.\d+/u;

function readJsonVersion(path: string): string {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
	const version = (parsed as { version?: unknown }).version;
	if (typeof version !== 'string') {
		throw new Error(`${path} has no string "version"`);
	}
	return version;
}

function svelteFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return svelteFiles(path);
		return entry.name.endsWith('.svelte') ? [path] : [];
	});
}

describe('the desktop app declares one version', () => {
	it('is a release version in apps/malini/package.json', () => {
		expect(readJsonVersion(join(appRoot, 'package.json'))).toMatch(/^\d+\.\d+\.\d+/u);
	});
});

describe('the version the UI shows reads the running version', () => {
	it('does not hardcode a version literal in any renderer component', () => {
		const offenders = svelteFiles(rendererRoot).flatMap((path) =>
			readFileSync(path, 'utf8')
				.split('\n')
				.flatMap((line, index) =>
					SEMVER_LITERAL.test(line) ? [`${path.slice(rendererRoot.length)}:${index + 1}`] : [],
				),
		);

		expect(offenders).toEqual([]);
	});

	it('resolves the version from the runtime the main process reports', () => {
		const runtimePage = readFileSync(
			join(rendererRoot, 'lib/app/presentation/pages/RuntimePage.svelte'),
			'utf8',
		);
		expect({ readsRuntime: runtimePage.includes('loadRuntimeInfoCommand()') }).toEqual({
			readsRuntime: true,
		});
	});
});
