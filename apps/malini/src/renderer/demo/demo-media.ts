const MEDIA = import.meta.glob<string>('./media/*.{webp,mp4}', {
	eager: true,
	query: '?url',
	import: 'default',
});

export function demoMediaUrl(path: string): string | null {
	return MEDIA[`./media/${path.split('/').pop() ?? ''}`] ?? null;
}
