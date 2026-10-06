import { randomBytes } from 'node:crypto';
import {
	constants as fsConstants,
	lstatSync,
	mkdirSync,
	openSync,
	realpathSync,
	rmSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { attachmentIdIsSafe, MAX_ATTACHMENT_FILE_BYTES } from '../attachments.repository';
import { BRIDGE_AGENT_ATTACHMENTS_PATH } from '$contract/protocol-contract.generated';
import { isInsideDirectory } from '$main/fs/paths';

export const ATTACHMENT_ROOT = BRIDGE_AGENT_ATTACHMENTS_PATH;

export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

export const PASTEABLE_MEDIA_TYPES: readonly string[] = [
	'text/plain',
	'application/json',
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/webp',
];

export const MAX_ATTACHMENT_BASE64_CHARS = Math.ceil(MAX_ATTACHMENT_FILE_BYTES / 3) * 4;

export function attachmentId(): string {
	return `att-${randomBytes(16).toString('hex')}`;
}

export function mediaType(name: string): string {
	const dot = name.lastIndexOf('.');
	const extension = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
	switch (extension) {
		case 'txt':
		case 'md':
		case 'log':
			return 'text/plain';
		case 'json':
			return 'application/json';
		case 'pdf':
			return 'application/pdf';
		case 'png':
			return 'image/png';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'webp':
			return 'image/webp';
		default:
			return 'application/octet-stream';
	}
}

function fileNameOf(source: string): string | null {
	const trimmed = source.replace(/[\\/]+$/, '');
	const name = basename(trimmed);
	if (name.length === 0 || name === '.' || name === '..') return null;
	return name;
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

export function validateName(source: string): string {
	const name = fileNameOf(source);
	if (name === null) {
		throw new Error('attachment filename must be valid UTF-8');
	}
	if (
		name.length === 0 ||
		name === '.' ||
		name === '..' ||
		Buffer.byteLength(name, 'utf8') > 255 ||
		CONTROL_CHARACTER.test(name)
	) {
		throw new Error('attachment filename is unsafe');
	}
	return name;
}

export function expectedRelativePath(id: string, displayName: string): string {
	if (!attachmentIdIsSafe(id)) {
		throw new Error('attachment id is unsafe');
	}
	const validated = validateName(displayName);
	if (validated !== displayName) {
		throw new Error('attachment filename is not normalized');
	}
	return `${ATTACHMENT_ROOT}/${id}/${displayName}`;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return (
		typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
	);
}

export function attachmentsRoot(worktree: string): string {
	let canonicalWorktree: string;
	try {
		canonicalWorktree = realpathSync(worktree);
	} catch (error) {
		throw new Error(`canonicalize worktree: ${describe(error)}`);
	}
	let current = canonicalWorktree;
	for (const component of ATTACHMENT_ROOT.split('/')) {
		current = join(current, component);
		let metadata: ReturnType<typeof lstatSync> | null = null;
		try {
			metadata = lstatSync(current);
		} catch (error) {
			if (!isErrnoException(error) || error.code !== 'ENOENT') {
				throw new Error(`inspect attachment staging directory: ${describe(error)}`);
			}
		}
		if (metadata) {
			if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
				throw new Error('attachment staging directory is not a real directory');
			}
		} else {
			try {
				mkdirSync(current);
			} catch (error) {
				throw new Error(`create attachment staging directory: ${describe(error)}`);
			}
		}
	}
	let canonicalRoot: string;
	try {
		canonicalRoot = realpathSync(current);
	} catch (error) {
		throw new Error(`canonicalize attachment staging directory: ${describe(error)}`);
	}
	if (!isInsideDirectory(canonicalWorktree, canonicalRoot)) {
		throw new Error('attachment staging directory escapes the worktree');
	}
	return canonicalRoot;
}

export function deleteAttachmentDirectory(worktree: string, id: string): void {
	if (!attachmentIdIsSafe(id)) {
		throw new Error('attachment id is unsafe');
	}
	const root = attachmentsRoot(worktree);
	const directory = join(root, id);
	let metadata: ReturnType<typeof lstatSync>;
	try {
		metadata = lstatSync(directory);
	} catch (error) {
		if (isErrnoException(error) && error.code === 'ENOENT') return;
		throw new Error(`inspect staged attachment directory: ${describe(error)}`);
	}
	if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
		throw new Error('staged attachment directory is not a real directory');
	}
	let canonical: string;
	try {
		canonical = realpathSync(directory);
	} catch (error) {
		throw new Error(`canonicalize staged attachment directory: ${describe(error)}`);
	}
	if (!isInsideDirectory(root, canonical) || dirname(canonical) !== root) {
		throw new Error('staged attachment directory escapes its root');
	}
	try {
		rmSync(canonical, { recursive: true, force: false });
	} catch (error) {
		throw new Error(`remove staged attachment directory: ${describe(error)}`);
	}
}

export function openSourceNoFollow(path: string): number {
	let flags = fsConstants.O_RDONLY;
	if (process.platform !== 'win32') flags |= fsConstants.O_NOFOLLOW;
	try {
		return openSync(path, flags);
	} catch (error) {
		throw new Error(`open selected attachment without following links: ${describe(error)}`);
	}
}
