import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	truncateSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	loadStoredAttachment,
	MAX_ATTACHMENT_FILE_BYTES,
	MAX_ATTACHMENT_FILES,
	MAX_ATTACHMENT_TOTAL_BYTES,
} from '../attachments.repository';
import type { AgentRun } from '../runs.repository';
import { insertSession } from '../sessions.repository';
import { get, run, scalar } from '$main/db/rows';
import { ATTACHMENT_ROOT, MAX_ATTACHMENT_BASE64_CHARS, MAX_PREVIEW_BYTES } from './layout';
import {
	bindRunAttachments,
	decodeStrictBase64,
	gcStaged,
	persistStagedAttachments,
	readStaged,
	removeStaged,
	stageBytes,
	stageSelectedPaths,
	verifyStagedFile,
} from './service';
import {
	createAttachmentsTestContext,
	EXPIRES_TOMORROW,
	PIXEL_PNG,
	scratchFile,
	SESSION_ID,
	STAGED_AT,
	stagedInDb,
	WORKSTREAM_ID,
	type AttachmentsTestContext,
} from './test-support';

let test: AttachmentsTestContext;
let worktree: string;

beforeEach(() => {
	test = createAttachmentsTestContext();
	worktree = test.seed();
});

afterEach(() => {
	test.cleanup();
});

function attachmentRow(id: string): {
	workstream_id: string;
	state: string;
	run_id: string | null;
	expires_at: string | null;
} {
	const row = get<{
		workstream_id: string;
		state: string;
		run_id: string | null;
		expires_at: string | null;
	}>(
		test.db,
		'SELECT workstream_id, state, run_id, expires_at FROM agent_attachments WHERE id = ?',
		id,
	);
	if (!row) throw new Error(`no row for ${id}`);
	return row;
}

function runRows(runId: string): number {
	return scalar(test.db, 'SELECT COUNT(*) FROM agent_runs WHERE id = ?', runId);
}

function agentRun(id: string, prompt = 'inspect attachment', sessionId = SESSION_ID): AgentRun {
	return {
		id,
		sessionId,
		prompt,
		startedAt: '2026-07-11T01:00:00.000Z',
		completedAt: null,
		summary: null,
		error: null,
	};
}

function paste(fileName: string, bytes: Buffer, workstreamId = WORKSTREAM_ID) {
	return stageBytes(
		test.db,
		worktree,
		workstreamId,
		fileName,
		bytes.toString('base64'),
		STAGED_AT,
		EXPIRES_TOMORROW,
	);
}

