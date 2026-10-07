import {
	DEFAULT_AGENT_RUN_PROFILE,
	DEFAULT_MODEL_PREFERENCES,
	agentAccessDefaultQuery,
	normalizeAgentRunProfile,
	cloneModelSelection,
	isValidModelSelection,
	normalizeModelPreferences,
	type AgentRunProfile,
	type ChatModelSnapshot,
	type ModelPreferences,
} from '$shared/providers/providers.api';

type ModelPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const MODEL_MEMORY_KEY = 'malini.chat.model-memory:v2';
const CHAT_SNAPSHOT_PREFIX = 'malini.chat.chat-model:v1:';
const WORKSTREAM_PROFILE_PREFIX = 'malini.chat.profile:';

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

export function chatModelSnapshotKey(sessionId: string): string {
	return `${CHAT_SNAPSHOT_PREFIX}${sessionId}`;
}

export function readModelMemory(
	defaults: ModelPreferences,
	storage: ModelPreferenceStorage | null = browserStorage(),
): ModelPreferences {
	return normalizeModelPreferences(
		readJson(MODEL_MEMORY_KEY, storage),
		normalizeModelPreferences(defaults, DEFAULT_MODEL_PREFERENCES),
	);
}

export function writeModelMemory(
	preferences: ModelPreferences,
	defaults: ModelPreferences = DEFAULT_MODEL_PREFERENCES,
	storage: ModelPreferenceStorage | null = browserStorage(),
): ModelPreferences {
	const normalized = normalizeModelPreferences(preferences, defaults);
	writeJson(MODEL_MEMORY_KEY, normalized, storage);
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
