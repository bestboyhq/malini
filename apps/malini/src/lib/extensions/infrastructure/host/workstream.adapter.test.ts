import { afterEach, describe, expect, it } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import { createDesktopExtensionWorkstream } from './workstream.adapter';

const currentWorkstream = {
	id: 'fake-workstream-chat',
	path: '/tmp/malini/worktrees/fake-workstream-chat',
	repositoryPath: '/Users/dev/work/malini',
	branch: 'malini/fake-workstream-chat',
	baseBranch: 'main',
};

afterEach(() => {
	setPlatformForTest(null);
});

function installFake(): FakePlatform {
	const fake = createFakePlatform();
	setPlatformForTest(fake);
	return fake;
}

describe('desktop public extension workstream directory', () => {
	it('lists the workstreams the host knows, as copies the extension cannot change', async () => {
		const other = { ...currentWorkstream, id: 'workstream-2', branch: 'malini/workstream-2' };
		const known = [currentWorkstream, other];
		const workstream = createDesktopExtensionWorkstream({
			extensionId: 'malini.repository',
			workstream: () => currentWorkstream,
			knownWorkstreams: () => known,
		});

		const listed = await workstream.list?.();

		expect(listed).toEqual(known);
		expect(listed?.[0]).not.toBe(currentWorkstream);
	});

	it('offers no directory when the host knows only the active workstream', () => {
		const workstream = createDesktopExtensionWorkstream({
			extensionId: 'malini.repository',
			workstream: () => currentWorkstream,
		});

		expect(workstream.list).toBeUndefined();
	});
});

describe('desktop public extension workstream filesystem', () => {
	it('owns every file operation by extension and active workstream', async () => {
		const platform = installFake();
		const workstream = createDesktopExtensionWorkstream({
			extensionId: 'malini.repository',
			workstream: () => currentWorkstream,
		});

		await workstream.writeFile('src/new.ts', 'export const ready = true;');

		expect(await workstream.readFile('src/new.ts')).toBe('export const ready = true;');
		expect(await workstream.stat('src/new.ts')).toEqual({ kind: 'file', size: 26 });
		expect(await workstream.stat('src')).toEqual({ kind: 'directory', size: 0 });
		expect(await workstream.listFiles('**/*.ts')).toContain('src/new.ts');
		expect(workstream.current()).toEqual(currentWorkstream);
		expect(platform.calls).toEqual(
			expect.arrayContaining([
				{
					command: 'extensions.write-workstream-file',
					args: {
						extensionId: 'malini.repository',
						workstreamId: currentWorkstream.id,
						path: 'src/new.ts',
						contents: 'export const ready = true;',
					},
				},
			]),
		);
	});

	it('supports an explicitly addressed known workstream', async () => {
		installFake();
		const workstream = createDesktopExtensionWorkstream({
			extensionId: 'malini.repository',
			workstream: () => currentWorkstream,
		});

		await workstream.writeFile('notes.txt', 'other workstream', 'fake-workstream-files');
		expect(await workstream.readFile('notes.txt', 'fake-workstream-files')).toBe(
			'other workstream',
		);
	});

	it('requires an active workstream when no workstream id is supplied', async () => {
		installFake();
		const workstream = createDesktopExtensionWorkstream({
			extensionId: 'malini.repository',
			workstream: () => null,
		});

		await expect(workstream.readFile('README.md')).rejects.toThrow('active workstream');
	});

	it('rejects parent traversal at the platform boundary', async () => {
		installFake();
		const workstream = createDesktopExtensionWorkstream({
			extensionId: 'malini.repository',
			workstream: () => currentWorkstream,
		});

		await expect(workstream.writeFile('../outside.txt', 'nope')).rejects.toThrow('escapes');
	});
});
