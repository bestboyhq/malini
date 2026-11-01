import type { JobRunRecord } from '$contract/jobs';
import {
	leadScopeLabel,
	parseLeadScope,
	projectsQuery,
	workstreamNameQuery,
} from '$shared/repositories/repositories.api';

export function jobPlace(run: JobRunRecord | null, workstreamId: string | null): string | null {
	const leadScope = parseLeadScope(run?.scope ?? null);
	return (
		(leadScope && leadScopeLabel(leadScope)) ??
		workstreamNameQuery.data(workstreamId ?? '') ??
		projectsQuery.data.find((project) => project.id === run?.repositoryId)?.name ??
		null
	);
}
