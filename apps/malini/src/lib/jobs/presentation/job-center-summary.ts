import type { JobCenterCounts } from '$lib/jobs/domain/job-center';

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
