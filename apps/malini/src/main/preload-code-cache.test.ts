import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { blockPreloadCodeCache } from './preload-code-cache';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sessionData(): string {
	const root = mkdtempSync(join(tmpdir(), 'malini-preload-cache-'));
	roots.push(root);
	return root;
}

it('puts a file where Electron keeps its preload code cache, in a new profile and an old one', () => {
	const fresh = sessionData();
	const old = sessionData();
	const oldCache = join(old, 'Code Cache', 'electron-preload');
	mkdirSync(oldCache, { recursive: true });
	writeFileSync(join(oldCache, 'entry.cache'), 'EPC1');

	for (const root of [fresh, old, old]) blockPreloadCodeCache(root);

	for (const root of [fresh, old]) {
		expect(statSync(join(root, 'Code Cache', 'electron-preload')).isFile()).toBe(true);
	}
});
