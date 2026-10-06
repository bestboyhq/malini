export type ImagePreview =
	Readonly<{ status: 'ready'; src: string }> | Readonly<{ status: 'unavailable'; reason: string }>;

export function imagePreviewKey(owner: string, subject: string): string {
	return `${owner}\u0000${subject}`;
}

export function imagePreviewOwner(key: string): string {
	return key.slice(0, key.indexOf('\u0000'));
}
