import { createHash } from 'node:crypto';
import {
	chmodSync,
	closeSync,
	constants as fsConstants,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readSync,
	realpathSync,
	renameSync,
	rmSync,
	writeSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { isInsideDirectory } from '$main/fs/paths';
import {
	attachmentIdIsSafe,
	collectExpiredAttachments,
	deleteCollectedAttachment,
	insertRunAndBindAttachments,
	insertStagedAttachments,
	loadStoredAttachment,
	MAX_ATTACHMENT_FILE_BYTES,
	MAX_ATTACHMENT_FILES,
	MAX_ATTACHMENT_TOTAL_BYTES,
	removeStagedAttachment,
	type InsertRunAndBindAttachmentsInput,
	type StagedAgentAttachment,
	type StoredAttachment,
} from '../attachments.repository';
import type { MaliniDatabase } from '$main/db/driver';
import { get } from '$main/db/rows';
import {
	attachmentId,
	attachmentsRoot,
	deleteAttachmentDirectory,
	expectedRelativePath,
	MAX_ATTACHMENT_BASE64_CHARS,
	MAX_PREVIEW_BYTES,
	mediaType,
	openSourceNoFollow,
	PASTEABLE_MEDIA_TYPES,
	validateName,
} from './layout';
import type { StagedAgentAttachmentBytes } from '$contract/agent';

export type { StagedAgentAttachmentBytes };

const COPY_BUFFER_BYTES = 64 * 1024;

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isHex(value: string): boolean {
	return /^[0-9a-fA-F]*$/.test(value);
}

function sha256Hex(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

export function persistStagedAttachments(
	db: MaliniDatabase,
	workstreamId: string,
	attachments: readonly StagedAgentAttachment[],
	createdAt: string,
	expiresAt: string,
): void {
	for (const attachment of attachments) {
		const expected = expectedRelativePath(attachment.id, attachment.displayName);
		if (attachment.relativePath !== expected) {
			throw new Error('staged attachment path does not match its descriptor');
		}
	}
	insertStagedAttachments(db, workstreamId, attachments, createdAt, expiresAt);
}

function canonicalAttachmentDirectory(
	worktree: string,
	root: string,
	attachment: StagedAgentAttachment,
	expected: string,
): string {
	const path = join(worktree, expected);
	let parent: string;
	try {
		parent = realpathSync(dirname(path));
	} catch (error) {
		throw new Error(`canonicalize attachment directory: ${describe(error)}`);
	}
	if (!isInsideDirectory(root, parent) || dirname(parent) !== root) {
		throw new Error(`attachment \`${attachment.id}\` escaped the staging root`);
	}
	return path;
}

export function verifyStagedFile(
	worktree: string,
	stored: StoredAttachment,
	root: string = attachmentsRoot(worktree),
): void {
	const attachment = stored.descriptor;
	const expected = expectedRelativePath(attachment.id, attachment.displayName);
	if (attachment.relativePath !== expected) {
		throw new Error(`attachment \`${attachment.id}\` has an invalid stored path`);
	}
	if (
		attachment.mediaType !== mediaType(attachment.displayName) ||
		attachment.size > MAX_ATTACHMENT_FILE_BYTES ||
		attachment.sha256.length !== 64 ||
		!isHex(attachment.sha256)
	) {
		throw new Error(`attachment \`${attachment.id}\` has invalid descriptor metadata`);
	}

	const path = canonicalAttachmentDirectory(worktree, root, attachment, expected);
	const fd = openSourceNoFollow(path);
	try {
		let before: ReturnType<typeof fstatSync>;
		try {
			before = fstatSync(fd);
		} catch (error) {
			throw new Error(`inspect staged attachment: ${describe(error)}`);
		}
		if (!before.isFile() || before.size !== attachment.size) {
			throw new Error(`attachment \`${attachment.id}\` changed after staging`);
		}
		const hasher = createHash('sha256');
		const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
		let readTotal = 0;
		for (;;) {
			let read: number;
			try {
				read = readSync(fd, buffer, 0, buffer.length, null);
			} catch (error) {
				throw new Error(`read staged attachment: ${describe(error)}`);
			}
			if (read === 0) break;
			readTotal += read;
			if (!Number.isSafeInteger(readTotal)) throw new Error('attachment size overflow');
			if (readTotal > MAX_ATTACHMENT_FILE_BYTES || readTotal > attachment.size) {
				throw new Error(`attachment \`${attachment.id}\` exceeded its staged size`);
			}
			hasher.update(buffer.subarray(0, read));
		}
		let after: ReturnType<typeof fstatSync>;
		try {
			after = fstatSync(fd);
		} catch (error) {
			throw new Error(`reinspect staged attachment: ${describe(error)}`);
		}
		const digest = hasher.digest('hex');
		if (
			readTotal !== attachment.size ||
			after.size !== before.size ||
			digest !== attachment.sha256
		) {
			throw new Error(`attachment \`${attachment.id}\` failed send-time integrity verification`);
		}
	} finally {
		closeSync(fd);
	}
}

export function bindRunAttachments(
	db: MaliniDatabase,
	worktree: string,
	input: Omit<InsertRunAndBindAttachmentsInput, 'verify'>,
): StagedAgentAttachment[] {
	if (input.attachmentIds.length === 0) {
		return insertRunAndBindAttachments(db, input);
	}
	const root = attachmentsRoot(worktree);
	return insertRunAndBindAttachments(db, {
		...input,
		verify: (stored) => verifyStagedFile(worktree, stored, root),
	});
}

export function removeStaged(
	db: MaliniDatabase,
	worktree: string,
	workstreamId: string,
	attachmentId: string,
	removedAt: string,
): void {
	removeStagedAttachment(db, workstreamId, attachmentId, removedAt);
	deleteAttachmentDirectory(worktree, attachmentId);
}

export function readStaged(
	db: MaliniDatabase,
	worktree: string,
	workstreamId: string,
	attachmentId: string,
): StagedAgentAttachmentBytes | null {
	if (!attachmentIdIsSafe(attachmentId)) {
		throw new Error('attachment id is unsafe');
	}
	const stored = loadStoredAttachment(db, attachmentId);
	if (!stored) throw new Error(`staged attachment \`${attachmentId}\` not found`);
	if (stored.workstreamId !== workstreamId || stored.state !== 'staged') {
		throw new Error(`attachment \`${attachmentId}\` is not staged for this workstream`);
	}
	if (stored.descriptor.size > MAX_PREVIEW_BYTES) {
		return null;
	}

	const attachment = stored.descriptor;
	const root = attachmentsRoot(worktree);
	const expected = expectedRelativePath(attachment.id, attachment.displayName);
	if (attachment.relativePath !== expected) {
		throw new Error(`attachment \`${attachment.id}\` has an invalid stored path`);
	}
	const path = canonicalAttachmentDirectory(worktree, root, attachment, expected);

	const fd = openSourceNoFollow(path);
	let bytes: Buffer;
	try {
		let metadata: ReturnType<typeof fstatSync>;
		try {
			metadata = fstatSync(fd);
		} catch (error) {
			throw new Error(`inspect staged attachment: ${describe(error)}`);
		}
		if (!metadata.isFile() || metadata.size !== attachment.size) {
			throw new Error(`attachment \`${attachment.id}\` changed after staging`);
		}
		const limit = MAX_PREVIEW_BYTES + 1;
		bytes = Buffer.allocUnsafe(Math.min(limit, attachment.size + 1));
		let total = 0;
		while (total < limit) {
			let read: number;
			try {
				read = readSync(fd, bytes, total, bytes.length - total, null);
			} catch (error) {
				throw new Error(`read staged attachment: ${describe(error)}`);
			}
			if (read === 0) break;
			total += read;
			if (total === bytes.length && total < limit) {
				bytes = Buffer.concat([
					bytes,
					Buffer.allocUnsafe(Math.min(limit - total, COPY_BUFFER_BYTES)),
				]);
			}
		}
		bytes = bytes.subarray(0, total);
	} finally {
		closeSync(fd);
	}
	if (bytes.length !== attachment.size || sha256Hex(bytes) !== attachment.sha256) {
		throw new Error(`attachment \`${attachment.id}\` changed after staging`);
	}

	return {
		mediaType: mediaType(attachment.displayName),
		base64: bytes.toString('base64'),
		size: attachment.size,
	};
}

export function gcStaged(
	db: MaliniDatabase,
	worktree: string,
	workstreamId: string,
	now: string,
): number {
	const ids = collectExpiredAttachments(db, workstreamId, now);
	let deleted = 0;
	for (const id of ids) {
		deleteAttachmentDirectory(worktree, id);
		deleted += deleteCollectedAttachment(db, id, workstreamId);
	}
	return deleted;
}

function createAttachmentDirectory(root: string, id: string): string {
	const directory = join(root, id);
	try {
		mkdirSync(directory);
	} catch (error) {
		throw new Error(`create attachment directory: ${describe(error)}`);
	}
	if (process.platform !== 'win32') {
		try {
			chmodSync(directory, 0o700);
		} catch (error) {
			throw new Error(`secure attachment directory: ${describe(error)}`);
		}
	}
	return directory;
}

function openTemporaryForWrite(path: string): number {
	try {
		return openSync(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
	} catch (error) {
		throw new Error(`create staged attachment: ${describe(error)}`);
	}
}

function publishStagedFile(directory: string, temporary: string, destination: string): void {
	try {
		renameSync(temporary, destination);
	} catch (error) {
		throw new Error(`publish staged attachment: ${describe(error)}`);
	}
	let fd: number;
	try {
		fd = openSync(directory, fsConstants.O_RDONLY);
	} catch (error) {
		throw new Error(`sync attachment directory: ${describe(error)}`);
	}
	try {
		fsyncSync(fd);
	} catch (error) {
		throw new Error(`sync attachment directory: ${describe(error)}`);
	} finally {
		closeSync(fd);
	}
}

function relativeToWorktree(worktree: string, destination: string): string {
	let canonicalWorktree: string;
	try {
		canonicalWorktree = realpathSync(worktree);
	} catch (error) {
		throw new Error(describe(error));
	}
	const rel = relative(canonicalWorktree, destination);
	if (rel.length === 0 || rel.startsWith('..') || rel.startsWith(sep) || /^[A-Za-z]:/.test(rel)) {
		throw new Error('staged attachment escaped the worktree');
	}
	return rel.split(sep).join('/');
}

export function stageSelectedPaths(
	worktree: string,
	sources: readonly string[],
): StagedAgentAttachment[] {
	if (sources.length > MAX_ATTACHMENT_FILES) {
		throw new Error(`at most ${MAX_ATTACHMENT_FILES} files can be attached`);
	}
	if (sources.length === 0) return [];

	const root = attachmentsRoot(worktree);
	let total = 0;
	const validated: Array<{ source: string; displayName: string; expectedSize: number }> = [];
	for (const source of sources) {
		let metadata: ReturnType<typeof lstatSync>;
		try {
			metadata = lstatSync(source);
		} catch (error) {
			throw new Error(`inspect selected attachment: ${describe(error)}`);
		}
		if (metadata.isSymbolicLink() || !metadata.isFile()) {
			throw new Error('attachments must be regular files, not links or directories');
		}
		if (metadata.size > MAX_ATTACHMENT_FILE_BYTES) {
			throw new Error(`attachment exceeds the ${MAX_ATTACHMENT_FILE_BYTES}-byte file limit`);
		}
		total += metadata.size;
		if (!Number.isSafeInteger(total)) throw new Error('attachment size overflow');
		if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
			throw new Error(`attachments exceed the ${MAX_ATTACHMENT_TOTAL_BYTES}-byte total limit`);
		}
		validated.push({ source, displayName: validateName(source), expectedSize: metadata.size });
	}

	const staged: StagedAgentAttachment[] = [];
	for (const { source, displayName, expectedSize } of validated) {
		const id = attachmentId();
		const directory = createAttachmentDirectory(root, id);
		try {
			staged.push(copyIntoDirectory(worktree, directory, id, source, displayName, expectedSize));
		} catch (error) {
			rmSync(directory, { recursive: true, force: true });
			for (const previous of staged) {
				rmSync(join(root, previous.id), { recursive: true, force: true });
			}
			throw error;
		}
	}
	return staged;
}

function copyIntoDirectory(
	worktree: string,
	directory: string,
	id: string,
	source: string,
	displayName: string,
	expectedSize: number,
): StagedAgentAttachment {
	const temporary = join(directory, '.partial');
	const destination = join(directory, displayName);
	const input = openSourceNoFollow(source);
	let output: number | null = null;
	const hasher = createHash('sha256');
	let copied = 0;
	try {
		let opened: ReturnType<typeof fstatSync>;
		try {
			opened = fstatSync(input);
		} catch (error) {
			throw new Error(`inspect opened attachment: ${describe(error)}`);
		}
		if (!opened.isFile() || opened.size !== expectedSize) {
			throw new Error('attachment changed before copying');
		}
		output = openTemporaryForWrite(temporary);
		const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
		for (;;) {
			let read: number;
			try {
				read = readSync(input, buffer, 0, buffer.length, null);
			} catch (error) {
				throw new Error(`read selected attachment: ${describe(error)}`);
			}
			if (read === 0) break;
			copied += read;
			if (copied > MAX_ATTACHMENT_FILE_BYTES || copied > expectedSize) {
				throw new Error('attachment changed or exceeded its size limit while copying');
			}
			hasher.update(buffer.subarray(0, read));
			try {
				writeSync(output, buffer, 0, read);
			} catch (error) {
				throw new Error(`write staged attachment: ${describe(error)}`);
			}
		}
		if (copied !== expectedSize) {
			throw new Error('attachment changed while copying');
		}
		try {
			fsyncSync(output);
		} catch (error) {
			throw new Error(`sync staged attachment: ${describe(error)}`);
		}
		closeSync(output);
		output = null;
	} finally {
		closeSync(input);
		if (output !== null) closeSync(output);
	}
	publishStagedFile(directory, temporary, destination);

	return {
		id,
		displayName,
		relativePath: relativeToWorktree(worktree, destination),
		mediaType: mediaType(displayName),
		size: copied,
		sha256: hasher.digest('hex'),
	};
}

const BASE64_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;

export function decodeStrictBase64(base64: string): Buffer {
	if (base64.length % 4 !== 0 || !BASE64_ALPHABET.test(base64)) {
		throw new Error('decode pasted attachment: invalid base64');
	}
	const bytes = Buffer.from(base64, 'base64');
	if (bytes.toString('base64') !== base64) {
		throw new Error('decode pasted attachment: invalid base64');
	}
	return bytes;
}

export function decodePastedAttachment(
	fileName: string,
	base64: string,
): { displayName: string; bytes: Buffer } {
	const displayName = validateName(fileName);
	if (displayName !== fileName) {
		throw new Error('attachment filename is not normalized');
	}
	if (displayName.startsWith('.')) {
		throw new Error('attachment filename must not start with a dot');
	}
	const type = mediaType(displayName);
	if (!PASTEABLE_MEDIA_TYPES.includes(type)) {
		throw new Error(`\`${displayName}\` is not a type that can be pasted as an attachment`);
	}
	if (base64.length > MAX_ATTACHMENT_BASE64_CHARS) {
		throw new Error(`attachment exceeds the ${MAX_ATTACHMENT_FILE_BYTES}-byte file limit`);
	}
	const bytes = decodeStrictBase64(base64);
	if (bytes.length > MAX_ATTACHMENT_FILE_BYTES) {
		throw new Error(`attachment exceeds the ${MAX_ATTACHMENT_FILE_BYTES}-byte file limit`);
	}
	return { displayName, bytes };
}

export function stagedAttachmentBudget(
	db: MaliniDatabase,
	workstreamId: string,
	now: string,
): { count: number; bytes: number } {
	const row = get<{ count: number; total: number }>(
		db,
		`SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS total FROM agent_attachments
		 WHERE workstream_id = ? AND state = 'staged' AND expires_at > ?`,
		workstreamId,
		now,
	);
	return { count: Math.max(0, row?.count ?? 0), bytes: Math.max(0, row?.total ?? 0) };
}

export function writeStagedBytes(
	worktree: string,
	displayName: string,
	bytes: Uint8Array,
): StagedAgentAttachment {
	const root = attachmentsRoot(worktree);
	const id = attachmentId();
	const directory = createAttachmentDirectory(root, id);
	const temporary = join(directory, '.partial');
	const destination = join(directory, displayName);
	try {
		const output = openTemporaryForWrite(temporary);
		try {
			try {
				writeSync(output, bytes);
			} catch (error) {
				throw new Error(`write staged attachment: ${describe(error)}`);
			}
			try {
				fsyncSync(output);
			} catch (error) {
				throw new Error(`sync staged attachment: ${describe(error)}`);
			}
		} finally {
			closeSync(output);
		}
		publishStagedFile(directory, temporary, destination);
		const relativePath = relativeToWorktree(worktree, destination);
		if (relativePath !== expectedRelativePath(id, displayName)) {
			throw new Error('staged attachment is not a direct child of its own directory');
		}
		return {
			id,
			displayName,
			relativePath,
			mediaType: mediaType(displayName),
			size: bytes.length,
			sha256: sha256Hex(bytes),
		};
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

export function stageBytes(
	db: MaliniDatabase,
	worktree: string,
	workstreamId: string,
	fileName: string,
	base64: string,
	createdAt: string,
	expiresAt: string,
): StagedAgentAttachment {
	const { displayName, bytes } = decodePastedAttachment(fileName, base64);
	const budget = stagedAttachmentBudget(db, workstreamId, createdAt);
	if (budget.count >= MAX_ATTACHMENT_FILES) {
		throw new Error(`at most ${MAX_ATTACHMENT_FILES} files can be attached`);
	}
	const projected = budget.bytes + bytes.length;
	if (!Number.isSafeInteger(projected)) throw new Error('attachment size overflow');
	if (projected > MAX_ATTACHMENT_TOTAL_BYTES) {
		throw new Error(`attachments exceed the ${MAX_ATTACHMENT_TOTAL_BYTES}-byte total limit`);
	}

	const staged = writeStagedBytes(worktree, displayName, bytes);
	try {
		persistStagedAttachments(db, workstreamId, [staged], createdAt, expiresAt);
	} catch (error) {
		try {
			deleteAttachmentDirectory(worktree, staged.id);
		} catch {}
		throw error;
	}
	return staged;
}