describe('stageSelectedPaths', () => {
	it('stages a regular file with a bounded descriptor and hash', () => {
		const source = scratchFile(test, 'notes.txt', 'compact composer');
		const staged = stageSelectedPaths(worktree, [source]);
		expect(staged).toHaveLength(1);
		const attachment = staged[0]!;
		expect(attachment.displayName).toBe('notes.txt');
		expect(attachment.mediaType).toBe('text/plain');
		expect(attachment.size).toBe(16);
		expect(attachment.relativePath.startsWith(`${ATTACHMENT_ROOT}/att-`)).toBe(true);
		expect(attachment.relativePath).toBe(`${ATTACHMENT_ROOT}/${attachment.id}/notes.txt`);
		expect(readFileSync(join(worktree, attachment.relativePath), 'utf8')).toBe('compact composer');
		expect(attachment.sha256).toMatch(/^[0-9a-f]{64}$/);
		if (process.platform !== 'win32') {
			expect(statSync(join(worktree, attachment.relativePath)).mode & 0o777).toBe(0o600);
			expect(statSync(join(worktree, ATTACHMENT_ROOT, attachment.id)).mode & 0o777).toBe(0o700);
		}
		expect(readdirSync(join(worktree, ATTACHMENT_ROOT, attachment.id))).toEqual(['notes.txt']);
	});

	it('rejects directories and oversized files', () => {
		expect(() => stageSelectedPaths(worktree, [test.scratch])).toThrow(
			'attachments must be regular files, not links or directories',
		);
		const oversized = scratchFile(test, 'oversized.bin', 'x');
		truncateSync(oversized, MAX_ATTACHMENT_FILE_BYTES + 1);
		expect(() => stageSelectedPaths(worktree, [oversized])).toThrow(
			`attachment exceeds the ${MAX_ATTACHMENT_FILE_BYTES}-byte file limit`,
		);
	});

	it('rejects a total over the budget before writing anything', () => {
		const a = scratchFile(test, 'a.bin', 'x');
		truncateSync(a, MAX_ATTACHMENT_FILE_BYTES);
		const b = scratchFile(test, 'b.bin', 'x');
		truncateSync(b, MAX_ATTACHMENT_FILE_BYTES);
		const c = scratchFile(test, 'c.bin', 'x');
		truncateSync(c, MAX_ATTACHMENT_TOTAL_BYTES - 2 * MAX_ATTACHMENT_FILE_BYTES + 1);
		expect(() => stageSelectedPaths(worktree, [a, b, c])).toThrow(
			`attachments exceed the ${MAX_ATTACHMENT_TOTAL_BYTES}-byte total limit`,
		);
		expect(readdirSync(join(worktree, ATTACHMENT_ROOT))).toEqual([]);
	});

	it.skipIf(process.platform === 'win32')(
		'rejects selected symlinks and symlinked staging roots',
		() => {
			const source = scratchFile(test, 'source.txt', 'secret');
			const selectedLink = join(test.scratch, 'selected-link.txt');
			symlinkSync(source, selectedLink);
			expect(() => stageSelectedPaths(worktree, [selectedLink])).toThrow(
				'attachments must be regular files, not links or directories',
			);

			const linkedWorktree = test.checkout('workstream-linked');
			const escape = join(test.scratch, 'escape');
			mkdirSync(escape);
			symlinkSync(escape, join(linkedWorktree, '.malini'));
			expect(() => stageSelectedPaths(linkedWorktree, [source])).toThrow(
				'attachment staging directory is not a real directory',
			);
			expect(readdirSync(escape)).toEqual([]);
		},
	);

	it('enforces the file count limit before writing', () => {
		const sources = Array.from({ length: MAX_ATTACHMENT_FILES + 1 }, (_, index) =>
			scratchFile(test, `${index}.txt`, 'x'),
		);
		expect(() => stageSelectedPaths(worktree, sources)).toThrow(
			`at most ${MAX_ATTACHMENT_FILES} files can be attached`,
		);
		expect(existsSync(join(worktree, ATTACHMENT_ROOT))).toBe(false);
	});

	it('stages nothing for an empty selection and returns an empty list', () => {
		expect(stageSelectedPaths(worktree, [])).toEqual([]);
		expect(existsSync(join(worktree, ATTACHMENT_ROOT))).toBe(false);
	});

	it('rolls back every directory of a selection when one file fails mid-way', () => {
		const good = scratchFile(test, 'good.txt', 'fine');
		const bad = scratchFile(test, 'bad\n.txt', 'fine');
		expect(() => stageSelectedPaths(worktree, [good, bad])).toThrow(
			'attachment filename is unsafe',
		);
		expect(readdirSync(join(worktree, ATTACHMENT_ROOT))).toEqual([]);
	});
});

