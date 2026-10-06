import type {
	StageAttachmentBytesArgs,
	StagedAttachmentArgs,
	StageForkTranscriptArgs,
	WorkstreamIdArgs,
} from '$contract/commands';
import type { MainContext } from '$main/context';
import { stagedAttachmentExpiryFrom } from '../attachments.repository';
import { listEventRowsForSession } from '../events.repository';
import { forkTranscript, forkTranscriptFileName } from '../fork-transcript';
import { sessionContextIdentity } from '../sessions.repository';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import { ensureAppManagedGitExcludes } from '$main/git/excludes';
import { resolveWorkstreamCheckoutCanonicalRecorded } from '$main/git/paths';
import { createElectronFilePicker, type FilePicker } from './picker';
import {
	gcStaged,
	persistStagedAttachments,
	readStaged,
	removeStaged,
	stageBytes,
	stageSelectedPaths,
} from './service';
import { deleteAttachmentDirectory } from './layout';

export const ATTACHMENT_COMMAND_NAMES = [
	'chat.pick-and-stage-attachments',
	'chat.stage-attachment-bytes',
	'chat.stage-fork-transcript',
	'chat.read-staged-attachment',
	'chat.remove-staged-attachment',
] as const;

export type WorkstreamCheckoutResolver = (workstreamId: string) => Promise<string> | string;

export interface AttachmentsDeps {
	picker?: FilePicker;
	resolveWorkstreamCheckout?: WorkstreamCheckoutResolver;
	ensureGitExcludes?: (worktree: string) => Promise<void>;
}

export function createDefaultCheckoutResolver(
	context: Pick<MainContext, 'db' | 'appDataRoot'>,
): WorkstreamCheckoutResolver {
	return (workstreamId) => {
		const recorded = getWorkstream(context.db, workstreamId)?.path ?? null;
		return resolveWorkstreamCheckoutCanonicalRecorded(context.appDataRoot, workstreamId, recorded);
	};
}

type Args = Record<string, unknown>;

function isRecord(value: unknown): value is Args {
	return typeof value === 'object' && value !== null;
}

function requireString(args: unknown, key: string): string {
	const value = isRecord(args) ? args[key] : undefined;
	if (typeof value !== 'string') {
		throw new Error(`invalid args: \`${key}\` must be a string`);
	}
	return value;
}

function requireSeq(args: unknown, key: string): number {
	const value = isRecord(args) ? args[key] : undefined;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new Error(`invalid args: \`${key}\` must be an event seq`);
	}
	return value;
}

function nowAndExpiry(): { now: string; expiresAt: string } {
	const now = new Date();
	return { now: now.toISOString(), expiresAt: stagedAttachmentExpiryFrom(now) };
}

export function installAttachments(context: MainContext, deps: AttachmentsDeps = {}): void {
	const picker = deps.picker ?? createElectronFilePicker();
	const resolveCheckout = deps.resolveWorkstreamCheckout ?? createDefaultCheckoutResolver(context);
	const ensureExcludes = deps.ensureGitExcludes ?? ensureAppManagedGitExcludes;
	const { commands, db } = context;

	async function prepareStaging(
		workstreamId: string,
	): Promise<{ worktree: string; now: string; expiresAt: string }> {
		const worktree = await resolveCheckout(workstreamId);
		await ensureExcludes(worktree);
		const { now, expiresAt } = nowAndExpiry();
		gcStaged(db, worktree, workstreamId, now);
		return { worktree, now, expiresAt };
	}

	commands.define('chat.pick-and-stage-attachments', async (args: WorkstreamIdArgs) => {
		const workstreamId = requireString(args, 'workstreamId');
		const { worktree, now, expiresAt } = await prepareStaging(workstreamId);
		const selected = await picker.pickFiles();
		const staged = stageSelectedPaths(worktree, selected);
		try {
			persistStagedAttachments(db, workstreamId, staged, now, expiresAt);
		} catch (error) {
			for (const attachment of staged) {
				try {
					deleteAttachmentDirectory(worktree, attachment.id);
				} catch {}
			}
			throw error;
		}
		return staged;
	});

	commands.define('chat.stage-attachment-bytes', async (args: StageAttachmentBytesArgs) => {
		const workstreamId = requireString(args, 'workstreamId');
		const fileName = requireString(args, 'fileName');
		const base64 = requireString(args, 'base64');
		const { worktree, now, expiresAt } = await prepareStaging(workstreamId);
		return stageBytes(db, worktree, workstreamId, fileName, base64, now, expiresAt);
	});

	commands.define('chat.stage-fork-transcript', async (args: StageForkTranscriptArgs) => {
		const workstreamId = requireString(args, 'workstreamId');
		const sessionId = requireString(args, 'sessionId');
		const atSeq = requireSeq(args, 'atSeq');
		const chat = sessionContextIdentity(db, sessionId);
		if (chat?.workstreamId !== workstreamId) {
			throw new Error(`chat \`${sessionId}\` is not in this workstream`);
		}
		const transcript = forkTranscript(
			chat.displayName,
			listEventRowsForSession(db, sessionId, 0),
			atSeq,
		);
		const { worktree, now, expiresAt } = await prepareStaging(workstreamId);
		return stageBytes(
			db,
			worktree,
			workstreamId,
			forkTranscriptFileName(chat.displayName),
			Buffer.from(transcript).toString('base64'),
			now,
			expiresAt,
		);
	});

	commands.define('chat.read-staged-attachment', async (args: StagedAttachmentArgs) => {
		const workstreamId = requireString(args, 'workstreamId');
		const attachmentId = requireString(args, 'attachmentId');
		const worktree = await resolveCheckout(workstreamId);
		return readStaged(db, worktree, workstreamId, attachmentId);
	});

	commands.define('chat.remove-staged-attachment', async (args: StagedAttachmentArgs) => {
		const workstreamId = requireString(args, 'workstreamId');
		const attachmentId = requireString(args, 'attachmentId');
		const worktree = await resolveCheckout(workstreamId);
		removeStaged(db, worktree, workstreamId, attachmentId, new Date().toISOString());
	});
}
