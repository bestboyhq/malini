import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import {
	sanitizeAgentElementReferences,
	type AgentElementReference,
} from '$lib/chat/domain/element-reference';
import {
	sanitizeAgentIssueReferences,
	type AgentIssueReference,
} from '$lib/chat/domain/issue-reference';
import type { AgentDraft } from '$lib/chat/domain/draft';
import { promptChipIds } from '$lib/chat/domain/prompt-chip';
import {
	sanitizeAgentTranscriptReferences,
	type AgentTranscriptReference,
} from '$lib/chat/domain/transcript-reference';

const DRAFT_TEXT_KEY_PREFIX = 'malini.chat.draft:';
const DRAFT_CONTEXT_KEY_PREFIX = 'malini.chat.draft-context:';
const DRAFT_ATTACHMENTS_KEY_PREFIX = 'malini.chat.draft-attachments:';
const DRAFT_ISSUES_KEY_PREFIX = 'malini.chat.draft-issues:';
const DRAFT_TRANSCRIPTS_KEY_PREFIX = 'malini.chat.draft-transcripts:';
const DRAFT_ELEMENTS_KEY_PREFIX = 'malini.chat.draft-elements:';
const DRAFT_SCOPES_KEY_PREFIX = 'malini.chat.draft-scopes:';
const MAX_CONTEXT_FILES = 20;
const MAX_ATTACHMENTS = 10;

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const EMPTY_DRAFT: AgentDraft = Object.freeze({
	text: '',
	contextFiles: Object.freeze([]),
	attachments: Object.freeze([]),
	issueReferences: Object.freeze([]),
	transcriptReferences: Object.freeze([]),
	elementReferences: Object.freeze([]),
});

