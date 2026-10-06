import type {
	AgentRunChangePatch,
	AgentSessionChangePatch,
	AgentSessionChanges,
	LiveEventEnvelope,
	ClaudeSetupStep,
	ProviderCapability,
	StagedAgentAttachment,
} from '$contract/agent';
import { deriveAgentChatDisplayName } from '$contract/chat-identity';
import type { WorktreeChangeTotals, WorktreeStatus } from '$contract/repositories';
import type {
	ExtensionDevelopmentLog,
	ExtensionSourceSnapshot,
	ManagedExtensionSourceSnapshot,
	OwnedContainer,
} from '$contract/system';
import {
	defaultAgentScript,
	defaultDiff,
	defaultProviderCapabilities,
	defaultSeed,
	type FakeAgentEventSeed,
	type FakeAgentScriptStep,
	type FakeAgentSessionSeed,
	type FakeProject,
	type FakeWorkstream,
	type FakeWorkstreamGitStatus,
	type PlatformSeed,
} from './seed';

export type { FakeProject, FakeWorkstream } from './seed';

export type FakeSession = {
	id: string;
	workstreamId: string;
	displayName: string;
	model?: string | undefined;
	startedAt: string;
	archivedAt: string | null;
	status: 'idle' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';
	hasSentPrompt: boolean;
	currentRunId: string | null;
	cancelled: boolean;
};

export type FakeState = {
	projects: FakeProject[];
	workstreams: FakeWorkstream[];
	diffs: Record<string, string>;
	workstreamFiles: Record<string, string[]>;
	createdWorkstreamFileContents: Record<string, string>;
	stagedAgentAttachments: Record<string, StagedAgentAttachment[]>;
	removeStagedAgentAttachmentErrors: Record<string, string>;
	workstreamStatuses: Record<string, WorktreeStatus>;
	workstreamChangeTotals: Record<string, WorktreeChangeTotals>;
	ownedDockerContainers: Record<string, OwnedContainer>;
	extensionWorkstreamFiles: Record<string, Record<string, string>>;
	extensionSources: ExtensionSourceSnapshot[];
	managedExtensionSources: ManagedExtensionSourceSnapshot[];
	managedExtensionHistory: Record<string, ManagedExtensionSourceSnapshot[]>;
	extensionRecoveryMode: boolean;
	extensionDevelopmentLogs: ExtensionDevelopmentLog[];
	settings: Record<string, string>;
	secrets: Map<string, string>;
	agentScript: readonly FakeAgentScriptStep[];
	providerCapabilities: ProviderCapability[];
	claudeSetupSteps: ClaudeSetupStep[];
	nextSession: number;
	agentSessionBootstrapFailures: number;
	agentSessionBootstrapError: string;
	nextRun: number;
	seqBySession: Map<string, number>;
	eventOrder: WeakMap<LiveEventEnvelope, number>;
	nextEventOrder: number;
	sessions: Map<string, FakeSession>;
	eventLogBySession: Map<string, LiveEventEnvelope[]>;
	agentSessionChanges: Record<string, AgentSessionChanges>;
	agentRunChangePatches: Record<string, Record<string, AgentRunChangePatch>>;
	agentSessionChangePatches: Record<string, Record<string, AgentSessionChangePatch>>;
	pendingApprovals: Map<string, { resolve: () => void }>;
	pendingQuestions: Map<string, { resolve: () => void }>;
	resolvedApprovals: Set<string>;
	resolvedQuestions: Set<string>;
	obsoletedRunIds: Set<string>;
};

