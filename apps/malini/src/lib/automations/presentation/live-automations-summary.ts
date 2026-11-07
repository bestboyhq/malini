import { REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL } from '$contract/events';
import type {
	LiveAutomationCounts,
	LiveAutomation,
} from '$lib/automations/domain/live-automations';

export function liveAutomationsSummary(counts: LiveAutomationCounts): string {
	const parts = [
		counts.running > 0 ? `${counts.running} running` : null,
		counts.queued > 0 ? `${counts.queued} queued` : null,
		counts.needsYou > 0
			? `${counts.needsYou} ${counts.needsYou === 1 ? 'needs' : 'need'} you`
			: null,
	].filter((part) => part !== null);
	return parts.join(', ');
}

export function automationQuestionReason({ run, question }: LiveAutomation): string {
	if (run?.status === 'failed') return 'Failed';
	if (question?.channel === REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL) return 'Conflicts';
	if (run?.status === 'waiting') return 'Wants to run';
	return 'Asks you';
}