describe('remove and gc', () => {
	it('durable stage records the owner, then remove is gc-recoverable', () => {
		const attachment = stagedInDb(test, worktree, 'durable');
		const before = attachmentRow(attachment.id);
		expect(before.workstream_id).toBe(WORKSTREAM_ID);
		expect(before.state).toBe('staged');
		expect(before.run_id).toBeNull();

		removeStaged(test.db, worktree, WORKSTREAM_ID, attachment.id, '2026-07-11T01:00:00.000Z');
		expect(existsSync(join(worktree, attachment.relativePath))).toBe(false);
		expect(attachmentRow(attachment.id).state).toBe('removed');
		expect(gcStaged(test.db, worktree, WORKSTREAM_ID, '2026-07-11T01:00:00.000Z')).toBe(1);
		expect(loadStoredAttachment(test.db, attachment.id)).toBeNull();
	});

	it('refuses to remove what is not staged, with the renderer-facing messages', () => {
		expect(() =>
			removeStaged(test.db, worktree, WORKSTREAM_ID, 'att-../x', '2026-07-11T01:00:00.000Z'),
		).toThrow('attachment id is unsafe');
		const missing = 'att-0123456789abcdef0123456789abcdef';
		expect(() =>
			removeStaged(test.db, worktree, WORKSTREAM_ID, missing, '2026-07-11T01:00:00.000Z'),
		).toThrow(`staged attachment \`${missing}\` not found`);
		const attachment = stagedInDb(test, worktree, 'twice');
		removeStaged(test.db, worktree, WORKSTREAM_ID, attachment.id, '2026-07-11T01:00:00.000Z');
		expect(() =>
			removeStaged(test.db, worktree, WORKSTREAM_ID, attachment.id, '2026-07-11T01:00:00.000Z'),
		).toThrow(`attachment \`${attachment.id}\` cannot be removed from state \`removed\``);
	});

	it('ttl gc expires staged rows and files', () => {
		const attachment = stagedInDb(test, worktree, 'expired', '2026-07-11T00:30:00.000Z');
		expect(gcStaged(test.db, worktree, WORKSTREAM_ID, '2026-07-11T01:00:00.000Z')).toBe(1);
		expect(existsSync(join(worktree, attachment.relativePath))).toBe(false);
		expect(
			scalar(test.db, 'SELECT COUNT(*) FROM agent_attachments WHERE id = ?', attachment.id),
		).toBe(0);
	});

	it('leaves a live staged attachment alone', () => {
		const attachment = stagedInDb(test, worktree, 'alive');
		expect(gcStaged(test.db, worktree, WORKSTREAM_ID, '2026-07-11T01:00:00.000Z')).toBe(0);
		expect(existsSync(join(worktree, attachment.relativePath))).toBe(true);
		expect(attachmentRow(attachment.id).state).toBe('staged');
	});

	it('collects a row whose directory is already gone', () => {
		const attachment = stagedInDb(test, worktree, 'orphan-row');
		rmSync(join(worktree, ATTACHMENT_ROOT, attachment.id), { recursive: true });
		run(test.db, 'UPDATE agent_attachments SET state = ? WHERE id = ?', 'removed', attachment.id);
		expect(gcStaged(test.db, worktree, WORKSTREAM_ID, '2026-07-11T00:00:00.000Z')).toBe(1);
		expect(loadStoredAttachment(test.db, attachment.id)).toBeNull();
	});
});