function browserStorage(): DraftStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function parseJson(raw: string): unknown {
	return JSON.parse(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeContextFiles(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
		.map((path) => path.trim())
		.filter((path, index, files) => files.indexOf(path) === index)
		.slice(0, MAX_CONTEXT_FILES);
}

function sanitizeAttachments(value: unknown): StagedAgentAttachment[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value
		.filter((candidate): candidate is StagedAgentAttachment => {
			if (!isRecord(candidate)) return false;
			return (
				typeof candidate.id === 'string' &&
				candidate.id.startsWith('att-') &&
				typeof candidate.displayName === 'string' &&
				typeof candidate.relativePath === 'string' &&
				typeof candidate.mediaType === 'string' &&
				typeof candidate.size === 'number' &&
				Number.isFinite(candidate.size) &&
				typeof candidate.sha256 === 'string' &&
				/^[a-f0-9]{64}$/u.test(candidate.sha256)
			);
		})
		.filter((attachment) => {
			if (seen.has(attachment.id)) return false;
			seen.add(attachment.id);
			return true;
		})
		.slice(0, MAX_ATTACHMENTS)
		.map((attachment) => ({ ...attachment }));
}

export class AgentDrafts {
	#draftsByScope: Record<string, AgentDraft> = $state({});
	#hydratedScopes = new Set<string>();
	#scopesByWorkstream: Record<string, readonly string[]> = $state({});
	#hydratedScopeIndexes = new Set<string>();
	// ponytail: detached attachments live in memory; after a reload the 24 h staging TTL collects them
	readonly #detachedByScope = new Map<string, StagedAgentAttachment[]>();

	constructor(private readonly storage: DraftStorage | null = browserStorage()) {}

	hydrate(scopeKey: string): void {
		if (!scopeKey || this.#hydratedScopes.has(scopeKey)) return;
		this.#hydratedScopes.add(scopeKey);
		this.#draftsByScope = { ...this.#draftsByScope, [scopeKey]: this.#readStoredDraft(scopeKey) };
	}

	#readStoredDraft(scopeKey: string): AgentDraft {
		let text = '';
		let contextFiles: string[] = [];
		let attachments: StagedAgentAttachment[] = [];
		let issueReferences: AgentIssueReference[] = [];
		let transcriptReferences: AgentTranscriptReference[] = [];
		let elementReferences: AgentElementReference[] = [];
		try {
			text = this.storage?.getItem(`${DRAFT_TEXT_KEY_PREFIX}${scopeKey}`) ?? '';
			const rawContext = this.storage?.getItem(`${DRAFT_CONTEXT_KEY_PREFIX}${scopeKey}`);
			contextFiles = rawContext ? sanitizeContextFiles(parseJson(rawContext)) : [];
			const rawAttachments = this.storage?.getItem(`${DRAFT_ATTACHMENTS_KEY_PREFIX}${scopeKey}`);
			attachments = rawAttachments ? sanitizeAttachments(parseJson(rawAttachments)) : [];
			const rawIssues = this.storage?.getItem(`${DRAFT_ISSUES_KEY_PREFIX}${scopeKey}`);
			issueReferences = rawIssues ? sanitizeAgentIssueReferences(parseJson(rawIssues)) : [];
			const rawTranscripts = this.storage?.getItem(`${DRAFT_TRANSCRIPTS_KEY_PREFIX}${scopeKey}`);
			transcriptReferences = rawTranscripts
				? sanitizeAgentTranscriptReferences(parseJson(rawTranscripts))
				: [];
			const rawElements = this.storage?.getItem(`${DRAFT_ELEMENTS_KEY_PREFIX}${scopeKey}`);
			elementReferences = rawElements ? sanitizeAgentElementReferences(parseJson(rawElements)) : [];
		} catch {}

		return {
			text,
			contextFiles,
			attachments,
			issueReferences,
			transcriptReferences,
			elementReferences,
		};
	}

	hydrateWorkstream(workstreamId: string): void {
		if (!workstreamId || this.#hydratedScopeIndexes.has(workstreamId)) return;
		this.#hydratedScopeIndexes.add(workstreamId);

		let scopes: string[] = [];
		try {
			const raw = this.storage?.getItem(`${DRAFT_SCOPES_KEY_PREFIX}${workstreamId}`);
			if (raw) {
				const parsed: unknown = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					scopes = parsed.filter((value): value is string => typeof value === 'string');
				}
			}
		} catch {
			scopes = [];
		}
		this.#scopesByWorkstream = { ...this.#scopesByWorkstream, [workstreamId]: scopes };
	}

	draftFor(scopeKey: string): AgentDraft {
		const hydrated = this.#draftsByScope[scopeKey];
		if (hydrated) return hydrated;
		if (!scopeKey || this.#hydratedScopes.has(scopeKey)) return EMPTY_DRAFT;
		return this.#readStoredDraft(scopeKey);
	}

	hasDraft(scopeKey: string): boolean {
		const draft = this.#draftsByScope[scopeKey] ?? EMPTY_DRAFT;
		return (
			draft.text.trim().length > 0 ||
			draft.contextFiles.length > 0 ||
			draft.attachments.length > 0 ||
			draft.issueReferences.length > 0 ||
			draft.transcriptReferences.length > 0 ||
			draft.elementReferences.length > 0
		);
	}

	hasDraftForWorkstream(workstreamId: string): boolean {
		return (this.#scopesByWorkstream[workstreamId]?.length ?? 0) > 0;
	}

	setText(scopeKey: string, text: string): void {
		if (!scopeKey) return;
		const current = this.draftFor(scopeKey);
		this.#commit(scopeKey, {
			text,
			contextFiles: current.contextFiles,
			attachments: current.attachments,
			issueReferences: current.issueReferences,
			transcriptReferences: current.transcriptReferences,
			elementReferences: current.elementReferences,
		});
	}

	setContextFiles(scopeKey: string, contextFiles: readonly string[]): void {
		if (!scopeKey) return;
		const current = this.draftFor(scopeKey);
		this.#commit(scopeKey, {
			text: current.text,
			contextFiles: sanitizeContextFiles([...contextFiles]),
			attachments: current.attachments,
			issueReferences: current.issueReferences,
			transcriptReferences: current.transcriptReferences,
			elementReferences: current.elementReferences,
		});
	}

	setAttachments(scopeKey: string, attachments: readonly StagedAgentAttachment[]): void {
		if (!scopeKey) return;
		const current = this.draftFor(scopeKey);
		this.#commit(scopeKey, {
			text: current.text,
			contextFiles: current.contextFiles,
			attachments: sanitizeAttachments([...attachments]),
			issueReferences: current.issueReferences,
			transcriptReferences: current.transcriptReferences,
			elementReferences: current.elementReferences,
		});
	}

	setIssueReferences(scopeKey: string, issueReferences: readonly AgentIssueReference[]): void {
		if (!scopeKey) return;
		const current = this.draftFor(scopeKey);
		this.#commit(scopeKey, {
			text: current.text,
			contextFiles: current.contextFiles,
			attachments: current.attachments,
			issueReferences: sanitizeAgentIssueReferences(issueReferences),
			transcriptReferences: current.transcriptReferences,
			elementReferences: current.elementReferences,
		});
	}

	setTranscriptReferences(
		scopeKey: string,
		transcriptReferences: readonly AgentTranscriptReference[],
	): void {
		if (!scopeKey) return;
		const current = this.draftFor(scopeKey);
		this.#commit(scopeKey, {
			text: current.text,
			contextFiles: current.contextFiles,
			attachments: current.attachments,
			issueReferences: current.issueReferences,
			transcriptReferences: sanitizeAgentTranscriptReferences(transcriptReferences),
			elementReferences: current.elementReferences,
		});
	}

	setElementReferences(
		scopeKey: string,
		elementReferences: readonly AgentElementReference[],
	): void {
		if (!scopeKey) return;
		const current = this.draftFor(scopeKey);
		this.#commit(scopeKey, {
			text: current.text,
			contextFiles: current.contextFiles,
			attachments: current.attachments,
			issueReferences: current.issueReferences,
			transcriptReferences: current.transcriptReferences,
			elementReferences: sanitizeAgentElementReferences(elementReferences),
		});
	}

	clear(scopeKey: string): void {
		if (!scopeKey) return;
		this.#commit(scopeKey, EMPTY_DRAFT);
	}

	detachAttachment(scopeKey: string, attachmentId: string): void {
		const current = this.draftFor(scopeKey);
		const detached = current.attachments.find(({ id }) => id === attachmentId);
		if (!detached) return;
		this.setAttachments(
			scopeKey,
			current.attachments.filter(({ id }) => id !== attachmentId),
		);
		this.#detachedByScope.set(scopeKey, [...this.#detached(scopeKey), detached]);
	}

	reattachReferenced(scopeKey: string, prompt: string): void {
		const detached = this.#detached(scopeKey);
		if (detached.length === 0) return;
		const referenced = new Set(promptChipIds(prompt, 'attachment'));
		const restored = detached.filter(({ id }) => referenced.has(id));
		if (restored.length === 0) return;
		this.#detachedByScope.set(
			scopeKey,
			detached.filter(({ id }) => !referenced.has(id)),
		);
		this.setAttachments(scopeKey, [...this.draftFor(scopeKey).attachments, ...restored]);
	}

	takeDetached(scopeKey: string): StagedAgentAttachment[] {
		const detached = this.#detached(scopeKey);
		this.#detachedByScope.delete(scopeKey);
		return detached;
	}

	#detached(scopeKey: string): StagedAgentAttachment[] {
		return this.#detachedByScope.get(scopeKey) ?? [];
	}

	#commit(scopeKey: string, draft: AgentDraft): void {
		this.hydrate(scopeKey);
		const text = draft.text.trim() ? draft.text : '';
		this.#draftsByScope = {
			...this.#draftsByScope,
			[scopeKey]: {
				text,
				contextFiles: [...draft.contextFiles],
				attachments: draft.attachments.map((attachment) => ({ ...attachment })),
				issueReferences: draft.issueReferences.map((reference) => ({ ...reference })),
				transcriptReferences: draft.transcriptReferences.map((reference) => ({ ...reference })),
				elementReferences: draft.elementReferences.map((reference) => ({
					...reference,
					rect: { ...reference.rect },
				})),
			},
		};

		try {
			if (text) {
				this.storage?.setItem(`${DRAFT_TEXT_KEY_PREFIX}${scopeKey}`, text);
			} else {
				this.storage?.removeItem(`${DRAFT_TEXT_KEY_PREFIX}${scopeKey}`);
			}

			if (draft.contextFiles.length > 0) {
				this.storage?.setItem(
					`${DRAFT_CONTEXT_KEY_PREFIX}${scopeKey}`,
					JSON.stringify(draft.contextFiles),
				);
			} else {
				this.storage?.removeItem(`${DRAFT_CONTEXT_KEY_PREFIX}${scopeKey}`);
			}

			if (draft.attachments.length > 0) {
				this.storage?.setItem(
					`${DRAFT_ATTACHMENTS_KEY_PREFIX}${scopeKey}`,
					JSON.stringify(draft.attachments),
				);
			} else {
				this.storage?.removeItem(`${DRAFT_ATTACHMENTS_KEY_PREFIX}${scopeKey}`);
			}

			if (draft.issueReferences.length > 0) {
				this.storage?.setItem(
					`${DRAFT_ISSUES_KEY_PREFIX}${scopeKey}`,
					JSON.stringify(draft.issueReferences),
				);
			} else {
				this.storage?.removeItem(`${DRAFT_ISSUES_KEY_PREFIX}${scopeKey}`);
			}

			if (draft.transcriptReferences.length > 0) {
				this.storage?.setItem(
					`${DRAFT_TRANSCRIPTS_KEY_PREFIX}${scopeKey}`,
					JSON.stringify(draft.transcriptReferences),
				);
			} else {
				this.storage?.removeItem(`${DRAFT_TRANSCRIPTS_KEY_PREFIX}${scopeKey}`);
			}

			if (draft.elementReferences.length > 0) {
				this.storage?.setItem(
					`${DRAFT_ELEMENTS_KEY_PREFIX}${scopeKey}`,
					JSON.stringify(draft.elementReferences),
				);
			} else {
				this.storage?.removeItem(`${DRAFT_ELEMENTS_KEY_PREFIX}${scopeKey}`);
			}
		} catch {}

		this.#rememberDraftScope(scopeKey, this.hasDraft(scopeKey));
	}

	#rememberDraftScope(scopeKey: string, hasDraft: boolean): void {
		const separator = scopeKey.indexOf('|');
		const workstreamId = separator < 0 ? scopeKey : scopeKey.slice(0, separator);
		if (!workstreamId) return;
		this.hydrateWorkstream(workstreamId);
		const current = this.#scopesByWorkstream[workstreamId] ?? [];
		if (current.includes(scopeKey) === hasDraft) return;
		const next = hasDraft ? [...current, scopeKey] : current.filter((scope) => scope !== scopeKey);
		this.#scopesByWorkstream = { ...this.#scopesByWorkstream, [workstreamId]: next };
		try {
			if (next.length === 0) {
				this.storage?.removeItem(`${DRAFT_SCOPES_KEY_PREFIX}${workstreamId}`);
			} else {
				this.storage?.setItem(`${DRAFT_SCOPES_KEY_PREFIX}${workstreamId}`, JSON.stringify(next));
			}
		} catch {}
	}
}

export const agentDrafts = new AgentDrafts();
