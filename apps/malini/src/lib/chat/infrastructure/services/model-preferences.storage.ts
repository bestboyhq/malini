import {
	DEFAULT_AGENT_RUN_PROFILE,
	DEFAULT_MODEL_PREFERENCES,
	agentAccessDefaultQuery,
	cloneModelSelection,
	isValidAgentAccess,
	isValidModelSelection,
	modelDefaultsQuery,
	normalizeAgentRunProfile,
	normalizeModelSelection,
	roleForAgentMode,
	type AgentAccess,
	type ChatModelSnapshot,
	type ChatSetup,
} from '$shared/providers/providers.api';

type ModelPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const NEW_CHAT_SETUP_KEY = 'malini.chat.new-chat-setup:v1';
const CHAT_SETUP_PREFIX = 'malini.chat.setup:v1:';
const CHAT_SNAPSHOT_PREFIX = 'malini.chat.chat-model:v1:';
const WORKSTREAM_PROFILE_PREFIX = 'malini.chat.profile:';
const LEGACY_MODEL_MEMORY_KEY = 'malini.chat.model-memory:v2';
const LEGACY_EFFORT_KEY = 'malini.chat.last-effort:v1';
const LEGACY_REPORT_KEY = 'malini.chat.last-report:v1';

export function readNewChatSetup(
	workstreamId: string,
	storage: ModelPreferenceStorage | null = browserStorage(),
): ChatSetup {
	const access = workstreamAccess(workstreamId, storage);
	const last = readJson(NEW_CHAT_SETUP_KEY, storage);
	const lastProfile = isRecord(last)
		? last.profile
		: {
				...DEFAULT_AGENT_RUN_PROFILE,
				effort: readJson(LEGACY_EFFORT_KEY, storage) ?? DEFAULT_AGENT_RUN_PROFILE.effort,
				report: readJson(LEGACY_REPORT_KEY, storage),
			};
	const profile = normalizeAgentRunProfile(
		isRecord(lastProfile) ? { ...lastProfile, access } : null,
		access,
	) ?? { ...DEFAULT_AGENT_RUN_PROFILE, access };
	const role = roleForAgentMode(profile.mode);
	const legacyModels = readJson(LEGACY_MODEL_MEMORY_KEY, storage);
	const selection = normalizeModelSelection(
		isRecord(last) ? last.selection : isRecord(legacyModels) ? legacyModels[role] : null,
		modelDefaultsQuery.data[role],
	);
	return { selection, profile };
}

export function rememberNewChatSetup(
	workstreamId: string,
	setup: ChatSetup,
	storage: ModelPreferenceStorage | null = browserStorage(),
): void {
	writeJson(NEW_CHAT_SETUP_KEY, setup, storage);
	writeJson(
		`${WORKSTREAM_PROFILE_PREFIX}${workstreamId}`,
		{ access: setup.profile.access },
		storage,
	);
}

export function rememberChatPick(
	workstreamId: string,
	sessionId: string | null,
	setup: ChatSetup,
	storage: ModelPreferenceStorage | null = browserStorage(),
): void {
	if (sessionId) writeChatSetup(sessionId, setup, storage);
	rememberNewChatSetup(workstreamId, setup, storage);
}

export function readChatSetup(
	sessionId: string,
	storage: ModelPreferenceStorage | null = browserStorage(),
): ChatSetup | null {
	const parsed = readJson(`${CHAT_SETUP_PREFIX}${sessionId}`, storage);
	if (!isRecord(parsed) || !isValidModelSelection(parsed.selection)) return null;
	const profile = normalizeAgentRunProfile(parsed.profile, agentAccessDefaultQuery.data);
	return profile ? { selection: cloneModelSelection(parsed.selection), profile } : null;
}

export function writeChatSetup(
	sessionId: string,
	setup: ChatSetup,
	storage: ModelPreferenceStorage | null = browserStorage(),
): void {
	writeJson(`${CHAT_SETUP_PREFIX}${sessionId}`, setup, storage);
}

export function chatModelSnapshotKey(sessionId: string): string {
	return `${CHAT_SNAPSHOT_PREFIX}${sessionId}`;
}

export function readChatModelSnapshot(
	sessionId: string,
	storage: ModelPreferenceStorage | null = browserStorage(),
): ChatModelSnapshot | null {
	const parsed = readJson(chatModelSnapshotKey(sessionId), storage);
	if (!isRecord(parsed)) return null;
	if (parsed.role !== 'planning' && parsed.role !== 'implementation') return null;
	return {
		role: parsed.role,
		selection: normalizeModelSelection(parsed.selection, DEFAULT_MODEL_PREFERENCES[parsed.role]),
	};
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

function workstreamAccess(
	workstreamId: string,
	storage: ModelPreferenceStorage | null,
): AgentAccess {
	const stored = readJson(`${WORKSTREAM_PROFILE_PREFIX}${workstreamId}`, storage);
	return isRecord(stored) && isValidAgentAccess(stored.access)
		? stored.access
		: agentAccessDefaultQuery.data;
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
