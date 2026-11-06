import { liveAutomationsQuery } from '$lib/automations/application/queries/live-automations.query.svelte';
import { liveAutomationCounts } from '$lib/automations/domain/live-automations';
import { liveAutomationsSummary } from './live-automations-summary';

export function liveAutomationsStatus(): { label: string; dot: 'needs' | 'running' | null } {
	const counts = liveAutomationCounts(liveAutomationsQuery.data);
	const summary = liveAutomationsSummary(counts);
	return {
		label: summary ? `Automations, ${summary}` : 'Automations',
		dot: counts.needsYou > 0 ? 'needs' : counts.running + counts.queued > 0 ? 'running' : null,
	};
}