describe('bindRunAttachments', () => {
	it('send-time verification atomically inserts the run and binds the attachment', () => {
		const attachment = stagedInDb(test, worktree, 'verified');
		const verified = bindRunAttachments(test.db, worktree, {
			workstreamId: WORKSTREAM_ID,
			run: agentRun('run-attachments'),
			attachmentIds: [attachment.id],
			now: '2026-07-11T01:00:00.000Z',
		});
		expect(verified).toEqual([attachment]);
		const row = attachmentRow(attachment.id);
		expect(row.state).toBe('bound');
		expect(row.run_id).toBe('run-attachments');
		expect(row.expires_at).toBeNull();

		run(test.db, "DELETE FROM agent_runs WHERE id = 'run-attachments'");
		expect(
			gcStaged(test.db, worktree, WORKSTREAM_ID, '2026-07-11T02:00:00.000Z'),
			'run deletion leaves a GC-visible orphan instead of an untracked file',
		).toBe(1);
		expect(existsSync(join(worktree, attachment.relativePath))).toBe(false);
	});

	it('inserts a run with no attachments without touching the staging root', () => {
		bindRunAttachments(test.db, worktree, {
			workstreamId: WORKSTREAM_ID,
			run: agentRun('run-bare'),
			attachmentIds: [],
			now: '2026-07-11T01:00:00.000Z',
		});
		expect(runRows('run-bare')).toBe(1);
		expect(existsSync(join(worktree, ATTACHMENT_ROOT))).toBe(false);
	});

	it('a tampered attachment rolls back the run and keeps the staged state', () => {
		const attachment = stagedInDb(test, worktree, 'original');
		writeFileSync(join(worktree, attachment.relativePath), 'tampered');
		expect(() =>
			bindRunAttachments(test.db, worktree, {
				workstreamId: WORKSTREAM_ID,
				run: agentRun('run-tampered'),
				attachmentIds: [attachment.id],
				now: '2026-07-11T01:00:00.000Z',
			}),
		).toThrow(`attachment \`${attachment.id}\` failed send-time integrity verification`);
		expect(runRows('run-tampered')).toBe(0);
		expect(attachmentRow(attachment.id).state).toBe('staged');
	});

	it('a file that grew rolls back with the size message', () => {
		const attachment = stagedInDb(test, worktree, 'short');
		writeFileSync(join(worktree, attachment.relativePath), 'a much longer body of text');
		expect(() =>
			bindRunAttachments(test.db, worktree, {
				workstreamId: WORKSTREAM_ID,
				run: agentRun('run-grown'),
				attachmentIds: [attachment.id],
				now: '2026-07-11T01:00:00.000Z',
			}),
		).toThrow(`attachment \`${attachment.id}\` changed after staging`);
		expect(runRows('run-grown')).toBe(0);
	});

	it('an attachment cannot be bound by another workstream', () => {
		const attachment = stagedInDb(test, worktree, 'owned');
		test.seed('workstream-foreign', 'session-foreign');
		expect(() =>
			bindRunAttachments(test.db, test.checkout('workstream-foreign'), {
				workstreamId: 'workstream-foreign',
				run: agentRun('run-foreign', 'steal attachment', 'session-foreign'),
				attachmentIds: [attachment.id],
				now: '2026-07-11T01:00:00.000Z',
			}),
		).toThrow(
			`attachment \`${attachment.id}\` is expired, already consumed, or belongs to another workstream`,
		);
		expect(runRows('run-foreign')).toBe(0);
		expect(attachmentRow(attachment.id).workstream_id).toBe(WORKSTREAM_ID);
	});
});

describe('verifyStagedFile', () => {
	it('refuses a row whose metadata does not match the file name or limits', () => {
		const attachment = stagedInDb(test, worktree, 'meta');
		const stored = loadStoredAttachment(test.db, attachment.id)!;
		expect(() =>
			verifyStagedFile(worktree, {
				...stored,
				descriptor: { ...stored.descriptor, mediaType: 'image/png' },
			}),
		).toThrow(`attachment \`${attachment.id}\` has invalid descriptor metadata`);
		expect(() =>
			verifyStagedFile(worktree, {
				...stored,
				descriptor: { ...stored.descriptor, sha256: 'nothex' },
			}),
		).toThrow(`attachment \`${attachment.id}\` has invalid descriptor metadata`);
		expect(() =>
			verifyStagedFile(worktree, {
				...stored,
				descriptor: { ...stored.descriptor, relativePath: `${ATTACHMENT_ROOT}/other/meta.txt` },
			}),
		).toThrow(`attachment \`${attachment.id}\` has an invalid stored path`);
		expect(() => verifyStagedFile(worktree, stored)).not.toThrow();
	});

	it.skipIf(process.platform === 'win32')('refuses a staged file replaced by a symlink', () => {
		const attachment = stagedInDb(test, worktree, 'linked');
		const path = join(worktree, attachment.relativePath);
		const elsewhere = scratchFile(test, 'elsewhere.txt', 'linked');
		rmSync(path);
		symlinkSync(elsewhere, path);
		expect(() => verifyStagedFile(worktree, loadStoredAttachment(test.db, attachment.id)!)).toThrow(
			/^open selected attachment without following links: /,
		);
	});
});

