import type { ExtensionAPI, ExtensionSettingScope } from '@malini/extension-api';

import type { ExtensionStateStorage } from '../../domain/extension-storage';

type StateEntry = {
	key: string;
	scope: ExtensionSettingScope;
	value: unknown;
};

type LegacyStateEnvelope = {
	version: 1;
	entries: StateEntry[];
};

type StateRecord = {
	version: 1;
	identity: string;
	deleted: boolean;
	value?: unknown;
};

const STORAGE_PREFIX = 'malini.extensions.state.v1';
type ProcessWriteFailure = Readonly<{
	error: Error;
	priorRecord?: string | null;
	priorLegacy?: string | null;
}>;
const PROCESS_WRITE_ERRORS = new WeakMap<object, Map<string, ProcessWriteFailure>>();
const PROCESS_WRITE_ERRORS_BY_RECORD_KEY = new Map<string, ProcessWriteFailure>();

export function extensionStateStorageKey(extensionId: string): string {
	const normalized = requiredText(extensionId, 'Extension ID');
	return `${STORAGE_PREFIX}:${encodeURIComponent(normalized)}`;
}

export function createDesktopExtensionState(input: {
	extensionId: string;
	storage?: ExtensionStateStorage | null;
}): ExtensionAPI['state'] {
	const legacyStorageKey = extensionStateStorageKey(input.extensionId);
	const probeKey = `${legacyStorageKey}:probe`;
	const memoryOnly = input.storage === null;
	const storage = input.storage === undefined ? browserStorage() : input.storage;
	const memoryRecords = new Map<string, StateRecord>();
	const readErrors = new Map<string, Error>();
	const writeFailures = new Map<string, ProcessWriteFailure>();
	const processWriteErrors = storage
		? processErrorsFor(storage)
		: new Map<string, ProcessWriteFailure>();
	let storageProbed = false;

	const requireWritableStorage = (): ExtensionStateStorage | null => {
		if (!storage) {
			if (memoryOnly) return null;
			throw new Error('Extension state storage is unavailable');
		}
		if (!storageProbed) {
			try {
				storage.setItem(probeKey, 'probe');
				storage.removeItem(probeKey);
				storageProbed = true;
			} catch (error) {
				throw new Error('Extension state storage is not writable', { cause: error });
			}
		}
		return storage;
	};

	const read = (key: string, scope: ExtensionSettingScope): unknown | null => {
		const identity = entryIdentity(key, scope);
		const recordKey = stateRecordStorageKey(legacyStorageKey, identity);
		const writeError =
			writeFailures.get(identity)?.error ??
			processWriteErrors.get(recordKey)?.error ??
			PROCESS_WRITE_ERRORS_BY_RECORD_KEY.get(recordKey)?.error;
		if (writeError) throw writeError;
		const durableStorage = requireWritableStorage();
		if (!durableStorage) {
			const record = memoryRecords.get(identity);
			readErrors.delete(identity);
			return record && !record.deleted ? cloneJson(record.value) : null;
		}

		try {
			if (durableStorage.getItem(transactionKey(recordKey)) !== null) {
				throw new Error('An extension state write did not complete');
			}
			const rawRecord = durableStorage.getItem(recordKey);
			if (rawRecord !== null) {
				const record = parseStateRecord(rawRecord, identity);
				readErrors.delete(identity);
				return record.deleted ? null : cloneJson(record.value);
			}

			const rawLegacy = durableStorage.getItem(legacyStorageKey);
			if (rawLegacy === null) {
				readErrors.delete(identity);
				return null;
			}
			const entry = parseLegacyEnvelope(rawLegacy).entries.find(
				(candidate) => entryIdentity(candidate.key, candidate.scope) === identity,
			);
			readErrors.delete(identity);
			return entry ? cloneJson(entry.value) : null;
		} catch (error) {
			const readError = new Error(
				'Extension state is unreadable; reset this entry before continuing',
				{
					cause: error,
				},
			);
			readErrors.set(identity, readError);
			throw readError;
		}
	};

	const write = (record: StateRecord): void => {
		const normalized: StateRecord = record.deleted
			? { version: 1, identity: record.identity, deleted: true }
			: {
					version: 1,
					identity: record.identity,
					deleted: false,
					value: cloneJson(record.value),
				};
		const identity = normalized.identity;
		const recordKey = stateRecordStorageKey(legacyStorageKey, identity);
		let durableStorage: ExtensionStateStorage | null;
		try {
			durableStorage = writableStorageWithoutProbe(storage, memoryOnly);
		} catch (error) {
			const storageError = new Error(
				'Extension state storage could not be acquired; reset this entry before continuing',
				{ cause: error },
			);
			const failure = { error: storageError } as const;
			writeFailures.set(identity, failure);
			PROCESS_WRITE_ERRORS_BY_RECORD_KEY.set(recordKey, failure);
			throw storageError;
		}
		if (!durableStorage) {
			memoryRecords.set(identity, normalized);
			readErrors.delete(identity);
			writeFailures.delete(identity);
			PROCESS_WRITE_ERRORS_BY_RECORD_KEY.delete(recordKey);
			return;
		}

		const pendingKey = transactionKey(recordKey);
		let priorRecord: string | null;
		let priorLegacy: string | null;
		try {
			priorRecord = durableStorage.getItem(recordKey);
			priorLegacy = durableStorage.getItem(legacyStorageKey);
		} catch (error) {
			const inspectionError = new Error(
				'Extension state could not inspect the durable record before writing',
				{ cause: error },
			);
			const failure = { error: inspectionError } as const;
			writeFailures.set(identity, failure);
			processWriteErrors.set(recordKey, failure);
			PROCESS_WRITE_ERRORS_BY_RECORD_KEY.set(recordKey, failure);
			throw inspectionError;
		}
		let markerError: unknown = null;
		let markerWritten = false;
		for (let attempt = 0; attempt < 2 && !markerWritten; attempt += 1) {
			try {
				durableStorage.setItem(pendingKey, 'pending');
				markerWritten = true;
			} catch (error) {
				markerError = error;
			}
		}
		if (!markerWritten) {
			for (let attempt = 0; attempt < 2; attempt += 1) {
				try {
					durableStorage.setItem(recordKey, '{"version":0,"writeFailed":true}');
					break;
				} catch {}
			}
			const error = new Error(
				'Extension state could not start a durable write; reset this entry before continuing',
				{ cause: markerError },
			);
			const failure = { error, priorRecord, priorLegacy } as const;
			writeFailures.set(identity, failure);
			processWriteErrors.set(recordKey, failure);
			PROCESS_WRITE_ERRORS_BY_RECORD_KEY.set(recordKey, failure);
			throw error;
		}

		try {
			durableStorage.setItem(recordKey, JSON.stringify(normalized));
			durableStorage.removeItem(pendingKey);
			readErrors.delete(identity);
			writeFailures.delete(identity);
			processWriteErrors.delete(recordKey);
			PROCESS_WRITE_ERRORS_BY_RECORD_KEY.delete(recordKey);
		} catch (error) {
			const persistenceError = new Error(
				'Extension state could not be persisted; reset this entry before continuing',
				{ cause: error },
			);
			const failure = { error: persistenceError, priorRecord, priorLegacy } as const;
			writeFailures.set(identity, failure);
			processWriteErrors.set(recordKey, failure);
			PROCESS_WRITE_ERRORS_BY_RECORD_KEY.set(recordKey, failure);
			throw persistenceError;
		}
	};

	const shouldWriteResetTombstone = (identity: string): boolean => {
		const recordKey = stateRecordStorageKey(legacyStorageKey, identity);
		const processWriteFailure =
			writeFailures.get(identity) ??
			processWriteErrors.get(recordKey) ??
			PROCESS_WRITE_ERRORS_BY_RECORD_KEY.get(recordKey);
		if (!readErrors.has(identity) && !writeFailures.has(identity) && !processWriteFailure) {
			return true;
		}
		const durableStorage = requireWritableStorage();
		if (!durableStorage) return true;
		if (durableStorage.getItem(transactionKey(recordKey)) !== null) return true;
		const rawRecord = durableStorage.getItem(recordKey);
		const rawLegacy = durableStorage.getItem(legacyStorageKey);
		const hasKnownPrior =
			processWriteFailure !== undefined &&
			Object.hasOwn(processWriteFailure, 'priorRecord') &&
			Object.hasOwn(processWriteFailure, 'priorLegacy');
		if (
			hasKnownPrior &&
			rawRecord === processWriteFailure.priorRecord &&
			rawLegacy === processWriteFailure.priorLegacy
		) {
			return true;
		}
		if (rawRecord !== null) {
			try {
				parseStateRecord(rawRecord, identity);
			} catch {
				return true;
			}
			if (!hasKnownPrior) {
				readErrors.delete(identity);
				writeFailures.delete(identity);
				processWriteErrors.delete(recordKey);
				PROCESS_WRITE_ERRORS_BY_RECORD_KEY.delete(recordKey);
				return false;
			}
			throw new Error('Extension state changed after this error; reload before resetting it');
		}
		if (rawLegacy === null) return true;
		let legacy: LegacyStateEnvelope;
		try {
			legacy = parseLegacyEnvelope(rawLegacy);
		} catch {
			return true;
		}
		if (!hasKnownPrior) {
			const entry = legacy.entries.find(
				(candidate) => entryIdentity(candidate.key, candidate.scope) === identity,
			);
			if (entry) {
				readErrors.delete(identity);
				writeFailures.delete(identity);
				processWriteErrors.delete(recordKey);
				PROCESS_WRITE_ERRORS_BY_RECORD_KEY.delete(recordKey);
				return false;
			}
			return true;
		}
		throw new Error('Extension state changed after this error; reload before resetting it');
	};

	return {
		get: async (key: string, scope: ExtensionSettingScope = { kind: 'global' }) => {
			const normalizedKey = requiredText(key, 'State key');
			const normalizedScope = normalizeScope(scope);
			return read(normalizedKey, normalizedScope);
		},
		set: async <T>(key: string, value: T, scope: ExtensionSettingScope = { kind: 'global' }) => {
			const normalizedKey = requiredText(key, 'State key');
			const normalizedScope = normalizeScope(scope);
			const identity = entryIdentity(normalizedKey, normalizedScope);
			write({
				version: 1,
				identity,
				deleted: false,
				value: cloneJson(value),
			});
		},
		delete: async (key: string, scope: ExtensionSettingScope = { kind: 'global' }) => {
			const normalizedKey = requiredText(key, 'State key');
			const normalizedScope = normalizeScope(scope);
			const identity = entryIdentity(normalizedKey, normalizedScope);
			if (!shouldWriteResetTombstone(identity)) return;
			write({ version: 1, identity, deleted: true });
		},
	};
}

