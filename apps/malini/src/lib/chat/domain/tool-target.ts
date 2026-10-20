import { browserAddressLabel } from '$lib/browser/domain/browser-address';

export function toolTarget(input: Readonly<Record<string, unknown>>): string | null {
	const url = trimmed(input['url']);
	if (url) return browserAddressLabel(url);
	return trimmed(input['selector']);
}

function trimmed(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
