export function field(args: unknown, key: string): unknown {
	return typeof args === 'object' && args !== null ? Reflect.get(args, key) : undefined;
}

export function requireString(args: unknown, key: string): string {
	const value = field(args, key);
	if (typeof value !== 'string') throw new Error(`invalid args: \`${key}\` must be a string`);
	return value;
}

export function requireNonEmptyString(args: unknown, key: string): string {
	const value = field(args, key);
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid args: \`${key}\` must be a non-empty string`);
	}
	return value;
}

export function optionalString(args: unknown, key: string): string | null {
	const value = field(args, key);
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string') {
		throw new Error(`invalid args: \`${key}\` must be a string when present`);
	}
	return value;
}
