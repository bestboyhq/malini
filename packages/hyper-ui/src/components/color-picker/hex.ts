export function normalizeHex(input: string): string {
	const cleaned = input.replace(/[^#0-9a-fA-F]/gu, '');
	if (cleaned.startsWith('#')) {
		return cleaned.slice(0, 7).toUpperCase();
	}
	return `#${cleaned.slice(0, 6)}`.toUpperCase();
}

export function isValidHex(input: string): boolean {
	return /^#[0-9a-fA-F]{6}$/u.test(input);
}
