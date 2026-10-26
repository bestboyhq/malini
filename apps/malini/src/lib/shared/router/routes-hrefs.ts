export type WorkstreamHrefOptions = Readonly<{
	agentSessionId?: string | null;
	inspector?: string | null;
	extension?: string | null;
}>;

export const REPOSITORIES_HREF = '/';

export const JOBS_HREF = '/jobs';

export const JOBS_ACTIVITY_HREF = '/jobs/activity';

export const JOBS_RECIPES_HREF = '/jobs/recipes';

export const JOBS_EXPLORER_HREF = '/jobs/explorer';

export const SETTINGS_HREF = '/settings';

export const MODEL_SETTINGS_HREF = '/settings/models';

export const SKILL_SETTINGS_HREF = '/settings/skills';

export const MCP_SETTINGS_HREF = '/settings/mcp-servers';

export function jobHref(definitionId: string): string {
	return `/jobs/${encodeURIComponent(definitionId)}`;
}

export function jobImproveHref(definitionId: string): string {
	return `${jobHref(definitionId)}/improve`;
}

export function repositoryHref(repositoryId: string): string {
	return `/repositories/${encodeURIComponent(repositoryId)}`;
}

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
