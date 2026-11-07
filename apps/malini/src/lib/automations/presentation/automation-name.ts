import { automationDefinitionByIdQuery } from '$lib/automations/application/queries/automation-definition-by-id.query.svelte';

export function automationName(reference: string): string {
	return automationDefinitionByIdQuery.data(reference)?.name ?? reference;
}
