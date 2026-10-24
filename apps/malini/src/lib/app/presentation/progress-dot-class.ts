import type { ProgressDot } from '$lib/app/domain/lead-progress';

export const PROGRESS_DOT_CLASS: Readonly<Record<ProgressDot, string>> = {
	merged: 'bg-merged-content',
	needs: 'bg-warning-content',
	failed: 'bg-error-content',
	running: 'bg-brand-icon animate-pulse motion-reduce:animate-none',
	idle: 'bg-status-idle',
};