export function createFakeState(seed: PlatformSeed): FakeState {
	const merged = mergeSeed(seed);
	const sessions = buildSeededSessions(merged.agentSessions ?? [], merged.agentEvents ?? {});
	const { eventLogBySession, seqBySession, eventOrder, nextEventOrder } = buildSeededEventLog(
		merged.agentEvents ?? {},
	);
	return {
		projects: cloneProjects(merged.projects ?? []),
		workstreams: cloneWorkstreams(merged.workstreams ?? []),
		diffs: { ...(merged.diffs ?? {}) },
		workstreamFiles: cloneStringRecord(merged.workstreamFiles ?? {}),
		createdWorkstreamFileContents: { ...(merged.createdWorkstreamFileContents ?? {}) },
		stagedAgentAttachments: Object.fromEntries(
			Object.entries(merged.stagedAgentAttachments ?? {}).map(([workstreamId, attachments]) => [
				workstreamId,
				attachments.map((attachment) => ({ ...attachment })),
			]),
		),
		removeStagedAgentAttachmentErrors: { ...(merged.removeStagedAgentAttachmentErrors ?? {}) },
		workstreamStatuses: cloneWorkstreamStatuses(merged.workstreamStatuses ?? {}),
		workstreamChangeTotals: Object.fromEntries(
			Object.entries(merged.workstreamChangeTotals ?? {}).map(([workstreamId, totals]) => [
				workstreamId,
				{ ...totals, files: totals.files ?? 0 },
			]),
		),
		ownedDockerContainers: {},
		extensionWorkstreamFiles: Object.fromEntries(
			Object.entries(merged.workstreamFiles ?? {}).map(([workstreamId, paths]) => [
				workstreamId,
				Object.fromEntries(
					paths.map((path) => [path, merged.workstreamFileContents?.[workstreamId]?.[path] ?? '']),
				),
			]),
		),
		extensionSources: (merged.extensionSources ?? []).map((source) => ({ ...source })),
		managedExtensionSources: (merged.managedExtensionSources ?? []).map(cloneManagedSource),
		managedExtensionHistory: Object.fromEntries(
			Object.entries(merged.managedExtensionHistory ?? {}).map(([id, history]) => [
				id,
				history.map(cloneManagedSource),
			]),
		),
		extensionRecoveryMode: merged.extensionRecoveryMode ?? false,
		extensionDevelopmentLogs: [],
		settings: { ...(merged.settings ?? {}) },
		secrets: new Map(Object.entries(merged.secrets ?? {})),
		agentScript: [...(merged.agentScript ?? defaultAgentScript)],
		providerCapabilities: (merged.providerCapabilities ?? defaultProviderCapabilities).map(
			cloneProviderCapability,
		),
		claudeSetupSteps: [],
		nextSession: 1,
		agentSessionBootstrapFailures: merged.agentSessionBootstrapFailures ?? 0,
		agentSessionBootstrapError:
			merged.agentSessionBootstrapError ?? 'agent bridge restart failed: fixture unavailable',
		nextRun: 1,
		seqBySession,
		eventOrder,
		nextEventOrder,
		sessions,
		eventLogBySession,
		agentSessionChanges: Object.fromEntries(
			Object.entries(merged.agentSessionChanges ?? {}).map(([sessionId, changes]) => [
				sessionId,
				cloneAgentSessionChanges(changes),
			]),
		),
		agentRunChangePatches: Object.fromEntries(
			Object.entries(merged.agentRunChangePatches ?? {}).map(([sessionId, patches]) => [
				sessionId,
				Object.fromEntries(Object.entries(patches).map(([runId, patch]) => [runId, { ...patch }])),
			]),
		),
		agentSessionChangePatches: Object.fromEntries(
			Object.entries(merged.agentSessionChangePatches ?? {}).map(([sessionId, patches]) => [
				sessionId,
				Object.fromEntries(Object.entries(patches).map(([path, patch]) => [path, { ...patch }])),
			]),
		),
		pendingApprovals: new Map(),
		pendingQuestions: new Map(),
		resolvedApprovals: new Set(),
		resolvedQuestions: new Set(),
		obsoletedRunIds: new Set(),
	};
}

export function fakeInteractionKey(sessionId: string, runId: string, requestId: string): string {
	return `${sessionId}:${runId}:${requestId}`;
}

