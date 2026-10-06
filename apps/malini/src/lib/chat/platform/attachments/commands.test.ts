import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dialog = vi.hoisted(() => ({
	showOpenDialog: vi.fn(),
}));
const focusedWindow = vi.hoisted(() => ({ current: null as object | null }));

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: {
		getAllWindows: () => [],
		getFocusedWindow: () => focusedWindow.current,
	},
	dialog,
}));

import { loadStoredAttachment, MAX_ATTACHMENT_FILES } from '../attachments.repository';
import { appendEvent } from '../events.repository';
import { run } from '$main/db/rows';
import { ATTACHMENT_COMMAND_NAMES, installAttachments } from './commands';
import { ATTACHMENT_ROOT } from './layout';
import { createElectronFilePicker, type FilePicker } from './picker';
import {
	createAttachmentsTestContext,
	PIXEL_PNG,
	scratchFile,
	SESSION_ID,
	WORKSTREAM_ID,
	type AttachmentsTestContext,
} from './test-support';

class FakePicker implements FilePicker {
	queued: string[][] = [];
	calls = 0;
	pickFiles(): Promise<string[]> {
		this.calls += 1;
		return Promise.resolve(this.queued.shift() ?? []);
	}
}

let test: AttachmentsTestContext;
let worktree: string;
let picker: FakePicker;

beforeEach(() => {
	test = createAttachmentsTestContext();
	worktree = test.seed();
	picker = new FakePicker();
	installAttachments(test.context, { picker });
});

afterEach(() => {
	test.cleanup();
	dialog.showOpenDialog.mockReset();
	focusedWindow.current = null;
});

async function invoke<T>(command: string, args: unknown): Promise<T>;
async function invoke(command: string, args: unknown): Promise<unknown> {
	const response = await test.context.commands.invoke({ command, args });
	if (!response.ok) throw new Error(response.error);
	return response.value;
}

async function invokeError(command: string, args: unknown): Promise<string> {
	const response = await test.context.commands.invoke({ command, args });
	if (response.ok) throw new Error(`expected ${command} to fail`);
	return response.error;
}

interface Staged {
	id: string;
	displayName: string;
	relativePath: string;
	mediaType: string;
	size: number;
	sha256: string;
}

describe('installAttachments', () => {
	it('registers the five attachment commands', () => {
		for (const name of ATTACHMENT_COMMAND_NAMES) {
			expect(test.context.commands.has(name), name).toBe(true);
		}
		expect(() => installAttachments(test.context, { picker })).toThrow(/already registered/);
	});
});

