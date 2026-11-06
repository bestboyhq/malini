export type WorkstreamHrefOptions = Readonly<{
	agentSessionId?: string | null;
}>;

export const REPOSITORIES_HREF = '/';

export const AUTOMATIONS_HREF = '/automations';

export const AUTOMATIONS_ACTIVITY_HREF = '/automations/activity';

export const AUTOMATIONS_RECIPES_HREF = '/automations/recipes';

export const AUTOMATIONS_EXPLORER_HREF = '/automations/explorer';

export const SETTINGS_HREF = '/settings';

export const ACCOUNT_SETTINGS_HREF = '/settings/accounts';

export const PROVIDER_SETTINGS_HREF = '/settings/providers';

export const MODEL_SETTINGS_HREF = '/settings/models';

export const SKILL_SETTINGS_HREF = '/settings/skills';

export const MCP_SETTINGS_HREF = '/settings/mcp-servers';

export const EXTENSION_SETTINGS_HREF = '/settings/extensions';

export const PROFILE_SETTINGS_HREF = '/settings/profile';

export function automationHref(definitionId: string): string {
	return `/automations/${encodeURIComponent(definitionId)}`;
}

export function automationImproveHref(definitionId: string): string {
	return `${automationHref(definitionId)}/improve`;
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
