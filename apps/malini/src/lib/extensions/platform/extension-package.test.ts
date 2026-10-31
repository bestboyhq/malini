import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	PACKAGE_MAX_DECODED_BYTES,
	packExtension,
	readExtensionPackage,
	sha256Of,
	type PackageFile,
} from './extension-package';

const MANIFEST = {
	apiVersion: 2,
	publisher: 'szymeo',
	name: 'svelte',
	version: '1.0.4',
	displayName: 'Svelte',
	description: 'Svelte 5 docs and skills.',
	contributes: { mcpServers: { svelte: { url: 'https://mcp.svelte.dev/mcp' } } },
};

const file = (path: string, text: string): PackageFile => ({ path, bytes: Buffer.from(text) });

const SVELTE_FILES = [
	file('malini.json', JSON.stringify(MANIFEST)),
	file('README.md', '# Svelte'),
	file('skills/runes/SKILL.md', '---\nname: runes\n---\nUse runes.'),
];

describe('extension packages', () => {
	it('reads back what it packed', () => {
		const read = readExtensionPackage(packExtension(SVELTE_FILES));
		expect(read.manifest.mcpServers).toEqual([
			{ name: 'svelte', url: 'https://mcp.svelte.dev/mcp' },
		]);
		expect(read.skills).toEqual(['runes']);
		expect(read.readme).toBe('# Svelte');
		expect(read.files.map(({ path, bytes }) => [path, bytes.toString()])).toEqual(
			SVELTE_FILES.map(({ path, bytes }) => [path, bytes.toString()]),
		);
	});

	it('names the same bytes with the same hash', () => {
		const bytes = packExtension(SVELTE_FILES);
		expect(sha256Of(bytes)).toBe(sha256Of(Buffer.from(bytes)));
		expect(sha256Of(bytes)).toMatch(/^[0-9a-f]{64}$/u);
	});

	it('refuses bytes that are not gzip', () => {
		expect(() => readExtensionPackage(Buffer.from('{"format":1}'))).toThrow(
			'The package is not a gzip file Malini can open, or it unpacks too large.',
		);
	});

	it('refuses a package that unpacks past the limit', () => {
		const data = Buffer.alloc(PACKAGE_MAX_DECODED_BYTES + 1).toString('base64');
		const bomb = gzipSync(JSON.stringify({ format: 1, files: [{ path: 'README.md', data }] }));
		expect(() => readExtensionPackage(bomb)).toThrow(/unpacks/u);
	});

	it('refuses data that is not base64', () => {
		const bytes = gzipSync(
			JSON.stringify({ format: 1, files: [{ path: 'malini.json', data: '{not base64}' }] }),
		);
		expect(() => readExtensionPackage(bytes)).toThrow('malini.json is not base64.');
	});

	it('refuses a manifest the marketplace would refuse', () => {
		const bytes = packExtension([
			file('malini.json', JSON.stringify({ ...MANIFEST, version: 'one' })),
			...SVELTE_FILES.slice(1),
		]);
		expect(() => readExtensionPackage(bytes)).toThrow(
			'version is MAJOR.MINOR.PATCH, such as 1.0.0. (version)',
		);
	});

	it('refuses a package without a manifest', () => {
		expect(() => readExtensionPackage(packExtension(SVELTE_FILES.slice(1)))).toThrow(
			'The package has no malini.json.',
		);
	});
});
