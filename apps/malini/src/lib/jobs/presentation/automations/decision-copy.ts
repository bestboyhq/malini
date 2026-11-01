import type {
	ReconcilerCandidate,
	ReconcilerDecider,
	ReconcilerDecisionRecord,
	ReconcilerDecisionStatus,
} from '$contract/jobs';
import { JOB_RUN_STATUS, type JobRunStatusLook } from '../job-run-status';

export const DECISION_STATUS: Readonly<Record<ReconcilerDecisionStatus, JobRunStatusLook>> = {
	pending: { label: 'Waits for that chat', icon: 'clock', tone: 'text-fg-tertiary' },
	asking: { label: 'Asks you', icon: 'question', tone: 'text-brand-icon' },
	done: JOB_RUN_STATUS.succeeded,
	dismissed: { label: 'Dismissed', icon: 'circle-slash', tone: 'text-fg-tertiary' },
	failed: JOB_RUN_STATUS.failed,
};

export const DECIDERS: Readonly<Record<ReconcilerDecider, string>> = {
	model: 'Picked by the model',
	rules: "Picked by Malini's rules",
	you: 'Picked by you',
};

const EVENT_PREFIX = /^Event: /u;
const SENTENCE_END = /\.$/u;

export function decisionEvent(decision: ReconcilerDecisionRecord): string {
	const event = (decision.facts[0] ?? decision.channel)
		.replace(EVENT_PREFIX, '')
		.replace(SENTENCE_END, '');
	return `${event.charAt(0).toLocaleUpperCase()}${event.slice(1)}`;
}

export function decisionAction(decision: ReconcilerDecisionRecord): string {
	if (decision.status === 'failed') return 'Could not decide';
	return decision.candidates[decision.chosen]?.label ?? 'Do nothing';
}

export function decisionQuestion(decision: ReconcilerDecisionRecord): string {
	const chosen = decision.candidates[decision.chosen];
	return chosen?.kind === 'ask-you' ? chosen.reason : decisionEvent(decision);
}

export function decisionChoices(
	decision: ReconcilerDecisionRecord,
): readonly Readonly<{ index: number; candidate: ReconcilerCandidate }>[] {
	const choices = decision.candidates.flatMap((candidate, index) =>
		candidate.kind === 'ask-you' ? [] : [{ index, candidate }],
	);
	return ['run-job', 'wake-chat', 'nothing'].flatMap((kind) =>
		choices.filter(({ candidate }) => candidate.kind === kind),
	);
}