describe('readStaged', () => {
	it('reads staged attachment bytes with a derived media type', () => {
		const source = scratchFile(test, 'shot.png', Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'));
		const [attachment] = stageSelectedPaths(worktree, [source]);
		persistStagedAttachments(test.db, WORKSTREAM_ID, [attachment!], STAGED_AT, EXPIRES_TOMORROW);
		const read = readStaged(test.db, worktree, WORKSTREAM_ID, attachment!.id);
		expect(read).not.toBeNull();
		expect(read!.mediaType).toBe('image/png');
		expect(read!.size).toBe(8);
		expect(Buffer.from(read!.base64, 'base64')).toEqual(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'));
	});

	it('refuses unsafe attachment ids before touching the filesystem', () => {
		for (const id of [
			'att-../../../../secret.txt',
			'../secret.txt',
			'/etc/passwd',
			'att-',
			'att-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
			'att-0123456789abcdef0123456789abcde',
		]) {
			expect(() => readStaged(test.db, worktree, WORKSTREAM_ID, id), id).toThrow(
				'attachment id is unsafe',
			);
		}
		expect(existsSync(join(worktree, ATTACHMENT_ROOT))).toBe(false);
	});

	it('refuses traversal dressed as a well-formed id', () => {
		const attachment = stagedInDb(test, worktree, 'owned');
		run(
			test.db,
			'UPDATE agent_attachments SET relative_path = ? WHERE id = ?',
			`${ATTACHMENT_ROOT}/${attachment.id}/../../../secret.txt`,
			attachment.id,
		);
		const escaped = join(test.appDataRoot, 'secret.txt');
		writeFileSync(escaped, 'not yours');
		expect(() => readStaged(test.db, worktree, WORKSTREAM_ID, attachment.id)).toThrow(
			'invalid stored path',
		);
		expect(readFileSync(escaped, 'utf8')).toBe('not yours');

		run(
			test.db,
			'UPDATE agent_attachments SET display_name = ?, relative_path = ? WHERE id = ?',
			'../../../secret.txt',
			`${ATTACHMENT_ROOT}/${attachment.id}/../../../secret.txt`,
			attachment.id,
		);
		expect(() => readStaged(test.db, worktree, WORKSTREAM_ID, attachment.id)).toThrow(
			'not normalized',
		);
	});

	it('refuses reads from another workstream or of a consumed attachment', () => {
		const attachment = stagedInDb(test, worktree, 'owned');
		expect(() => readStaged(test.db, worktree, 'workstream-foreign', attachment.id)).toThrow(
			`attachment \`${attachment.id}\` is not staged for this workstream`,
		);
		bindRunAttachments(test.db, worktree, {
			workstreamId: WORKSTREAM_ID,
			run: agentRun('run-preview', 'send it'),
			attachmentIds: [attachment.id],
			now: '2026-07-11T01:00:00.000Z',
		});
		expect(() => readStaged(test.db, worktree, WORKSTREAM_ID, attachment.id)).toThrow(
			`attachment \`${attachment.id}\` is not staged for this workstream`,
		);
		const missing = 'att-0123456789abcdef0123456789abcdef';
		expect(() => readStaged(test.db, worktree, WORKSTREAM_ID, missing)).toThrow(
			`staged attachment \`${missing}\` not found`,
		);
	});

	it('declines attachments over the preview cap and refuses files that changed', () => {
		const attachment = stagedInDb(test, worktree, 'original');
		run(
			test.db,
			'UPDATE agent_attachments SET size = ? WHERE id = ?',
			MAX_PREVIEW_BYTES + 1,
			attachment.id,
		);
		expect(
			readStaged(test.db, worktree, WORKSTREAM_ID, attachment.id),
			'an attachment past the preview cap declines rather than failing',
		).toBeNull();

		run(
			test.db,
			'UPDATE agent_attachments SET size = ? WHERE id = ?',
			attachment.size,
			attachment.id,
		);
		writeFileSync(join(worktree, attachment.relativePath), 'tampered');
		expect(() => readStaged(test.db, worktree, WORKSTREAM_ID, attachment.id)).toThrow(
			`attachment \`${attachment.id}\` changed after staging`,
		);
	});

	it('reads a file larger than one copy buffer back intact', () => {
		const big = Buffer.alloc(200 * 1024);
		for (let index = 0; index < big.length; index += 1) big[index] = index % 251;
		const source = scratchFile(test, 'big.bin', big);
		const [attachment] = stageSelectedPaths(worktree, [source]);
		persistStagedAttachments(test.db, WORKSTREAM_ID, [attachment!], STAGED_AT, EXPIRES_TOMORROW);
		const read = readStaged(test.db, worktree, WORKSTREAM_ID, attachment!.id)!;
		expect(read.mediaType).toBe('application/octet-stream');
		expect(Buffer.from(read.base64, 'base64')).toEqual(big);
	});
});

describe('stageBytes', () => {
	it('stages pasted bytes into the same shape the picker produces', () => {
		const attachment = paste('pasted-image.png', PIXEL_PNG);
		expect(attachment.displayName).toBe('pasted-image.png');
		expect(attachment.mediaType).toBe('image/png');
		expect(attachment.size).toBe(PIXEL_PNG.length);
		expect(attachment.relativePath).toBe(`${ATTACHMENT_ROOT}/${attachment.id}/pasted-image.png`);
		expect(readFileSync(join(worktree, attachment.relativePath))).toEqual(PIXEL_PNG);
		if (process.platform !== 'win32') {
			expect(statSync(join(worktree, attachment.relativePath)).mode & 0o777).toBe(0o600);
		}
		expect(attachmentRow(attachment.id).state).toBe('staged');

		const read = readStaged(test.db, worktree, WORKSTREAM_ID, attachment.id)!;
		expect(read.mediaType).toBe('image/png');
		expect(Buffer.from(read.base64, 'base64')).toEqual(PIXEL_PNG);
		removeStaged(test.db, worktree, WORKSTREAM_ID, attachment.id, '2026-07-11T01:00:00.000Z');
		expect(existsSync(join(worktree, attachment.relativePath))).toBe(false);
	});

	it('refuses unsafe pasted filenames before touching the filesystem', () => {
		const overlong = `${'a'.repeat(300)}.png`;
		for (const fileName of [
			'nested/shot.png',
			'../../../etc/passwd.png',
			'..',
			'.',
			'',
			'shot\0.png',
			'shot\n.png',
			'.partial',
			'.hidden.png',
			overlong,
		]) {
			expect(
				() => paste(fileName, PIXEL_PNG),
				`filename \`${fileName}\` was not refused`,
			).toThrow();
		}
		expect(() => paste('.partial', PIXEL_PNG)).toThrow(
			'attachment filename must not start with a dot',
		);
		expect(() => paste('nested/shot.png', PIXEL_PNG)).toThrow(
			'attachment filename is not normalized',
		);
		expect(existsSync(join(worktree, ATTACHMENT_ROOT))).toBe(false);
	});

	it('derives the media type from the name and refuses what it cannot name', () => {
		expect(paste('screenshot.txt', PIXEL_PNG).mediaType).toBe('text/plain');
		for (const fileName of ['payload.exe', 'archive.zip', 'noextension', 'shot.PNG.bin']) {
			expect(() => paste(fileName, PIXEL_PNG)).toThrow(
				`\`${fileName}\` is not a type that can be pasted as an attachment`,
			);
		}
		expect(paste('SHOT.PNG', PIXEL_PNG).mediaType).toBe('image/png');
	});

	it('refuses oversized and malformed payloads without writing', () => {
		const unbounded = Buffer.alloc(MAX_ATTACHMENT_FILE_BYTES + 3).toString('base64');
		expect(unbounded.length).toBeGreaterThan(MAX_ATTACHMENT_BASE64_CHARS);
		expect(() =>
			stageBytes(
				test.db,
				worktree,
				WORKSTREAM_ID,
				'huge.png',
				unbounded,
				STAGED_AT,
				EXPIRES_TOMORROW,
			),
		).toThrow('file limit');

		const oversized = Buffer.alloc(MAX_ATTACHMENT_FILE_BYTES + 1).toString('base64');
		expect(oversized.length).toBe(MAX_ATTACHMENT_BASE64_CHARS);
		expect(() =>
			stageBytes(
				test.db,
				worktree,
				WORKSTREAM_ID,
				'huge.png',
				oversized,
				STAGED_AT,
				EXPIRES_TOMORROW,
			),
		).toThrow('file limit');

		expect(() =>
			stageBytes(
				test.db,
				worktree,
				WORKSTREAM_ID,
				'shot.png',
				'this is not base64!!',
				STAGED_AT,
				EXPIRES_TOMORROW,
			),
		).toThrow('decode pasted attachment');
		expect(existsSync(join(worktree, ATTACHMENT_ROOT))).toBe(false);
	});

	it('accepts exactly the file limit', () => {
		const exact = Buffer.alloc(MAX_ATTACHMENT_FILE_BYTES, 1);
		const attachment = paste('exact.png', exact);
		expect(attachment.size).toBe(MAX_ATTACHMENT_FILE_BYTES);
		expect(statSync(join(worktree, attachment.relativePath)).size).toBe(MAX_ATTACHMENT_FILE_BYTES);
	});

	it('enforces the workstream count and total size caps', () => {
		const staged = Array.from({ length: MAX_ATTACHMENT_FILES }, (_, index) =>
			paste(`shot-${index}.png`, PIXEL_PNG),
		);
		expect(() => paste('one-too-many.png', PIXEL_PNG)).toThrow(
			`at most ${MAX_ATTACHMENT_FILES} files can be attached`,
		);
		expect(
			readdirSync(join(worktree, ATTACHMENT_ROOT)),
			'a refused paste leaves no directory behind',
		).toHaveLength(MAX_ATTACHMENT_FILES);

		removeStaged(test.db, worktree, WORKSTREAM_ID, staged[0]!.id, '2026-07-11T01:00:00.000Z');
		run(
			test.db,
			'UPDATE agent_attachments SET size = ? WHERE id = ?',
			MAX_ATTACHMENT_TOTAL_BYTES,
			staged[1]!.id,
		);
		expect(() => paste('over-budget.png', PIXEL_PNG)).toThrow(
			`attachments exceed the ${MAX_ATTACHMENT_TOTAL_BYTES}-byte total limit`,
		);
	});

	it('removes the file again when the row cannot be written', () => {
		insertSession(test.db, {
			id: 'session-paused',
			workstreamId: WORKSTREAM_ID,
			model: null,
			providerSessionId: null,
			status: 'idle',
			startedAt: STAGED_AT,
		});
		run(test.db, "UPDATE workstreams SET status = 'paused' WHERE id = ?", WORKSTREAM_ID);
		expect(() => paste('shot.png', PIXEL_PNG)).toThrow(
			`workstream \`${WORKSTREAM_ID}\` is missing or inactive`,
		);
		expect(readdirSync(join(worktree, ATTACHMENT_ROOT))).toEqual([]);
	});
});

describe('decodeStrictBase64', () => {
	it('accepts canonical padded base64 and refuses everything else', () => {
		expect(decodeStrictBase64('')).toEqual(Buffer.alloc(0));
		expect(decodeStrictBase64('aGk=')).toEqual(Buffer.from('hi'));
		expect(decodeStrictBase64(PIXEL_PNG.toString('base64'))).toEqual(PIXEL_PNG);
		for (const bad of ['aGk', 'aGk==', 'a-k=', 'aG k=', 'aGl=', '====', 'aGk=aGk=']) {
			expect(() => decodeStrictBase64(bad), bad).toThrow(
				'decode pasted attachment: invalid base64',
			);
		}
	});
});
