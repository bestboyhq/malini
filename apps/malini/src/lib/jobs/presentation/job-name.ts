import { jobDefinitionByIdQuery } from '$lib/jobs/application/queries/job-definition-by-id.query.svelte';

export function jobName(reference: string): string {
	return jobDefinitionByIdQuery.data(reference)?.name ?? reference;
}
