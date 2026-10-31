import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	ExtensionPackages,
	resolveExtensionPackagePaths,
	type ExtensionPackagePaths,
} from './packages';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function layout(): { paths: ExtensionPackagePaths; appDataRoot: string } {
	const root = mkdtempSync(join(tmpdir(), 'malini-packages-'));
	roots.push(root);
	const appDataRoot = join(root, 'app-data');
	mkdirSync(appDataRoot, { recursive: true });
	return { paths: resolveExtensionPackagePaths({ appDataRoot }, {}), appDataRoot };
}

function packages(paths: ExtensionPackagePaths): ExtensionPackages {
	return new ExtensionPackages(paths);
}

function createExtension(
	root: string,
	folder: string,
	manifest: Record<string, unknown>,
	entrypointSource = 'export default { activate() {} };',
): string {
	const source = join(root, folder);
	mkdirSync(join(source, 'dist'), { recursive: true });
	writeFileSync(join(source, 'manifest.json'), JSON.stringify(manifest));
	writeFileSync(join(source, 'dist', 'index.js'), entrypointSource);
	return source;
}

describe('resolveExtensionPackagePaths', () => {
	it('keeps the development folder under app data', () => {
		const paths = resolveExtensionPackagePaths({ appDataRoot: '/data' }, {});
		expect(paths).toEqual({ localRoot: '/data/extensions/local' });
	});

	it('lets MALINI_EXTENSION_HOME move the development folder', () => {
		const paths = resolveExtensionPackagePaths(
			{ appDataRoot: '/data' },
			{ MALINI_EXTENSION_HOME: '/home/me/.malini/extensions' },
		);
		expect(paths.localRoot).toBe('/home/me/.malini/extensions');
	});
});

describe('local development sources', () => {
	it('lists a self-contained local source with its reload sequence', async () => {
		const { paths } = layout();
		mkdirSync(paths.localRoot, { recursive: true });
		const source = createExtension(paths.localRoot, 'acme.local', {
			id: 'acme.local',
			entrypoint: './dist/index.js',
		});
		writeFileSync(
			join(paths.localRoot, 'local.json'),
			JSON.stringify([
				{
					id: 'acme.local',
					path: source,
					enabled: true,
					watch: true,
					installedAt: '2026-07-12T00:00:00Z',
				},
			]),
		);
		writeFileSync(join(paths.localRoot, 'reload.json'), '{"acme.local":7}');

		const sources = await packages(paths).listSources();

		expect(sources).toHaveLength(1);
		const snapshot = sources[0]!;
		expect(snapshot.id).toBe('acme.local');
		expect(snapshot.sourceKind).toBe('local');
		expect(snapshot.watch).toBe(true);
		expect(snapshot.reloadSequence).toBe(7);
		expect(snapshot.loadError).toBeNull();
		expect(snapshot.entrypointSource).toContain('activate');
		expect(snapshot.fingerprint).toHaveLength(64);
	});

	it('isolates an invalid local folder in its own source record', async () => {
		const { paths } = layout();
		mkdirSync(paths.localRoot, { recursive: true });
		const valid = createExtension(paths.localRoot, 'acme.valid', {
			id: 'acme.valid',
			entrypoint: './dist/index.js',
		});
		writeFileSync(
			join(paths.localRoot, 'local.json'),
			JSON.stringify([
				{ id: 'acme.valid', path: valid, enabled: true, watch: true },
				{ id: 'acme.missing', path: join(paths.localRoot, 'missing'), enabled: true, watch: true },
			]),
		);

		const sources = await packages(paths).listSources();

		expect(sources).toHaveLength(2);
		expect(sources.find((source) => source.id === 'acme.valid')?.loadError).toBeNull();
		expect(sources.find((source) => source.id === 'acme.missing')?.loadError).toContain(
			'cannot open local extension',
		);
	});

	it('refuses a manifest whose id disagrees with the registry or whose entrypoint escapes', async () => {
		const { paths } = layout();
		mkdirSync(paths.localRoot, { recursive: true });
		const renamed = createExtension(paths.localRoot, 'acme.renamed', {
			id: 'acme.other',
			entrypoint: './dist/index.js',
		});
		const escaping = createExtension(paths.localRoot, 'acme.escaping', {
			id: 'acme.escaping',
			entrypoint: '../acme.renamed/dist/index.js',
		});
		writeFileSync(
			join(paths.localRoot, 'local.json'),
			JSON.stringify([
				{ id: 'acme.renamed', path: renamed, enabled: true, watch: false },
				{ id: 'acme.escaping', path: escaping, enabled: true, watch: false },
			]),
		);

		const sources = await packages(paths).listSources();

		expect(sources.find((source) => source.id === 'acme.renamed')?.loadError).toBe(
			'local registry id acme.renamed does not match manifest id acme.other',
		);
		expect(sources.find((source) => source.id === 'acme.escaping')?.loadError).toBe(
			'extension entrypoint must stay inside its local folder',
		);
	});

	it('recovery mode and logs share the development directory', async () => {
		const { paths } = layout();
		const store = packages(paths);
		expect(await store.recoveryModeEnabled()).toBe(false);
		mkdirSync(paths.localRoot, { recursive: true });
		writeFileSync(join(paths.localRoot, 'recovery-mode'), 'enabled\n');
		expect(await store.recoveryModeEnabled()).toBe(true);

		await store.appendDevelopmentLog({
			timestamp: '2026-07-12T00:00:00Z',
			level: 'info',
			extensionId: 'acme.local',
			event: 'activated',
			message: 'Started',
		});
		const persisted = readFileSync(join(paths.localRoot, 'development.log.ndjson'), 'utf8');
		expect(JSON.parse(persisted.trim())).toEqual({
			timestamp: '2026-07-12T00:00:00Z',
			level: 'info',
			extensionId: 'acme.local',
			event: 'activated',
			message: 'Started',
		});
	});

	it('an absent development folder lists nothing', async () => {
		const { paths } = layout();
		expect(await packages(paths).listSources()).toEqual([]);
	});
});