describe('chat.pick-and-stage-attachments', () => {
	it('stages what the picker returns under the app data root and persists the rows', async () => {
		test.checkout(WORKSTREAM_ID, { git: true });
		picker.queued.push([
			scratchFile(test, 'notes.txt', 'compact composer'),
			scratchFile(test, 'shot.png', PIXEL_PNG),
		]);
		const staged = await invoke<Staged[]>('chat.pick-and-stage-attachments', {
			workstreamId: WORKSTREAM_ID,
		});
		expect(staged).toHaveLength(2);
		expect(staged.map((attachment) => Object.keys(attachment).sort())).toEqual([
			['displayName', 'id', 'mediaType', 'relativePath', 'sha256', 'size'],
			['displayName', 'id', 'mediaType', 'relativePath', 'sha256', 'size'],
		]);
		const [notes, shot] = staged as [Staged, Staged];
		expect(notes.displayName).toBe('notes.txt');
		expect(notes.mediaType).toBe('text/plain');
		expect(shot.mediaType).toBe('image/png');
		expect(shot.size).toBe(PIXEL_PNG.length);

		const expectedDir = join(test.appDataRoot, 'workstreams', WORKSTREAM_ID, ATTACHMENT_ROOT);
		expect(worktree.endsWith(join('workstreams', WORKSTREAM_ID))).toBe(true);
		expect(readdirSync(expectedDir).sort()).toEqual([notes.id, shot.id].sort());
		expect(readFileSync(join(worktree, shot.relativePath))).toEqual(PIXEL_PNG);

		for (const attachment of staged) {
			const stored = loadStoredAttachment(test.db, attachment.id);
			expect(stored?.state).toBe('staged');
			expect(stored?.workstreamId).toBe(WORKSTREAM_ID);
			expect(stored?.expiresAt).not.toBeNull();
		}

		const exclude = readFileSync(join(worktree, '.git', 'info', 'exclude'), 'utf8');
		expect(exclude).toContain('.malini/');
	});

	it('returns an empty list when the picker is canceled and stages nothing', async () => {
		test.checkout(WORKSTREAM_ID, { git: true });
		const staged = await invoke<Staged[]>('chat.pick-and-stage-attachments', {
			workstreamId: WORKSTREAM_ID,
		});
		expect(staged).toEqual([]);
		expect(picker.calls).toBe(1);
		expect(existsSync(join(worktree, ATTACHMENT_ROOT))).toBe(false);
	});

	it('collects expired attachments before opening the picker', async () => {
		test.checkout(WORKSTREAM_ID, { git: true });
		picker.queued.push([scratchFile(test, 'old.txt', 'old')]);
		const [old] = await invoke<Staged[]>('chat.pick-and-stage-attachments', {
			workstreamId: WORKSTREAM_ID,
		});
		run(
			test.db,
			'UPDATE agent_attachments SET expires_at = ? WHERE id = ?',
			'2000-01-01T00:00:00.000Z',
			old!.id,
		);
		const again = await invoke<Staged[]>('chat.pick-and-stage-attachments', {
			workstreamId: WORKSTREAM_ID,
		});
		expect(again).toEqual([]);
		expect(existsSync(join(worktree, old!.relativePath))).toBe(false);
		expect(loadStoredAttachment(test.db, old!.id)).toBeNull();
	});

	it('refuses a workstream that has no checkout, before the picker opens', async () => {
		const error = await invokeError('chat.pick-and-stage-attachments', {
			workstreamId: 'workstream-nowhere',
		});
		expect(error).toBe("This workstream's folder is missing.");
		expect(picker.calls).toBe(0);
	});

	it('refuses an unsafe workstream id and a missing argument', async () => {
		expect(
			await invokeError('chat.pick-and-stage-attachments', { workstreamId: '../etc' }),
		).toMatch(/^unsafe path: /);
		expect(await invokeError('chat.pick-and-stage-attachments', {})).toBe(
			'invalid args: `workstreamId` must be a string',
		);
	});

	it('refuses a checkout that is not a git repository', async () => {
		picker.queued.push([scratchFile(test, 'notes.txt', 'x')]);
		const error = await invokeError('chat.pick-and-stage-attachments', {
			workstreamId: WORKSTREAM_ID,
		});
		expect(error.length).toBeGreaterThan(0);
		expect(picker.calls).toBe(0);
	});

	it('cleans the directories up when the rows cannot be written', async () => {
		test.checkout(WORKSTREAM_ID, { git: true });
		picker.queued.push([scratchFile(test, 'notes.txt', 'x')]);
		run(test.db, "UPDATE workstreams SET status = 'paused' WHERE id = ?", WORKSTREAM_ID);
		const error = await invokeError('chat.pick-and-stage-attachments', {
			workstreamId: WORKSTREAM_ID,
		});
		expect(error).toBe(`workstream \`${WORKSTREAM_ID}\` is missing or inactive`);
		expect(readdirSync(join(worktree, ATTACHMENT_ROOT))).toEqual([]);
	});
});

