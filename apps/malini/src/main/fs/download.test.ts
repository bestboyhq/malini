import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { InstallProgressPayload } from '$contract/events';
import { saveDownload } from './download';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function file(): string {
	const root = mkdtempSync(join(tmpdir(), 'malini-download-'));
	roots.push(root);
	return join(root, 'download');
}

describe('saveDownload', () => {
	it('saves the body, reports progress against the size it was given, and returns its sha256', async () => {
		const target = file();
		const progress: InstallProgressPayload[] = [];
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('he'));
				controller.enqueue(new TextEncoder().encode('llo'));
				controller.close();
			},
		});

		const sha256 = await saveDownload(
			() => Promise.resolve(new Response(body)),
			'https://example.invalid/hello',
			target,
			{ onProgress: (p) => progress.push(p), total: 5 },
		);

		expect(readFileSync(target, 'utf8')).toBe('hello');
		expect(sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
		expect(progress).toEqual([
			{ received: 0, total: 5 },
			{ received: 2, total: 5 },
			{ received: 5, total: 5 },
			{ received: 5, total: 5 },
		]);
	});

	it('gives up on a download that stops sending data', async () => {
		const stalled = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('partial'));
			},
		});
		await expect(
			saveDownload(
				() => Promise.resolve(new Response(stalled)),
				'https://example.invalid/stalled',
				file(),
				{
					onProgress: () => {},
					stallMs: 1_000,
				},
			),
		).rejects.toThrow('no data for 1 seconds');
	});
});
