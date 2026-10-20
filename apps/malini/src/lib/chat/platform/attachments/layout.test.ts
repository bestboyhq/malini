import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_ATTACHMENTS_PATH } from '$main/git/paths';
import {
	ATTACHMENT_ROOT,
	attachmentId,
	attachmentsRoot,
	deleteAttachmentDirectory,
	expectedRelativePath,
	MAX_ATTACHMENT_BASE64_CHARS,
	mediaType,
	validateName,
} from './layout';
import { createAttachmentsTestContext, type AttachmentsTestContext } from './test-support';

let test: AttachmentsTestContext;

afterEach(() => {
	test?.cleanup();
});

describe('layout constants', () => {
	it('stages under the path the git module excludes', () => {
		expect(ATTACHMENT_ROOT).toBe(AGENT_ATTACHMENTS_PATH);
	});

	it('bounds a paste at what 10 MiB encodes to', () => {
		expect(MAX_ATTACHMENT_BASE64_CHARS).toBe(Math.ceil((10 * 1024 * 1024) / 3) * 4);
		expect(Buffer.alloc(10 * 1024 * 1024).toString('base64').length).toBeLessThanOrEqual(
			MAX_ATTACHMENT_BASE64_CHARS,
		);
	});

	it('mints ids of the one shape the staging directory accepts', () => {
		const id = attachmentId();
		expect(id).toMatch(/^att-[0-9a-f]{32}$/);
		expect(attachmentId()).not.toBe(id);
	});
});

describe('mediaType', () => {
	it('names the closed list by extension, case-insensitively, and falls back to octet-stream', () => {
		expect(mediaType('notes.txt')).toBe('text/plain');
		expect(mediaType('README.MD')).toBe('text/plain');
		expect(mediaType('out.log')).toBe('text/plain');
		expect(mediaType('data.json')).toBe('application/json');
		expect(mediaType('paper.pdf')).toBe('application/pdf');
		expect(mediaType('shot.png')).toBe('image/png');
		expect(mediaType('photo.jpg')).toBe('image/jpeg');
		expect(mediaType('photo.JPEG')).toBe('image/jpeg');
		expect(mediaType('pic.webp')).toBe('image/webp');
		expect(mediaType('payload.exe')).toBe('application/octet-stream');
		expect(mediaType('noextension')).toBe('application/octet-stream');
		expect(mediaType('shot.PNG.bin')).toBe('application/octet-stream');
	});
});

describe('validateName', () => {
	it('keeps the bare filename of a picked path', () => {
		expect(validateName('/tmp/a/b.png')).toBe('b.png');
		expect(validateName('/tmp/a/b.png/')).toBe('b.png');
		expect(validateName('b.png')).toBe('b.png');
		expect(validateName('.hidden')).toBe('.hidden');
	});

	it('refuses what has no filename at all', () => {
		for (const source of ['', '/', '.', '..', 'a/..']) {
			expect(() => validateName(source), source).toThrow('attachment filename must be valid UTF-8');
		}
	});

	it('refuses control characters and overlong names', () => {
		expect(() => validateName('shot\0.png')).toThrow('attachment filename is unsafe');
		expect(() => validateName('shot\n.png')).toThrow('attachment filename is unsafe');
		expect(() => validateName('shot\u007f.png')).toThrow('attachment filename is unsafe');
		expect(() => validateName(`${'a'.repeat(252)}.png`)).toThrow('attachment filename is unsafe');
		expect(validateName(`${'a'.repeat(251)}.png`)).toHaveLength(255);
		expect(() => validateName('é'.repeat(128))).toThrow('attachment filename is unsafe');
	});
});

