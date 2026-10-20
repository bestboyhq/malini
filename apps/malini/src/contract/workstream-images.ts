export const WORKSTREAM_IMAGE_SCHEME = 'malini-image';

const WORKSTREAM_IMAGE_HOST = 'workstream';

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
