import { isValidAgentModel, type AgentModel } from '$shared/providers/providers.api';
import { roleForAgentMode, type ModelRole } from '$shared/providers/providers.api';
import {
	DEFAULT_AGENT_RUN_PROFILE,
	isValidAgentRunProfile,
	type AgentRunProfile,
} from '$shared/providers/providers.api';
import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import {
	sanitizeAgentElementReferences,
	type AgentElementReference,
} from '$lib/chat/domain/element-reference';
import {
	sanitizeAgentIssueReferences,
	type AgentIssueReference,
} from '$lib/chat/domain/issue-reference';
import type { QueuedPrompt } from '$lib/chat/domain/queued-prompt';
import type { SessionId } from '$lib/chat/domain/session';
import {
	sanitizeAgentTranscriptReferences,
	type AgentTranscriptReference,
} from '$lib/chat/domain/transcript-reference';

const STORAGE_PREFIX = 'malini.chat.prompt-queue:v1:';
const PAUSED_STORAGE_PREFIX = 'malini.chat.prompt-queue-paused:v1:';
const DEFAULT_MAX_ENTRIES = 100;
const MAX_CONTEXT_FILES = 20;
const MAX_ATTACHMENTS = 10;

interface PromptQueueStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

interface PromptQueueOptions {
	storage?: PromptQueueStorage;
	resolveStorage?: () => PromptQueueStorage | null;
	createId?: () => string;
	now?: () => number;
	maxEntries?: number;
}

export function promptQueueStorageKey(workstreamId: string): string {
	return `${STORAGE_PREFIX}${workstreamId}`;
}

