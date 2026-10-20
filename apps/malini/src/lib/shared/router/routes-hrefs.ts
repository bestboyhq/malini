export type WorkstreamHrefOptions = Readonly<{
	agentSessionId?: string | null;
	inspector?: string | null;
	extension?: string | null;
}>;

export const REPOSITORIES_HREF = '/';

export const JOBS_HREF = '/jobs';

export const NEW_JOB_HREF = '/jobs/new';

export const ROUTINES_HREF = '/jobs/routines';

export const MODEL_SETTINGS_HREF = '/settings/models';

export const SKILL_SETTINGS_HREF = '/settings/skills';

export function jobHref(definitionId: string): string {
	return `/jobs/${encodeURIComponent(definitionId)}`;
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
