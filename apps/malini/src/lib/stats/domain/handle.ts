const HANDLE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/u;

export function normalizedHandle(text: string): string {
	return text.trim().replace(/^@/u, '').toLowerCase();
}

export function handleProblem(handle: string): string | null {
	if (HANDLE.test(handle)) return null;
	return 'Use 1 to 39 letters, digits or single hyphens, without a hyphen at either end.';
}