describe('chat.stage-fork-transcript', () => {
	it('stages the chat up to the forked run as a markdown attachment', async () => {
		test.checkout(WORKSTREAM_ID, { git: true });
		run(test.db, "UPDATE agent_sessions SET display_name = 'Fix login' WHERE id = ?", SESSION_ID);
		appendEvent(test.db, SESSION_ID, 'run-1', 'user.message', { text: 'Fix the login flow' });
		appendEvent(test.db, SESSION_ID, 'run-1', 'assistant.message', { text: 'Fixed it.' });
		const atSeq = appendEvent(test.db, SESSION_ID, 'run-1', 'run.completed', {
			summary: 'Fixed it.',
		});
		appendEvent(test.db, SESSION_ID, 'run-2', 'user.message', { text: 'Later work' });

		const staged = await invoke<Staged>('chat.stage-fork-transcript', {
			workstreamId: WORKSTREAM_ID,
			sessionId: SESSION_ID,
			atSeq,
		});

		expect(staged.displayName).toBe('Transcript of Fix login.md');
		expect(staged.mediaType).toBe('text/plain');
		expect(staged.relativePath).toBe(`${ATTACHMENT_ROOT}/${staged.id}/Transcript of Fix login.md`);
		const markdown = readFileSync(join(worktree, staged.relativePath), 'utf8');
		expect(markdown).toBe(
			'# Transcript of Fix login\n\n## User\n\nFix the login flow\n\n## Assistant\n\nFixed it.\n',
		);
		expect(staged.size).toBe(Buffer.byteLength(markdown));
		const stored = loadStoredAttachment(test.db, staged.id);
		expect(stored?.state).toBe('staged');
		expect(stored?.workstreamId).toBe(WORKSTREAM_ID);
	});

	it('refuses a chat of another workstream and a seq the chat never recorded', async () => {
		test.checkout(WORKSTREAM_ID, { git: true });
		test.seed('workstream-other', 'session-other');
		appendEvent(test.db, 'session-other', 'run-1', 'user.message', { text: 'Elsewhere' });

		expect(
			await invokeError('chat.stage-fork-transcript', {
				workstreamId: WORKSTREAM_ID,
				sessionId: 'session-other',
				atSeq: 1,
			}),
		).toBe('chat `session-other` is not in this workstream');
		expect(
			await invokeError('chat.stage-fork-transcript', {
				workstreamId: WORKSTREAM_ID,
				sessionId: SESSION_ID,
				atSeq: 1,
			}),
		).toMatch(/no event at seq `1`/u);
	});
});

describe('chat.stage-attachment-bytes', () => {
	it('stages a paste and round-trips it through read and remove', async () => {
		test.checkout(WORKSTREAM_ID, { git: true });
		const staged = await invoke<Staged>('chat.stage-attachment-bytes', {
			workstreamId: WORKSTREAM_ID,
			fileName: 'pasted-image.png',
			base64: PIXEL_PNG.toString('base64'),
		});
		expect(staged.displayName).toBe('pasted-image.png');
		expect(staged.mediaType).toBe('image/png');
		expect(staged.relativePath).toBe(`${ATTACHMENT_ROOT}/${staged.id}/pasted-image.png`);

		const read = await invoke<{ mediaType: string; base64: string; size: number }>(
			'chat.read-staged-attachment',
			{ workstreamId: WORKSTREAM_ID, attachmentId: staged.id },
		);
		expect(Object.keys(read).sort()).toEqual(['base64', 'mediaType', 'size']);
		expect(read.mediaType).toBe('image/png');
		expect(read.size).toBe(PIXEL_PNG.length);
		expect(Buffer.from(read.base64, 'base64')).toEqual(PIXEL_PNG);

		const removed = await invoke<null>('chat.remove-staged-attachment', {
			workstreamId: WORKSTREAM_ID,
			attachmentId: staged.id,
		});
		expect(removed).toBeNull();
		expect(existsSync(join(worktree, staged.relativePath))).toBe(false);
		expect(loadStoredAttachment(test.db, staged.id)?.state).toBe('removed');
	});

	it('reports the renderer-facing refusals as plain strings', async () => {
		test.checkout(WORKSTREAM_ID, { git: true });
		expect(
			await invokeError('chat.stage-attachment-bytes', {
				workstreamId: WORKSTREAM_ID,
				fileName: 'payload.exe',
				base64: PIXEL_PNG.toString('base64'),
			}),
		).toBe('`payload.exe` is not a type that can be pasted as an attachment');
		expect(
			await invokeError('chat.stage-attachment-bytes', {
				workstreamId: WORKSTREAM_ID,
				fileName: 'nested/shot.png',
				base64: PIXEL_PNG.toString('base64'),
			}),
		).toBe('attachment filename is not normalized');
		expect(
			await invokeError('chat.stage-attachment-bytes', {
				workstreamId: WORKSTREAM_ID,
				fileName: 'shot.png',
			}),
		).toBe('invalid args: `base64` must be a string');
		for (let index = 0; index < MAX_ATTACHMENT_FILES; index += 1) {
			await invoke('chat.stage-attachment-bytes', {
				workstreamId: WORKSTREAM_ID,
				fileName: `shot-${index}.png`,
				base64: PIXEL_PNG.toString('base64'),
			});
		}
		expect(
			await invokeError('chat.stage-attachment-bytes', {
				workstreamId: WORKSTREAM_ID,
				fileName: 'one-too-many.png',
				base64: PIXEL_PNG.toString('base64'),
			}),
		).toBe(`at most ${MAX_ATTACHMENT_FILES} files can be attached`);
	});
});