function browserStorage(): ExtensionStateStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function writableStorageWithoutProbe(
	storage: ExtensionStateStorage | null,
	memoryOnly: boolean,
): ExtensionStateStorage | null {
	if (storage) return storage;
	if (memoryOnly) return null;
	throw new Error('Extension state storage is unavailable');
}

function processErrorsFor(storage: ExtensionStateStorage): Map<string, ProcessWriteFailure> {
	const identity: object = storage;
	let errors = PROCESS_WRITE_ERRORS.get(identity);
	if (!errors) {
		errors = new Map<string, ProcessWriteFailure>();
		PROCESS_WRITE_ERRORS.set(identity, errors);
	}
	return errors;
}

function stateRecordStorageKey(baseKey: string, identity: string): string {
	return `${baseKey}:entry:${encodeURIComponent(identity)}`;
}

function transactionKey(recordKey: string): string {
	return `${recordKey}:pending`;
}

function parseStateRecord(raw: string, expectedIdentity: string): StateRecord {
	const value: unknown = JSON.parse(raw);
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		value.identity !== expectedIdentity ||
		typeof value.deleted !== 'boolean'
	) {
		throw new Error('Malformed extension state record');
	}
	if (value.deleted) {
		return { version: 1, identity: expectedIdentity, deleted: true };
	}
	if (!Object.hasOwn(value, 'value')) throw new Error('Malformed extension state record');
	return {
		version: 1,
		identity: expectedIdentity,
		deleted: false,
		value: cloneJson(value.value),
	};
}

