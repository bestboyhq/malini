const EXTENSION_STATE_PREFIX = 'malini.extensions.state.v1:';
const EXTENSION_SETTINGS_PREFIX = 'malini.extensions.settings.v1/';
const ENTRY_MARKER = ':entry:';
const PENDING_SUFFIX = ':pending';
const LEGACY_SCOPE_KIND = 'workspace';
const SCOPE_KIND = 'workstream';

type StorageRewrite = Readonly<{ key: string; value: string }>;

export function migrateExtensionScopeKeys(storage: Storage): void {
	let keys: string[];
	try {
		keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
			(key): key is string => key !== null,
		);
	} catch {
		return;
	}
	for (const key of keys) {
		try {
			const value = storage.getItem(key);
			if (value === null) continue;
			const rewrite = rewriteExtensionScopeEntry(key, value);
			if (rewrite === null) continue;
			if (rewrite.key === key) {
				storage.setItem(key, rewrite.value);
				continue;
			}
			if (storage.getItem(rewrite.key) === null) storage.setItem(rewrite.key, rewrite.value);
			storage.removeItem(key);
		} catch {}
	}
}

export function rewriteExtensionScopeEntry(key: string, value: string): StorageRewrite | null {
	if (key.startsWith(EXTENSION_SETTINGS_PREFIX)) return rewriteSettingKey(key, value);
	if (!key.startsWith(EXTENSION_STATE_PREFIX)) return null;
	const entryIndex = key.indexOf(ENTRY_MARKER);
	if (entryIndex === -1) return rewriteLegacyEnvelope(key, value);
	return rewriteStateRecord(key, value, entryIndex);
}

function rewriteSettingKey(key: string, value: string): StorageRewrite | null {
	const segments = key.slice(EXTENSION_SETTINGS_PREFIX.length).split('/');
	const scope = segments[1];
	if (!scope?.startsWith(`${LEGACY_SCOPE_KIND}.`)) return null;
	segments[1] = `${SCOPE_KIND}${scope.slice(LEGACY_SCOPE_KIND.length)}`;
	return { key: `${EXTENSION_SETTINGS_PREFIX}${segments.join('/')}`, value };
}

function rewriteStateRecord(key: string, value: string, entryIndex: number): StorageRewrite | null {
	const pending = key.endsWith(PENDING_SUFFIX);
	const encodedIdentity = key.slice(
		entryIndex + ENTRY_MARKER.length,
		pending ? key.length - PENDING_SUFFIX.length : key.length,
	);
	const identity = decodeURIComponent(encodedIdentity);
	const migratedIdentity = migrateIdentity(identity);
	if (migratedIdentity === null) return null;
	const migratedKey = `${key.slice(0, entryIndex)}${ENTRY_MARKER}${encodeURIComponent(migratedIdentity)}${pending ? PENDING_SUFFIX : ''}`;
	if (pending) return { key: migratedKey, value };
	return { key: migratedKey, value: migrateRecordIdentity(value, identity, migratedIdentity) };
}

function migrateIdentity(identity: string): string | null {
	const parsed = parseJson(identity);
	if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== LEGACY_SCOPE_KIND) {
		return null;
	}
	return JSON.stringify([SCOPE_KIND, parsed[1], parsed[2]]);
}

function migrateRecordIdentity(value: string, identity: string, migratedIdentity: string): string {
	const record = parseJson(value);
	if (!isRecord(record) || record.identity !== identity) return value;
	return JSON.stringify({ ...record, identity: migratedIdentity });
}

function rewriteLegacyEnvelope(key: string, value: string): StorageRewrite | null {
	const envelope = parseJson(value);
	if (!isRecord(envelope) || !Array.isArray(envelope.entries)) return null;
	let changed = false;
	const entries = envelope.entries.map((entry: unknown) => {
		if (!isRecord(entry) || !isRecord(entry.scope) || entry.scope.kind !== LEGACY_SCOPE_KIND) {
			return entry;
		}
		changed = true;
		return { ...entry, scope: { ...entry.scope, kind: SCOPE_KIND } };
	});
	return changed ? { key, value: JSON.stringify({ ...envelope, entries }) } : null;
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
