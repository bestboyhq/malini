export type WorkstreamHrefOptions = Readonly<{
	agentSessionId?: string | null;
	inspector?: string | null;
	extension?: string | null;
}>;

export const REPOSITORIES_HREF = '/';

export function workstreamHref(workstreamId: string, options: WorkstreamHrefOptions = {}): string {
	const path = `/workstreams/${encodeURIComponent(workstreamId)}`;
	const search = new URLSearchParams();
	if (options.agentSessionId) search.set('agent', options.agentSessionId);
	if (options.inspector) search.set('inspector', options.inspector);
	if (options.extension) search.set('extension', options.extension);
	const query = search.toString();
	return query ? `${path}?${query}` : path;
}

export function workstreamIdFromPathname(pathname: string): string | null {
	const [, section, workstreamId] = pathname.split('/');
	if (section !== 'workstreams' || !workstreamId) return null;
	return workstreamId;
}
