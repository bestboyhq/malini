import type { WorkstreamChatTone } from '$lib/chat/domain/workstream-chat-summary';
import type { PullRequestPhase } from '$lib/pull-requests/domain/pull-request-state';

export type ProgressDot = 'merged' | 'needs' | 'failed' | 'running' | 'idle';

export type ProgressInput = Readonly<{
	merged: boolean;
	pullRequest: PullRequestPhase;
	needsYou: boolean;
	chatTone: WorkstreamChatTone | null;
	busy: boolean;
	broken: boolean;
}>;

export type Progress = Readonly<Record<ProgressDot, number>>;

export function progressDot(input: ProgressInput): ProgressDot {
	if (input.merged || input.pullRequest === 'merged') return 'merged';
	if (input.needsYou || input.pullRequest === 'needs-you') return 'needs';
	if (input.broken || input.chatTone === 'failed') return 'failed';
	if (input.busy || input.pullRequest === 'queued') return 'running';
	return 'idle';
}

export function progressOf(dots: readonly ProgressDot[]): Progress {
	const count = (dot: ProgressDot): number => dots.filter((entry) => entry === dot).length;
	return {
		merged: count('merged'),
		needs: count('needs'),
		failed: count('failed'),
		running: count('running'),
		idle: count('idle'),
	};
}

export function progressLabel(dots: readonly ProgressDot[]): string {
	const progress = progressOf(dots);
	const parts = [
		progress.merged > 0 ? `${progress.merged} merged` : null,
		progress.needs > 0 ? `${progress.needs} ${progress.needs === 1 ? 'needs' : 'need'} you` : null,
		progress.failed > 0 ? `${progress.failed} failed` : null,
		progress.running > 0 ? `${progress.running} working` : null,
		progress.idle > 0 ? `${progress.idle} waiting` : null,
	].filter((part): part is string => part !== null);
	const total = `${dots.length} ${dots.length === 1 ? 'workstream' : 'workstreams'}`;
	return parts.length > 0 ? `${total}: ${parts.join(', ')}` : total;
}
