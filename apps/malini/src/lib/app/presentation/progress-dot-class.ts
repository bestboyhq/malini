import type { ProgressDot } from '$lib/app/domain/lead-progress';

export const PROGRESS_DOT_CLASS: Readonly<Record<ProgressDot, string>> = {
	merged: 'bg-merged-content',
	blocked: 'bg-warning-content',
	needs: 'bg-brand-icon',
	failed: 'bg-error-content',
	running: 'text-fg-secondary bg-current animate-pulse motion-reduce:animate-none',
	idle: 'bg-status-idle',
	archived: 'border border-status-idle',
};
