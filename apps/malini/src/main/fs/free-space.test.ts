import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requireFreeSpace } from './free-space';

describe('requireFreeSpace', () => {
	it('lets work start while the disk has room for it', async () => {
		await expect(requireFreeSpace(tmpdir(), 1, 'starting a workstream')).resolves.toBeUndefined();
	});

	it('measures the nearest folder that exists yet', async () => {
		await expect(
			requireFreeSpace(join(tmpdir(), 'not', 'there', 'yet'), 1, 'cloning this repository'),
		).resolves.toBeUndefined();
	});

	it('refuses work the disk has no room for and says how much is free', async () => {
		await expect(
			requireFreeSpace(tmpdir(), Number.MAX_SAFE_INTEGER, 'starting a workstream'),
		).rejects.toThrow(
			/^Only [\d.]+ GB is free, and starting a workstream needs [\d.]+ GB\. Archive old workstreams or free up space\.$/u,
		);
	});
});
