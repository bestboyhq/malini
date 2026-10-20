const BASE_DURATION_MS = 3000;
const MS_PER_CHARACTER = 50;
const MAX_DURATION_MS = 8000;

const PERSISTENT_REPLACEMENT_MS = 7 * 24 * 60 * 60 * 1000;

function readingDuration(message: string): number {
	return Math.min(BASE_DURATION_MS + message.length * MS_PER_CHARACTER, MAX_DURATION_MS);
}

export function toastDuration(
	message: string,
	ttlMs: number | null | undefined,
	replacing: boolean,
): number {
	const requested = ttlMs === undefined ? readingDuration(message) : (ttlMs ?? Infinity);
	return replacing && requested === Infinity ? PERSISTENT_REPLACEMENT_MS : requested;
}