describe('chat.read-staged-attachment', () => {
	it('answers null past the preview cap and rejects everything else', async () => {
		test.checkout(WORKSTREAM_ID, { git: true });
		const staged = await invoke<Staged>('chat.stage-attachment-bytes', {
			workstreamId: WORKSTREAM_ID,
			fileName: 'shot.png',
			base64: PIXEL_PNG.toString('base64'),
		});
		run(test.db, 'UPDATE agent_attachments SET size = ? WHERE id = ?', 5 * 1024 * 1024, staged.id);
		expect(
			await invoke('chat.read-staged-attachment', {
				workstreamId: WORKSTREAM_ID,
				attachmentId: staged.id,
			}),
		).toBeNull();

		run(test.db, 'UPDATE agent_attachments SET size = ? WHERE id = ?', staged.size, staged.id);
		writeFileSync(join(worktree, staged.relativePath), 'tampered');
		expect(
			await invokeError('chat.read-staged-attachment', {
				workstreamId: WORKSTREAM_ID,
				attachmentId: staged.id,
			}),
		).toBe(`attachment \`${staged.id}\` changed after staging`);

		expect(
			await invokeError('chat.read-staged-attachment', {
				workstreamId: WORKSTREAM_ID,
				attachmentId: '../../etc/passwd',
			}),
		).toBe('attachment id is unsafe');
		test.seed('workstream-other', 'session-other');
		expect(
			await invokeError('chat.read-staged-attachment', {
				workstreamId: 'workstream-other',
				attachmentId: staged.id,
			}),
		).toBe(`attachment \`${staged.id}\` is not staged for this workstream`);
	});
});

describe('chat.remove-staged-attachment', () => {
	it('names a missing attachment and an unsafe id', async () => {
		const missing = 'att-0123456789abcdef0123456789abcdef';
		expect(
			await invokeError('chat.remove-staged-attachment', {
				workstreamId: WORKSTREAM_ID,
				attachmentId: missing,
			}),
		).toBe(`staged attachment \`${missing}\` not found`);
		expect(
			await invokeError('chat.remove-staged-attachment', {
				workstreamId: WORKSTREAM_ID,
				attachmentId: 'att-../x',
			}),
		).toBe('attachment id is unsafe');
	});
});

describe('deps', () => {
	it('uses an injected checkout resolver and exclude installer', async () => {
		const other = createAttachmentsTestContext();
		try {
			other.seed();
			const calls: string[] = [];
			const elsewhere = other.checkout('elsewhere');
			installAttachments(other.context, {
				picker,
				resolveWorkstreamCheckout: (workstreamId) => {
					calls.push(`resolve:${workstreamId}`);
					return elsewhere;
				},
				ensureGitExcludes: async (path) => {
					calls.push(`exclude:${path}`);
				},
			});
			const response = await other.context.commands.invoke({
				command: 'chat.stage-attachment-bytes',
				args: {
					workstreamId: WORKSTREAM_ID,
					fileName: 'shot.png',
					base64: PIXEL_PNG.toString('base64'),
				},
			});
			expect(response.ok).toBe(true);
			expect(calls).toEqual([`resolve:${WORKSTREAM_ID}`, `exclude:${elsewhere}`]);
			expect(readdirSync(join(elsewhere, ATTACHMENT_ROOT))).toHaveLength(1);
		} finally {
			other.cleanup();
		}
	});
});

describe('createElectronFilePicker', () => {
	it('opens a multi-select file dialog and maps cancel to an empty list', async () => {
		dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
		expect(await createElectronFilePicker().pickFiles()).toEqual([]);
		expect(dialog.showOpenDialog).toHaveBeenLastCalledWith({
			properties: ['openFile', 'multiSelections'],
		});

		const owner = { id: 'main-window' };
		focusedWindow.current = owner;
		dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/a.png'] });
		expect(await createElectronFilePicker().pickFiles()).toEqual(['/tmp/a.png']);
		expect(dialog.showOpenDialog).toHaveBeenLastCalledWith(owner, {
			properties: ['openFile', 'multiSelections'],
		});
	});
});
