export const WORKSTREAM_IMAGE_SCHEME = 'malini-image';

const WORKSTREAM_IMAGE_HOST = 'workstream';
const VIDEO_PATH = /\.(?:mp4|m4v|mov|webm)$/iu;
const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp)$/iu;
const NOT_A_WORKSTREAM_FILE = /^(?:[a-z][a-z\d+.-]*:|\/\/|[#?])/iu;

export type MediaKind = 'image' | 'video' | 'page';

export const CONTEXT_MEDIA_CATEGORIES = [
	'images',
	'videos',
	'audio',
	'pages',
	'documents',
] as const;

export type ContextMediaCategory = (typeof CONTEXT_MEDIA_CATEGORIES)[number];

export type ContextMedia = Readonly<{
	path: string;
	size: number;
	modifiedAt: string;
	category: ContextMediaCategory;
}>;

const CATEGORY_PATHS: ReadonlyArray<readonly [ContextMediaCategory, RegExp]> = [
	['images', IMAGE_PATH],
	['images', /\.svg$/iu],
	['videos', VIDEO_PATH],
	['audio', /\.(?:mp3|m4a|wav|ogg|oga|flac|aac)$/iu],
	['pages', /\.html?$/iu],
	['documents', /\.(?:pdf|md|markdown|txt|csv|json)$/iu],
];

export function contextMediaCategory(path: string): ContextMediaCategory | null {
	return CATEGORY_PATHS.find(([, pattern]) => pattern.test(path))?.[0] ?? null;
}

export function workstreamImageUrl(workstreamId: string, path: string, version: number): string {
	return `${WORKSTREAM_IMAGE_SCHEME}://${WORKSTREAM_IMAGE_HOST}/${encodeURIComponent(workstreamId)}/${encodeURIComponent(path)}?v=${version}`;
}

export function parseWorkstreamImageUrl(
	url: string,
): Readonly<{ workstreamId: string; path: string }> | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== `${WORKSTREAM_IMAGE_SCHEME}:`) return null;
	if (parsed.hostname !== WORKSTREAM_IMAGE_HOST) return null;
	const [, workstreamId, path, ...rest] = parsed.pathname.split('/');
	if (workstreamId === undefined || path === undefined || rest.length > 0) return null;
	try {
		return { workstreamId: decodeURIComponent(workstreamId), path: decodeURIComponent(path) };
	} catch {
		return null;
	}
}

export function workstreamImagePath(src: string): string | null {
	if (src.length === 0 || NOT_A_WORKSTREAM_FILE.test(src)) return null;
	try {
		return decodeURI(mediaPath(src));
	} catch {
		return mediaPath(src);
	}
}

export function isVideoPath(src: string): boolean {
	return VIDEO_PATH.test(mediaPath(src));
}

export function mediaKind(src: string): MediaKind {
	if (isVideoPath(src)) return 'video';
	const path = mediaPath(src);
	return IMAGE_PATH.test(path) || NOT_A_WORKSTREAM_FILE.test(path) ? 'image' : 'page';
}

export function mediaPath(src: string): string {
	const hash = src.indexOf('#');
	return hash === -1 ? src : src.slice(0, hash);
}