describe('expectedRelativePath', () => {
	it('spells the one shape every reader rebuilds', () => {
		const id = 'att-0123456789abcdef0123456789abcdef';
		expect(expectedRelativePath(id, 'notes.txt')).toBe(`${ATTACHMENT_ROOT}/${id}/notes.txt`);
	});

	it('refuses unsafe ids before looking at the name', () => {
		for (const id of ['att-../../secret', 'att-', 'ATT-0123456789abcdef0123456789abcdef', '']) {
			expect(() => expectedRelativePath(id, 'notes.txt'), id).toThrow('attachment id is unsafe');
		}
	});

	it('refuses a display name that is not already a bare name', () => {
		const id = 'att-0123456789abcdef0123456789abcdef';
		expect(() => expectedRelativePath(id, 'nested/notes.txt')).toThrow(
			'attachment filename is not normalized',
		);
		expect(() => expectedRelativePath(id, '../../../secret.txt')).toThrow(
			'attachment filename is not normalized',
		);
		expect(() => expectedRelativePath(id, '')).toThrow('attachment filename must be valid UTF-8');
	});
});

describe('attachmentsRoot', () => {
	it('creates the two-level root under the canonical checkout', () => {
		test = createAttachmentsTestContext();
		const worktree = test.checkout('ws-root');
		const root = attachmentsRoot(worktree);
		expect(root).toBe(join(realpathSync(worktree), '.malini', 'agent-attachments'));
		expect(existsSync(root)).toBe(true);
		expect(attachmentsRoot(worktree)).toBe(root);
	});

	it('refuses a symlinked `.malini` or a file where the root should be', () => {
		test = createAttachmentsTestContext();
		const linked = test.checkout('ws-linked');
		const escape = join(test.scratch, 'escape');
		mkdirSync(escape);
		symlinkSync(escape, join(linked, '.malini'));
		expect(() => attachmentsRoot(linked)).toThrow(
			'attachment staging directory is not a real directory',
		);

		const filed = test.checkout('ws-filed');
		writeFileSync(join(filed, '.malini'), 'not a directory');
		expect(() => attachmentsRoot(filed)).toThrow(
			'attachment staging directory is not a real directory',
		);
	});

	it('fails on a checkout that does not exist', () => {
		test = createAttachmentsTestContext();
		expect(() => attachmentsRoot(join(test.appDataRoot, 'missing'))).toThrow(
			/^canonicalize worktree: /,
		);
	});
});

describe('deleteAttachmentDirectory', () => {
	it('is a no-op for a directory that is already gone', () => {
		test = createAttachmentsTestContext();
		const worktree = test.checkout('ws-gone');
		expect(() =>
			deleteAttachmentDirectory(worktree, 'att-0123456789abcdef0123456789abcdef'),
		).not.toThrow();
	});

	it('refuses an unsafe id before touching the filesystem', () => {
		test = createAttachmentsTestContext();
		const worktree = test.checkout('ws-unsafe');
		expect(() => deleteAttachmentDirectory(worktree, '../..')).toThrow('attachment id is unsafe');
		expect(existsSync(join(worktree, ATTACHMENT_ROOT))).toBe(false);
	});

	it('refuses a symlink dressed as an attachment directory and leaves its target alone', () => {
		test = createAttachmentsTestContext();
		const worktree = test.checkout('ws-symlink');
		const root = attachmentsRoot(worktree);
		const target = join(test.scratch, 'target');
		mkdirSync(target);
		writeFileSync(join(target, 'keep.txt'), 'keep');
		const id = 'att-0123456789abcdef0123456789abcdef';
		symlinkSync(target, join(root, id));
		expect(() => deleteAttachmentDirectory(worktree, id)).toThrow(
			'staged attachment directory is not a real directory',
		);
		expect(existsSync(join(target, 'keep.txt'))).toBe(true);
	});

	it('removes a real attachment directory', () => {
		test = createAttachmentsTestContext();
		const worktree = test.checkout('ws-real');
		const root = attachmentsRoot(worktree);
		const id = 'att-0123456789abcdef0123456789abcdef';
		mkdirSync(join(root, id));
		writeFileSync(join(root, id, 'notes.txt'), 'bytes');
		deleteAttachmentDirectory(worktree, id);
		expect(existsSync(join(root, id))).toBe(false);
	});
});
