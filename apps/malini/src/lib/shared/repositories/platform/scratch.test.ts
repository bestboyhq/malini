import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeScratchFolder, scratchFolder, sweepScratchFolders } from './scratch';

const folders: string[] = [];

afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function temporaryFolder(): string {
	const folder = mkdtempSync(join(tmpdir(), 'malini-scratch-'));
	folders.push(folder);
	return folder;
}

describe('scratch folders', () => {
	it('sweeps only the folders of workstreams this database archived', async () => {
		const root = join(temporaryFolder(), 'scratch');
		for (const id of ['w-archived', 'w-live', 'w-other-instance']) {
			writeFileSync(join(await makeScratchFolder(id, root), 'frame-0001.png'), 'png');
		}

		await sweepScratchFolders((id) => id === 'w-archived', root);

		expect(existsSync(scratchFolder('w-archived', root))).toBe(false);
		expect(existsSync(scratchFolder('w-live', root))).toBe(true);
		expect(existsSync(scratchFolder('w-other-instance', root))).toBe(true);
	});

	it('refuses a root that is a link to a folder someone else picked', async () => {
		const parent = temporaryFolder();
		const root = join(parent, 'scratch');
		symlinkSync(temporaryFolder(), root);

		await expect(makeScratchFolder('w-1', root)).rejects.toThrow('is not a folder this user owns');
	});
});
