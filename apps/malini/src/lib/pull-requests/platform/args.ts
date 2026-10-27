export function field(args: unknown, key: string): unknown {
	return typeof args === 'object' && args !== null ? Reflect.get(args, key) : undefined;
}

export function requireString(args: unknown, key: string): string {
	const value = field(args, key);
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid args: \`${key}\` must be a non-empty string`);
	}
	return value;
}

export function requireStrings(args: unknown, key: string): string[] {
	const value = field(args, key);
	const items: readonly unknown[] = Array.isArray(value) ? value : [];
	const strings = items.filter(
		(item): item is string => typeof item === 'string' && item.length > 0,
	);
	if (strings.length === 0 || strings.length !== items.length) {
		throw new Error(`invalid args: \`${key}\` must be a non-empty list of non-empty strings`);
	}
	return strings;
}

export function optionalString(args: unknown, key: string): string | null {
	const value = field(args, key);
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string') {
		throw new Error(`invalid args: \`${key}\` must be a string when present`);
	}
	return value;
}

export function optionalNumber(args: unknown, key: string): number | null {
	const value = field(args, key);
	if (value === undefined || value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`invalid args: \`${key}\` must be a number when present`);
	}
	return value;
}

export function requireNumber(args: unknown, key: string): number {
	const value = optionalNumber(args, key);
	if (value === null) throw new Error(`invalid args: \`${key}\` must be a number`);
	return value;
}

export function optionalBoolean(args: unknown, key: string): boolean {
	return field(args, key) === true;
}

export type TextUpdate = Readonly<{ expected: string; next: string }>;

export function optionalTextUpdate(args: unknown, key: string): TextUpdate | null {
	const value = field(args, key);
	if (value === undefined || value === null) return null;
	const expected = field(value, 'expected');
	const next = field(value, 'next');
	if (typeof expected !== 'string' || typeof next !== 'string') {
		throw new Error(`invalid args: \`${key}\` must hold the expected and the next text`);
	}
	return { expected, next };
}
