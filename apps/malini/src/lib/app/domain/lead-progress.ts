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

export type Progress = Readonly<Record<ProgressDot, number>>;

export function progressDot(input: ProgressInput): ProgressDot {
	if (input.merged || input.pullRequest === 'merged') return 'merged';
	if (input.pullRequest === 'needs-you') return 'blocked';
	if (input.needsYou) return 'needs';
	if (input.broken || input.chatTone === 'failed') return 'failed';
	if (input.busy || input.pullRequest === 'queued') return 'running';
	return 'idle';
}

const PRESSING_DOTS: readonly ProgressDot[] = ['blocked', 'needs', 'failed', 'running'];

export function treeDot(lead: ProgressDot, started: readonly ProgressDot[]): ProgressDot {
	return PRESSING_DOTS.find((dot) => dot === lead || started.includes(dot)) ?? lead;
}

export function progressOf(dots: readonly ProgressDot[]): Progress {
	const count = (dot: ProgressDot): number => dots.filter((entry) => entry === dot).length;
	return {
		merged: count('merged'),
		blocked: count('blocked'),
		needs: count('needs'),
		failed: count('failed'),
		running: count('running'),
		idle: count('idle'),
		archived: count('archived'),
	};
}

export function progressLabel(dots: readonly ProgressDot[]): string {
	const progress = progressOf(dots);
	const parts = [
		progress.merged > 0 ? `${progress.merged} merged` : null,
		progress.blocked + progress.needs > 0 ? needYou(progress.blocked + progress.needs) : null,
		progress.failed > 0 ? `${progress.failed} failed` : null,
		progress.running > 0 ? `${progress.running} working` : null,
		progress.idle > 0 ? `${progress.idle} waiting` : null,
		progress.archived > 0 ? `${progress.archived} archived` : null,
	].filter((part): part is string => part !== null);
	const total = `${dots.length} ${dots.length === 1 ? 'workstream' : 'workstreams'}`;
	return parts.length > 0 ? `${total}: ${parts.join(', ')}` : total;
}

export type LeadHeadline = Readonly<{
	tone: 'idle' | 'asks' | 'needs-you' | 'merged';
	busy: boolean;
	label: string;
	detail: string | null;
}>;

export function leadHeadline(dots: readonly ProgressDot[], cleared = 0): LeadHeadline {
	if (dots.length === 0) {
		return cleared > 0
			? { tone: 'merged', busy: false, label: 'All merged', detail: null }
			: { tone: 'idle', busy: false, label: 'No workstreams yet', detail: null };
	}
	const progress = progressOf(dots);
	const detail = [
		progress.blocked + progress.needs > 0 ? needYou(progress.blocked + progress.needs) : null,
		progress.failed > 0 ? `${progress.failed} failed` : null,
		progress.running > 0 ? `${progress.running} working` : null,
	].filter((part): part is string => part !== null);
	return {
		tone: headlineTone(progress, dots.length),
		busy: progress.running > 0,
		label: `${progress.merged} of ${dots.length} merged`,
		detail: detail.length > 0 ? detail.join(' · ') : null,
	};
}

export type ShipCandidate = Readonly<{
	id: string;
	pullRequest: PullRequestPhase;
	changed: boolean;
	working: boolean;
	shipping: boolean;
}>;

export type ShipTargets = Readonly<{ draft: readonly string[]; merge: readonly string[] }>;

const UNSHIPPED: ReadonlySet<PullRequestPhase> = new Set(['none', 'unknown']);

const MERGEABLE: ReadonlySet<PullRequestPhase> = new Set(['none', 'unknown', 'draft', 'open']);

export function shipTargets(candidates: readonly ShipCandidate[]): ShipTargets {
	const ready = candidates.filter(
		(candidate) =>
			!candidate.shipping &&
			(candidate.changed || candidate.working || !UNSHIPPED.has(candidate.pullRequest)),
	);
	const idsIn = (phases: ReadonlySet<PullRequestPhase>): string[] =>
		ready.filter((candidate) => phases.has(candidate.pullRequest)).map(({ id }) => id);
	return { draft: idsIn(UNSHIPPED), merge: idsIn(MERGEABLE) };
}

export function standingLabel(dot: ProgressDot, pullRequest: PullRequestPhase): string {
	if (dot === 'merged') return 'Merged';
	if (dot === 'blocked' || dot === 'needs') return 'Needs you';
	if (dot === 'failed') return 'Failed';
	if (dot === 'running') return pullRequest === 'queued' ? 'Merging' : 'Working';
	if (pullRequest === 'open') return 'In review';
	return pullRequest === 'draft' ? 'Draft' : 'Waiting';
}

function headlineTone(progress: Progress, total: number): LeadHeadline['tone'] {
	if (progress.blocked + progress.failed > 0) return 'needs-you';
	if (progress.needs > 0) return 'asks';
	return progress.merged === total ? 'merged' : 'idle';
}

function needYou(count: number): string {
	return `${count} ${count === 1 ? 'needs' : 'need'} you`;
}