function parseLegacyEnvelope(raw: string): LegacyStateEnvelope {
	const value: unknown = JSON.parse(raw);
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) {
		throw new Error('Malformed extension state envelope');
	}
	const entries: StateEntry[] = [];
	const identities = new Set<string>();
	for (const candidate of value.entries) {
		if (!isRecord(candidate) || typeof candidate.key !== 'string' || !candidate.key.trim()) {
			throw new Error('Malformed extension state entry');
		}
		const scope = normalizeScope(candidate.scope);
		const identity = entryIdentity(candidate.key, scope);
		if (identities.has(identity)) throw new Error('Duplicate extension state entry');
		identities.add(identity);
		entries.push({ key: candidate.key, scope, value: cloneJson(candidate.value) });
	}
	return { version: 1, entries };
}

function cloneJson(value: unknown): unknown {
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(value);
	} catch (error) {
		throw new Error('Extension state values must be JSON serializable', { cause: error });
	}
	if (serialized === undefined) throw new Error('Extension state values must be JSON serializable');
	const cloned: unknown = JSON.parse(serialized);
	return cloned;
}

function normalizeScope(scope: unknown): ExtensionSettingScope {
	if (!isRecord(scope)) throw new Error('Invalid extension state scope');
	if (scope.kind === 'global') return { kind: 'global' };
	if (scope.kind === 'repository' || scope.kind === 'workstream') {
		return { kind: scope.kind, id: requiredText(scope.id, `${scope.kind} scope ID`) };
	}
	throw new Error('Invalid extension state scope');
}

function entryIdentity(key: string, scope: ExtensionSettingScope): string {
	return JSON.stringify([scope.kind, scope.kind === 'global' ? null : scope.id, key]);
}

function requiredText(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} cannot be empty`);
	return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
