import { REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL } from '$contract/events';
import type { JobCenterCounts, JobCenterEntry } from '$lib/jobs/domain/job-center';

export function jobCenterSummary(counts: JobCenterCounts): string {
	const parts = [
		counts.running > 0 ? `${counts.running} running` : null,
		counts.queued > 0 ? `${counts.queued} queued` : null,
		counts.needsYou > 0
			? `${counts.needsYou} ${counts.needsYou === 1 ? 'needs' : 'need'} you`
			: null,
	].filter((part) => part !== null);
	return parts.length > 0 ? parts.join(', ') : 'ready when you are';
}

export function jobQuestionReason({ run, question }: JobCenterEntry): string {
	if (run?.status === 'failed') return 'Failed';
	if (question?.channel === REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL) return 'Conflicts';
	if (run?.status === 'waiting') return 'Wants to run';
	return 'Asks you';
}
