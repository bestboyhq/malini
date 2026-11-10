import type { AutomationRunRecord } from '$contract/automations';
import {
	projectFullName,
	projectsQuery,
	workstreamNameQuery,
} from '$shared/repositories/repositories.api';

export function automationPlace(
	run: AutomationRunRecord | null,
	workstreamId: string | null,
): string | null {
	const project = projectsQuery.data.find(({ id }) => id === run?.repositoryId);
	return (
		workstreamNameQuery.data(workstreamId ?? '') ?? (project && projectFullName(project)) ?? null
	);
}
