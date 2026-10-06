export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isObjectLike(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function errnoCode(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
	const code: unknown = error.code;
	return typeof code === 'string' ? code : undefined;
}

export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
	return values.some((entry) => entry === value);
}
