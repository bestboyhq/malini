import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { served, worktreeFile } from './worktree-files';

vi.mock('electron', () => ({}));

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function worktreeBesideASecret(): { worktree: string; secret: string } {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'malini-worktree-files-')));
	roots.push(root);
	const worktree = join(root, 'worktree');
	mkdirSync(join(worktree, 'docs'), { recursive: true });
	writeFileSync(join(worktree, 'docs', 'report.html'), '<h1>Report</h1>');
	writeFileSync(join(worktree, 'docs', 'index.html'), '<h1>Docs</h1>');
	const secret = join(root, 'secret.txt');
	writeFileSync(secret, 'secret');
	symlinkSync(secret, join(worktree, 'leak.txt'));
	symlinkSync(root, join(worktree, 'up'));
	mkdirSync(join(worktree, '.malini', 'agent-attachments', 'att-1'), { recursive: true });
	writeFileSync(join(worktree, '.malini', 'agent-attachments', 'att-1', 'secret.txt'), 'secret');
	symlinkSync(
		join(worktree, '.malini', 'agent-attachments', 'att-1', 'secret.txt'),
		join(worktree, 'attachment.txt'),
	);
	return { worktree, secret };
}

describe('worktreeFile', () => {
	it('serves a file of the worktree, and the index page of a folder', async () => {
		const { worktree } = worktreeBesideASecret();
		await expect(worktreeFile(worktree, '/docs/report.html')).resolves.toBe(
			join(worktree, 'docs', 'report.html'),
		);
		await expect(worktreeFile(worktree, '/docs/')).resolves.toBe(
			join(worktree, 'docs', 'index.html'),
		);
	});

	it('serves nothing outside the worktree, even through a link', async () => {
		const { worktree } = worktreeBesideASecret();
		for (const pathname of ['/../secret.txt', '/leak.txt', '/up/secret.txt', '/', '/nope.html']) {
			await expect(worktreeFile(worktree, pathname)).resolves.toBeNull();
		}
	});

	it('serves nothing from the folder Malini keeps', async () => {
		const { worktree } = worktreeBesideASecret();
		for (const pathname of [
			'/.malini/agent-attachments/att-1/secret.txt',
			'/attachment.txt',
			'/.malini',
		]) {
			await expect(worktreeFile(worktree, pathname)).resolves.toBeNull();
		}
	});
});

describe('served', () => {
	it('shows text documents as UTF-8 text instead of a download, and never caches', async () => {
		for (const file of ['/w/.context/data.csv', '/w/notes.MD', '/w/a.json', '/w/b.txt']) {
			const response = served(
				file,
				new Response('Café — ok', { headers: { 'content-type': 'text/csv' } }),
			);
			expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
			expect(response.headers.get('cache-control')).toBe('no-store');
			await expect(response.text()).resolves.toBe('Café — ok');
		}
	});

	it('keeps the type of pages, PDFs and images', () => {
		for (const [file, type] of [
			['/w/index.html', 'text/html'],
			['/w/spec.pdf', 'application/pdf'],
			['/w/shot.png', 'image/png'],
		] as const) {
			const response = served(file, new Response('', { headers: { 'content-type': type } }));
			expect(response.headers.get('content-type')).toBe(type);
		}
	});
});
