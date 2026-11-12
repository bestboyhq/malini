import type { WorkstreamChatTone } from '$lib/chat/domain/workstream-chat-summary';
import type { PullRequestPhase } from '$lib/pull-requests/domain/pull-request-state';

export type ProgressDot =
	'merged' | 'blocked' | 'needs' | 'failed' | 'running' | 'idle' | 'archived';

export type ProgressInput = Readonly<{
	merged: boolean;
	pullRequest: PullRequestPhase;
	needsYou: boolean;
	chatTone: WorkstreamChatTone | null;
	busy: boolean;
	broken: boolean;
}>;

export function progressDot(input: ProgressInput): ProgressDot {
	if (input.merged || input.pullRequest === 'merged') return 'merged';
	if (input.pullRequest === 'needs-you') return 'blocked';
	if (input.needsYou) return 'needs';
	if (input.broken || input.chatTone === 'failed') return 'failed';
	if (input.busy || input.pullRequest === 'queued') return 'running';
	return 'idle';
}

export function standingLabel(dot: ProgressDot, pullRequest: PullRequestPhase): string {
	if (dot === 'merged') return 'Merged';
	if (dot === 'blocked' || dot === 'needs') return 'Needs you';
	if (dot === 'failed') return 'Failed';
	if (dot === 'running') return pullRequest === 'queued' ? 'Merging' : 'Working';
	if (pullRequest === 'open') return 'In review';
	return pullRequest === 'draft' ? 'Draft' : 'Waiting';
}
