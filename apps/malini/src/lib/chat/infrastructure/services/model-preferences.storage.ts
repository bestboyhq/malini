import {
	DEFAULT_AGENT_RUN_PROFILE,
	DEFAULT_MODEL_PREFERENCES,
	agentAccessDefaultQuery,
	normalizeAgentRunProfile,
	cloneModelSelection,
	isValidAgentModel,
	isValidModelSelection,
	normalizeModelPreferences,
	type AgentModel,
	type AgentRunProfile,
	type ChatModelSnapshot,
	type ModelPreferences,
} from '$shared/providers/providers.api';

type ModelPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

const WORKSTREAM_MEMORY_PREFIX = 'malini.chat.model-memory:v1:';
const CHAT_SNAPSHOT_PREFIX = 'malini.chat.chat-model:v1:';
const WORKSTREAM_MODEL_PREFIX = 'malini.chat.model:';
const WORKSTREAM_PROFILE_PREFIX = 'malini.chat.profile:';

export function readStoredWorkstreamModel(workstreamId: string): AgentModel | null {
	try {
		const raw = globalThis.localStorage?.getItem(`${WORKSTREAM_MODEL_PREFIX}${workstreamId}`);
		return isValidAgentModel(raw) ? raw : null;
	} catch {
		return null;
	}
}

export function writeStoredWorkstreamModel(workstreamId: string, model: AgentModel): void {
	try {
		globalThis.localStorage?.setItem(`${WORKSTREAM_MODEL_PREFIX}${workstreamId}`, model);
	} catch {}
}

export function readStoredRunProfile(workstreamId: string): AgentRunProfile {
	const access = agentAccessDefaultQuery.data;
	try {
		const raw = globalThis.localStorage?.getItem(`${WORKSTREAM_PROFILE_PREFIX}${workstreamId}`);
		const profile = normalizeAgentRunProfile(raw ? JSON.parse(raw) : null, access);
		if (profile) return profile;
	} catch {}
	return { ...DEFAULT_AGENT_RUN_PROFILE, access };
}

export function hasStoredRunProfile(workstreamId: string): boolean {
	try {
		return globalThis.localStorage?.getItem(`${WORKSTREAM_PROFILE_PREFIX}${workstreamId}`) !== null;
	} catch {
		return false;
	}
}

export function writeStoredRunProfile(workstreamId: string, profile: AgentRunProfile): void {
	try {
		globalThis.localStorage?.setItem(
			`${WORKSTREAM_PROFILE_PREFIX}${workstreamId}`,
			JSON.stringify(profile),
		);
	} catch {}
}

export function hasStoredWorkstreamModelMemory(workstreamId: string): boolean {
	try {
		return globalThis.localStorage?.getItem(workstreamModelMemoryKey(workstreamId)) !== null;
	} catch {
		return false;
	}
}

export function workstreamModelMemoryKey(workstreamId: string): string {
	return `${WORKSTREAM_MEMORY_PREFIX}${workstreamId}`;
}

export function chatModelSnapshotKey(sessionId: string): string {
	return `${CHAT_SNAPSHOT_PREFIX}${sessionId}`;
}

export function readWorkstreamModelMemory(
	workstreamId: string,
	workstreamDefaults: ModelPreferences,
	storage: ModelPreferenceStorage | null = browserStorage(),
): ModelPreferences {
	return normalizeModelPreferences(
		readJson(workstreamModelMemoryKey(workstreamId), storage),
		normalizeModelPreferences(workstreamDefaults, DEFAULT_MODEL_PREFERENCES),
	);
}

export function writeWorkstreamModelMemory(
	workstreamId: string,
	preferences: ModelPreferences,
	workstreamDefaults: ModelPreferences = DEFAULT_MODEL_PREFERENCES,
	storage: ModelPreferenceStorage | null = browserStorage(),
): ModelPreferences {
	const normalized = normalizeModelPreferences(preferences, workstreamDefaults);
	writeJson(workstreamModelMemoryKey(workstreamId), normalized, storage);
	return normalized;
}

export function readChatModelSnapshot(
	sessionId: string,
	storage: ModelPreferenceStorage | null = browserStorage(),
): ChatModelSnapshot | null {
	const parsed = readJson(chatModelSnapshotKey(sessionId), storage);
	if (!isRecord(parsed)) return null;
	if (parsed.role !== 'planning' && parsed.role !== 'implementation') return null;
	if (!isValidModelSelection(parsed.selection)) return null;
	return { role: parsed.role, selection: cloneModelSelection(parsed.selection) };
}

export function writeChatModelSnapshot(
	sessionId: string,
	snapshot: ChatModelSnapshot,
	storage: ModelPreferenceStorage | null = browserStorage(),
): ChatModelSnapshot {
	if (!isValidModelSelection(snapshot.selection)) {
		throw new Error(`Invalid ${snapshot.role} model selection`);
	}
	const normalized = {
		role: snapshot.role,
		selection: cloneModelSelection(snapshot.selection),
	};
	writeJson(chatModelSnapshotKey(sessionId), normalized, storage);
	return normalized;
}

function readJson(key: string, storage: ModelPreferenceStorage | null): unknown {
	try {
		const raw = storage?.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function writeJson(key: string, value: unknown, storage: ModelPreferenceStorage | null): void {
	try {
		storage?.setItem(key, JSON.stringify(value));
	} catch {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function browserStorage(): ModelPreferenceStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}
