type JobCenterCounts = Readonly<{
	running: number;
	queued: number;
	needsYou: number;
	finished: number;
}>;

export function jobCenterSummary(counts: JobCenterCounts): string {
	const parts = [
		counts.running > 0 ? `${counts.running} running` : null,
		counts.queued > 0 ? `${counts.queued} queued` : null,
		counts.needsYou > 0
			? `${counts.needsYou} ${counts.needsYou === 1 ? 'needs' : 'need'} you`
			: null,
	].filter((part) => part !== null);
	if (parts.length > 0) return parts.join(', ');
	if (counts.finished > 0) return `${counts.finished} finished recently`;
	return 'nothing running';
}