export function promptQueuePausedStorageKey(workstreamId: string): string {
	return `${PAUSED_STORAGE_PREFIX}${workstreamId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultStorage(): PromptQueueStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function defaultId(): string {
	try {
		return globalThis.crypto.randomUUID();
	} catch {
		return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	}
}

function sanitizeContextFiles(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const files: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') continue;
		const path = item.trim();
		if (!path || path.length > 1_024 || /[\n\r\0]/.test(path) || seen.has(path)) continue;
		seen.add(path);
		files.push(path);
		if (files.length >= MAX_CONTEXT_FILES) break;
	}
	return files;
}

function sanitizeAttachments(value: unknown): StagedAgentAttachment[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const attachments: StagedAgentAttachment[] = [];
	for (const valueItem of value) {
		if (!isRecord(valueItem)) continue;
		const item = valueItem;
		if (
			typeof item.id !== 'string' ||
			!item.id.startsWith('att-') ||
			typeof item.displayName !== 'string' ||
			typeof item.relativePath !== 'string' ||
			typeof item.mediaType !== 'string' ||
			typeof item.size !== 'number' ||
			!Number.isFinite(item.size) ||
			typeof item.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(item.sha256) ||
			seen.has(item.id)
		) {
			continue;
		}
		seen.add(item.id);
		attachments.push({
			id: item.id,
			displayName: item.displayName,
			relativePath: item.relativePath,
			mediaType: item.mediaType,
			size: item.size,
			sha256: item.sha256,
		});
		if (attachments.length >= MAX_ATTACHMENTS) break;
	}
	return attachments.map((attachment) => ({ ...attachment }));
}

function parseEntry(value: unknown): QueuedPrompt | null {
	if (!isRecord(value)) return null;
	const candidate = value;
	if (
		typeof candidate.id !== 'string' ||
		!candidate.id ||
		typeof candidate.prompt !== 'string' ||
		!candidate.prompt.trim() ||
		!isValidAgentModel(candidate.model) ||
		typeof candidate.createdAt !== 'number' ||
		!Number.isFinite(candidate.createdAt)
	) {
		return null;
	}
	const profile = isValidAgentRunProfile(candidate.profile)
		? candidate.profile
		: { ...DEFAULT_AGENT_RUN_PROFILE };
	const role =
		candidate.role === 'planning' || candidate.role === 'implementation'
			? candidate.role
			: roleForAgentMode(profile.mode);
	if (roleForAgentMode(profile.mode) !== role) return null;
	return {
		id: candidate.id,
		targetSessionId:
			typeof candidate.targetSessionId === 'string' && candidate.targetSessionId
				? candidate.targetSessionId
				: null,
		forceFreshSession: candidate.forceFreshSession === true,
		prompt: candidate.prompt.trim(),
		role,
		model: candidate.model,
		contextFiles: sanitizeContextFiles(candidate.contextFiles),
		attachments: sanitizeAttachments(candidate.attachments),
		issueReferences: sanitizeAgentIssueReferences(candidate.issueReferences),
		transcriptReferences: sanitizeAgentTranscriptReferences(candidate.transcriptReferences),
		elementReferences: sanitizeAgentElementReferences(candidate.elementReferences),
		profile,
		automated: candidate.automated === true,
		createdAt: candidate.createdAt,
	};
}

export class AgentPromptQueue {
	#entriesByWorkstream: Record<string, QueuedPrompt[]> = $state({});
	#pausedByWorkstream: Record<string, boolean> = $state({});
	#handedOff: Readonly<Record<string, true>> = $state.raw({});
	#hydrated = new Set<string>();
	#storage: PromptQueueStorage | undefined;
	#resolveStorage: () => PromptQueueStorage | null;
	#createId: () => string;
	#now: () => number;
	#maxEntries: number;

	constructor(options: PromptQueueOptions = {}) {
		this.#storage = options.storage;
		this.#resolveStorage = options.resolveStorage ?? defaultStorage;
		this.#createId = options.createId ?? defaultId;
		this.#now = options.now ?? Date.now;
		this.#maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
	}

	hydrate(workstreamId: string): void {
		if (!workstreamId || this.#hydrated.has(workstreamId)) return;
		this.#hydrated.add(workstreamId);
		const storage = this.#getStorage();
		if (!storage) {
			this.#setEntries(workstreamId, [], false);
			return;
		}

		let entries: QueuedPrompt[] = [];
		let paused = false;
		try {
			const raw = storage.getItem(promptQueueStorageKey(workstreamId));
			if (raw) {
				const parsed: unknown = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					const seen = new Set<string>();
					entries = parsed
						.map(parseEntry)
						.filter((entry): entry is QueuedPrompt => {
							if (!entry || seen.has(entry.id)) return false;
							seen.add(entry.id);
							return true;
						})
						.slice(0, this.#maxEntries);
				}
			}
			paused = storage.getItem(promptQueuePausedStorageKey(workstreamId)) === 'true';
		} catch {
			entries = [];
			paused = false;
		}
		this.#setEntries(workstreamId, entries, false);
		this.#setPaused(workstreamId, paused, false);
	}

	entriesFor(workstreamId: string): readonly QueuedPrompt[] {
		return this.#entriesByWorkstream[workstreamId] ?? [];
	}

	countFor(workstreamId: string): number {
		return this.entriesFor(workstreamId).length;
	}

	workstreamsWithEntries(): readonly string[] {
		return Object.entries(this.#entriesByWorkstream)
			.filter(([, entries]) => entries.length > 0)
			.map(([workstreamId]) => workstreamId);
	}

	waitingCountFor(workstreamId: string): number {
		return this.entriesFor(workstreamId).filter((entry) => !this.#handedOff[entry.id]).length;
	}

	entriesForSession(workstreamId: string, sessionId: SessionId | null): readonly QueuedPrompt[] {
		return this.entriesFor(workstreamId).filter((entry) => entry.targetSessionId === sessionId);
	}

	waitingEntriesForSession(
		workstreamId: string,
		sessionId: SessionId | null,
	): readonly QueuedPrompt[] {
		return this.entriesForSession(workstreamId, sessionId).filter(
			(entry) => !this.#handedOff[entry.id],
		);
	}

	handOff(id: string): void {
		if (this.#handedOff[id]) return;
		this.#handedOff = { ...this.#handedOff, [id]: true };
	}

	takeBack(id: string): void {
		if (!this.#handedOff[id]) return;
		const { [id]: _released, ...rest } = this.#handedOff;
		this.#handedOff = rest;
	}

	removeForSession(workstreamId: string, sessionId: SessionId | null): number {
		const current = this.entriesFor(workstreamId);
		const next = current.filter((entry) => entry.targetSessionId !== sessionId);
		if (next.length === current.length) return 0;
		this.#setEntries(workstreamId, next);
		return current.length - next.length;
	}

	enqueue(input: {
		workstreamId: string;
		targetSessionId?: SessionId | null;
		forceFreshSession?: boolean;
		prompt: string;
		role?: ModelRole;
		model: AgentModel;
		contextFiles?: readonly string[];
		attachments?: readonly StagedAgentAttachment[];
		issueReferences?: readonly AgentIssueReference[];
		transcriptReferences?: readonly AgentTranscriptReference[];
		elementReferences?: readonly AgentElementReference[];
		profile?: AgentRunProfile;
		automated?: boolean;
	}): QueuedPrompt {
		this.hydrate(input.workstreamId);
		const prompt = input.prompt.trim();
		if (!prompt) throw new Error('Queued prompt cannot be empty');
		const profile = input.profile ?? { ...DEFAULT_AGENT_RUN_PROFILE };
		const role = input.role ?? roleForAgentMode(profile.mode);
		if (roleForAgentMode(profile.mode) !== role) {
			throw new Error(`Queued ${role} turn has an incompatible run profile`);
		}
		const entry: QueuedPrompt = {
			id: this.#uniqueId(input.workstreamId),
			targetSessionId: input.targetSessionId ?? null,
			forceFreshSession: input.forceFreshSession === true,
			prompt,
			role,
			model: input.model,
			contextFiles: sanitizeContextFiles(input.contextFiles),
			attachments: sanitizeAttachments(input.attachments),
			issueReferences: sanitizeAgentIssueReferences(input.issueReferences),
			transcriptReferences: sanitizeAgentTranscriptReferences(input.transcriptReferences),
			elementReferences: sanitizeAgentElementReferences(input.elementReferences),
			profile,
			automated: input.automated === true,
			createdAt: this.#now(),
		};
		const next = [...this.entriesFor(input.workstreamId), entry].slice(-this.#maxEntries);
		this.#setEntries(input.workstreamId, next);
		return entry;
	}

	update(
		workstreamId: string,
		id: string,
		input: {
			prompt: string;
			targetSessionId?: SessionId | null;
			forceFreshSession?: boolean;
			role?: ModelRole;
			model?: AgentModel;
			contextFiles?: readonly string[];
			attachments?: readonly StagedAgentAttachment[];
			issueReferences?: readonly AgentIssueReference[];
			transcriptReferences?: readonly AgentTranscriptReference[];
			elementReferences?: readonly AgentElementReference[];
			profile?: AgentRunProfile;
		},
	): boolean {
		this.hydrate(workstreamId);
		const prompt = input.prompt.trim();
		if (!prompt) return false;
		let changed = false;
		const next = this.entriesFor(workstreamId).map((entry) => {
			if (entry.id !== id) return entry;
			changed = true;
			return {
				...entry,
				prompt,
				targetSessionId:
					input.targetSessionId === undefined ? entry.targetSessionId : input.targetSessionId,
				forceFreshSession: input.forceFreshSession ?? entry.forceFreshSession,
				role: input.role ?? entry.role,
				model: input.model ?? entry.model,
				contextFiles:
					input.contextFiles === undefined
						? entry.contextFiles
						: sanitizeContextFiles(input.contextFiles),
				attachments:
					input.attachments === undefined
						? entry.attachments
						: sanitizeAttachments(input.attachments),
				issueReferences:
					input.issueReferences === undefined
						? entry.issueReferences
						: sanitizeAgentIssueReferences(input.issueReferences),
				transcriptReferences:
					input.transcriptReferences === undefined
						? entry.transcriptReferences
						: sanitizeAgentTranscriptReferences(input.transcriptReferences),
				elementReferences:
					input.elementReferences === undefined
						? entry.elementReferences
						: sanitizeAgentElementReferences(input.elementReferences),
				profile: input.profile ?? entry.profile,
				automated: entry.automated && prompt === entry.prompt,
			};
		});
		if (changed) this.#setEntries(workstreamId, next);
		return changed;
	}

	remove(workstreamId: string, id: string): boolean {
		this.hydrate(workstreamId);
		const current = this.entriesFor(workstreamId);
		const next = current.filter((entry) => entry.id !== id);
		this.takeBack(id);
		if (next.length === current.length) return false;
		this.#setEntries(workstreamId, next);
		return true;
	}

	promote(workstreamId: string, id: string): boolean {
		this.hydrate(workstreamId);
		const current = this.entriesFor(workstreamId);
		const index = current.findIndex((entry) => entry.id === id);
		if (index < 0) return false;
		if (index === 0) return true;
		const selected = current[index];
		if (!selected) return false;
		this.#setEntries(workstreamId, [
			selected,
			...current.slice(0, index),
			...current.slice(index + 1),
		]);
		return true;
	}

	setPaused(workstreamId: string, paused: boolean): void {
		if (!workstreamId) return;
		this.hydrate(workstreamId);
		this.#setPaused(workstreamId, paused);
	}

	#setPaused(workstreamId: string, paused: boolean, persist = true): void {
		if (this.#pausedByWorkstream[workstreamId] === paused) return;
		this.#pausedByWorkstream = {
			...this.#pausedByWorkstream,
			[workstreamId]: paused,
		};
		if (!persist) return;
		const storage = this.#getStorage();
		if (!storage) return;
		try {
			if (paused) {
				storage.setItem(promptQueuePausedStorageKey(workstreamId), 'true');
			} else {
				storage.removeItem(promptQueuePausedStorageKey(workstreamId));
			}
		} catch {}
	}

	isPaused(workstreamId: string): boolean {
		return this.#pausedByWorkstream[workstreamId] ?? false;
	}

	clear(workstreamId: string): void {
		this.hydrate(workstreamId);
		this.#setEntries(workstreamId, []);
		this.setPaused(workstreamId, false);
	}

	#getStorage(): PromptQueueStorage | null {
		return this.#storage ?? this.#resolveStorage();
	}

	#uniqueId(workstreamId: string): string {
		const existing = new Set(this.entriesFor(workstreamId).map((entry) => entry.id));
		const base = this.#createId();
		if (!existing.has(base)) return base;
		let suffix = 2;
		while (existing.has(`${base}-${suffix}`)) suffix += 1;
		return `${base}-${suffix}`;
	}

	#setEntries(workstreamId: string, entries: readonly QueuedPrompt[], persist = true): void {
		this.#entriesByWorkstream = {
			...this.#entriesByWorkstream,
			[workstreamId]: [...entries],
		};
		if (!persist) return;
		const storage = this.#getStorage();
		if (!storage) return;
		try {
			if (entries.length === 0) {
				storage.removeItem(promptQueueStorageKey(workstreamId));
			} else {
				storage.setItem(promptQueueStorageKey(workstreamId), JSON.stringify(entries));
			}
		} catch {}
	}
}

export const agentPromptQueue = new AgentPromptQueue();
