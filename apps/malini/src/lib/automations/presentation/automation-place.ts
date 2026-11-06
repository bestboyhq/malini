import type { AutomationRunRecord } from '$contract/automations';
import {
	leadScopeLabel,
	parseLeadScope,
	projectFullName,
	projectsQuery,
	workstreamNameQuery,
} from '$shared/repositories/repositories.api';

export function automationPlace(
	run: AutomationRunRecord | null,
	workstreamId: string | null,
): string | null {
	const leadScope = parseLeadScope(run?.scope ?? null);
	const project = projectsQuery.data.find(({ id }) => id === run?.repositoryId);
	return (
		(leadScope && leadScopeLabel(leadScope)) ??
		workstreamNameQuery.data(workstreamId ?? '') ??
		(project && projectFullName(project)) ??
		null
	);
}
