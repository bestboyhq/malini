const EXTENSION_WORKSTREAM_RESERVATIONS_KEY = 'malini.chat.extension-workstream-reservations.v1';

type ReservationStorage = Pick<Storage, 'getItem' | 'setItem'>;

class ExtensionWorkstreamReservationsStorage {
	read(): Readonly<Record<string, string>> {
		const storage = requireStorage();
		let raw: string | null;
		try {
			raw = storage.getItem(EXTENSION_WORKSTREAM_RESERVATIONS_KEY);
		} catch (error) {
			throw new Error('Could not read extension workstream reservations', { cause: error });
		}
		if (raw === null) return {};
		return parseReservations(raw);
	}

	write(entries: Readonly<Record<string, string>>): void {
		const storage = requireStorage();
		try {
			storage.setItem(
				EXTENSION_WORKSTREAM_RESERVATIONS_KEY,
				JSON.stringify({ version: 1, entries }),
			);
		} catch (error) {
			throw new Error('Could not reserve the extension workstream safely', { cause: error });
		}
	}
}

export const extensionWorkstreamReservationsStorage = new ExtensionWorkstreamReservationsStorage();

function requireStorage(): ReservationStorage {
	const storage = browserStorage();
	if (!storage) throw new Error('Cannot safely reserve an idempotent extension workstream');
	return storage;
}

function browserStorage(): ReservationStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function parseReservations(raw: string): Readonly<Record<string, string>> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error('Extension workstream reservations are corrupted', { cause: error });
	}
	if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) {
		throw new Error('Extension workstream reservations are corrupted');
	}
	const entries: Record<string, string> = {};
	for (const [key, value] of Object.entries(parsed.entries)) {
		if (typeof value !== 'string' || !value.trim()) {
			throw new Error('Extension workstream reservations are corrupted');
		}
		entries[key] = value;
	}
	return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