export function createFakeInteractionGate(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

export function buildSeededSessions(
	seeds: readonly FakeAgentSessionSeed[],
	eventsBySession: Record<string, readonly FakeAgentEventSeed[]>,
): Map<string, FakeSession> {
	const sessions = new Map<string, FakeSession>();
	for (const sessionSeed of seeds) {
		const eventSeeds = eventsBySession[sessionSeed.id] ?? [];
		const firstPrompt = eventSeeds.find(
			(entry) => entry.event.type === 'user.message' && typeof entry.event.text === 'string',
		)?.event.text;
		const fallbackName = nextFakeChatFallback(sessions, sessionSeed.workstreamId);
		const requestedName =
			sessionSeed.displayName ??
			(typeof firstPrompt === 'string' ? deriveAgentChatDisplayName(firstPrompt) : null) ??
			fallbackName;
		sessions.set(sessionSeed.id, {
			id: sessionSeed.id,
			workstreamId: sessionSeed.workstreamId,
			displayName: uniqueFakeChatName(sessions, sessionSeed.workstreamId, requestedName),
			model: sessionSeed.model,
			startedAt: sessionSeed.startedAt ?? '2026-01-01T00:00:00.000Z',
			archivedAt: sessionSeed.archivedAt ?? null,
			status: seededSessionStatus(sessionSeed, eventSeeds),
			hasSentPrompt:
				Boolean(sessionSeed.displayName) ||
				eventSeeds.some((entry) => entry.event.type === 'user.message'),
			currentRunId: sessionSeed.currentRunId ?? null,
			cancelled: false,
		});
	}
	return sessions;
}

export function nextFakeChatFallback(
	sessions: Map<string, FakeSession>,
	workstreamId: string,
): string {
	return uniqueFakeChatName(sessions, workstreamId, 'New chat');
}

export function seededSessionStatus(
	seed: FakeAgentSessionSeed,
	events: readonly FakeAgentEventSeed[],
): FakeSession['status'] {
	if (seed.status === 'running' || seed.status === 'waiting_for_approval') return seed.status;
	if (seed.currentRunId) return 'running';
	for (const entry of [...events].reverse()) {
		if (entry.event.type === 'run.failed') return 'failed';
		if (entry.event.type === 'run.completed') return 'completed';
		if (entry.event.type === 'approval.requested' || entry.event.type === 'question.requested') {
			return 'waiting_for_approval';
		}
		if (entry.event.type === 'run.started') return 'running';
	}
	return seed.status ?? 'idle';
}

export function uniqueFakeChatName(
	sessions: Map<string, FakeSession>,
	workstreamId: string,
	baseName: string,
	excludedSessionId?: string,
): string {
	const existing = new Set(
		[...sessions.values()]
			.filter(
				(session) => session.workstreamId === workstreamId && session.id !== excludedSessionId,
			)
			.map((session) => session.displayName.toLocaleLowerCase()),
	);
	let candidate = baseName;
	let suffix = 2;
	while (existing.has(candidate.toLocaleLowerCase())) {
		candidate = `${baseName} ${suffix}`;
		suffix += 1;
	}
	return candidate;
}

export function buildSeededEventLog(seeds: Record<string, readonly FakeAgentEventSeed[]>): {
	eventLogBySession: Map<string, LiveEventEnvelope[]>;
	seqBySession: Map<string, number>;
	eventOrder: WeakMap<LiveEventEnvelope, number>;
	nextEventOrder: number;
} {
	const eventLogBySession = new Map<string, LiveEventEnvelope[]>();
	const seqBySession = new Map<string, number>();
	const eventOrder = new WeakMap<LiveEventEnvelope, number>();
	let nextEventOrder = 1;
	for (const [sessionId, envelopeSeeds] of Object.entries(seeds)) {
		let seq = 0;
		const log: LiveEventEnvelope[] = [];
		for (const envelopeSeed of envelopeSeeds) {
			seq = typeof envelopeSeed.seq === 'number' ? envelopeSeed.seq : seq + 1;
			const envelope: LiveEventEnvelope = {
				sessionId,
				runId: envelopeSeed.runId,
				seq,
				event: envelopeSeed.event,
				...(envelopeSeed.ephemeral === true ? { ephemeral: true } : {}),
			};
			eventOrder.set(envelope, nextEventOrder);
			nextEventOrder += 1;
			log.push(envelope);
		}
		eventLogBySession.set(sessionId, log);
		seqBySession.set(sessionId, seq);
	}
	return { eventLogBySession, seqBySession, eventOrder, nextEventOrder };
}

function mergeSeed(seed: PlatformSeed): PlatformSeed {
	return {
		...defaultSeed,
		...seed,
		projects: seed.projects ?? defaultSeed.projects ?? [],
		workstreams: seed.workstreams ?? defaultSeed.workstreams ?? [],
		diffs: { ...(defaultSeed.diffs ?? { '*': defaultDiff }), ...(seed.diffs ?? {}) },
		workstreamFiles: {
			...(defaultSeed.workstreamFiles ?? {}),
			...(seed.workstreamFiles ?? {}),
		},
		workstreamFileContents: {
			...(defaultSeed.workstreamFileContents ?? {}),
			...(seed.workstreamFileContents ?? {}),
		},
		stagedAgentAttachments: {
			...(defaultSeed.stagedAgentAttachments ?? {}),
			...(seed.stagedAgentAttachments ?? {}),
		},
		removeStagedAgentAttachmentErrors: {
			...(defaultSeed.removeStagedAgentAttachmentErrors ?? {}),
			...(seed.removeStagedAgentAttachmentErrors ?? {}),
		},
		workstreamStatuses: {
			...(defaultSeed.workstreamStatuses ?? {}),
			...(seed.workstreamStatuses ?? {}),
		},
		settings: { ...(defaultSeed.settings ?? {}), ...(seed.settings ?? {}) },
		secrets: { ...(defaultSeed.secrets ?? {}), ...(seed.secrets ?? {}) },
		agentScript: seed.agentScript ?? defaultSeed.agentScript ?? [],
		agentSessions: seed.agentSessions ?? defaultSeed.agentSessions ?? [],
		agentEvents: seed.agentEvents ?? defaultSeed.agentEvents ?? {},
		providerCapabilities: mergeProviderCapabilities(seed.providerCapabilities),
	};
}

function mergeProviderCapabilities(
	overrides: readonly ProviderCapability[] | undefined,
): ProviderCapability[] {
	const capabilities = overrides?.length ? overrides : defaultProviderCapabilities;
	return capabilities.map(cloneProviderCapability);
}

export function cloneProviderCapability(capability: ProviderCapability): ProviderCapability {
	return {
		...capability,
		account: capability.account ? { ...capability.account } : null,
		models: capability.models.map((model) => ({ ...model, efforts: [...model.efforts] })),
	};
}

export function cloneEnvelope(envelope: LiveEventEnvelope): LiveEventEnvelope {
	return {
		...envelope,
		event: isRecord(envelope.event) ? { ...envelope.event } : envelope.event,
	};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function cloneAgentSessionChanges(changes: AgentSessionChanges): AgentSessionChanges {
	return {
		...changes,
		runs: changes.runs.map((run) => ({
			...run,
			files: run.files.map((file) => ({ ...file })),
		})),
		files: changes.files.map((file) => ({ ...file, runIds: [...file.runIds] })),
	};
}

export function cloneProjects(projects: readonly FakeProject[]): FakeProject[] {
	return projects.map((project) => ({ ...project }));
}

export function cloneWorkstreams(workstreams: readonly FakeWorkstream[]): FakeWorkstream[] {
	return workstreams.map((workstream) => ({
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: null,
		...workstream,
	}));
}

export function cloneStringRecord(
	record: Record<string, readonly string[]>,
): Record<string, string[]> {
	return Object.fromEntries(
		Object.entries(record).map(([key, value]) => [key, uniqueSorted([...value])]),
	);
}

export function cloneWorkstreamStatuses(
	statuses: Record<string, FakeWorkstreamGitStatus>,
): Record<string, WorktreeStatus> {
	return Object.fromEntries(
		Object.entries(statuses).map(([key, value]) => [key, cloneWorkstreamGitStatus(value)]),
	);
}

export function cloneWorkstreamGitStatus(
	status: FakeWorkstreamGitStatus | WorktreeStatus,
): WorktreeStatus {
	return {
		...status,
		dirtyPaths: [...status.dirtyPaths],
		conflictedPaths: [...(status.conflictedPaths ?? [])],
		conflictMarkerPaths: [...(status.conflictMarkerPaths ?? [])],
		hasUpstream: status.hasUpstream ?? true,
		mergeInProgress: status.mergeInProgress ?? false,
		operationInProgress: status.operationInProgress ?? null,
		headSha: status.headSha ?? null,
	};
}

export function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function stableHash(value: string): string {
	let hash = 0;
	for (let i = 0; i < value.length; i += 1) {
		hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

export function stableHex(value: string, digits: number): string {
	let hex = '';
	for (let round = 0; hex.length < digits; round += 1) hex += stableHash(`${value}:${round}`);
	return hex.slice(0, digits);
}

function cloneManagedSource(
	source: ManagedExtensionSourceSnapshot,
): ManagedExtensionSourceSnapshot {
	return { ...source, previousVersions: [...source.previousVersions] };
}
