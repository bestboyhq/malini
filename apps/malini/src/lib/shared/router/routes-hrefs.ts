export type WorkstreamHrefOptions = Readonly<{
	agentSessionId?: string | null;
}>;

export const REPOSITORIES_HREF = '/';

export const JOBS_HREF = '/jobs';

export const JOBS_ACTIVITY_HREF = '/jobs/activity';

export const JOBS_RECIPES_HREF = '/jobs/recipes';

export const JOBS_EXPLORER_HREF = '/jobs/explorer';

export const EXTENSIONS_HREF = '/extensions';

export const EXTENSIONS_INSTALLED_HREF = '/extensions/installed';

export const EXTENSIONS_PUBLISHED_HREF = '/extensions/published';

export const SETTINGS_HREF = '/settings';

export const ACCOUNT_SETTINGS_HREF = '/settings/accounts';

export const MODEL_SETTINGS_HREF = '/settings/models';

export const SKILL_SETTINGS_HREF = '/settings/skills';

export const MCP_SETTINGS_HREF = '/settings/mcp-servers';

export function jobHref(definitionId: string): string {
	return `/jobs/${encodeURIComponent(definitionId)}`;
}

export function jobImproveHref(definitionId: string): string {
	return `${jobHref(definitionId)}/improve`;
}

export function extensionHref(publisher: string, name: string): string {
	return `${EXTENSIONS_HREF}/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}`;
}

export function repositoryHref(repositoryId: string): string {
	return `/repositories/${encodeURIComponent(repositoryId)}`;
}

export function workstreamHref(workstreamId: string, options: WorkstreamHrefOptions = {}): string {
	const path = `/workstreams/${encodeURIComponent(workstreamId)}`;
	const search = new URLSearchParams();
	if (options.agentSessionId) search.set('agent', options.agentSessionId);
	const query = search.toString();
	return query ? `${path}?${query}` : path;
}

export function workstreamIdFromPathname(pathname: string): string | null {
	const [, section, workstreamId] = pathname.split('/');
	if (section !== 'workstreams' || !workstreamId) return null;
	return workstreamId;
}
