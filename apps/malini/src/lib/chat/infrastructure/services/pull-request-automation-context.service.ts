import {
	AUTOMATION_INPUT_STRING_LIMIT,
	type PullRequestActionInput,
	type PullRequestAutomationEvent,
} from '@malini-extension/repository';
import type { AgentEvent } from '$lib/chat/domain/events';
import type { SessionRecord } from '$lib/chat/domain/session-record';

const EVIDENCE_LIMITS = Object.freeze({
	runSummaries: 6,
	validationEvents: 12,
	changedPaths: 32,
});

const TRAILING_COMMIT_LINE =
	/^[\s\S]*(?:^|\s)Commit:\s*(.+?)(?:\s+(?:Pull request|Resolved):.*)?\s*$/u;
const TRAILING_PULL_REQUEST_LINE =
	/^[\s\S]*(?:^|\s)Pull request:\s*(.+?)(?:\s+(?:Commit|Resolved):.*)?\s*$/u;

type PullRequestAutomationEvidenceInput = Readonly<{
	workstreamId: string;
	requestedSessionId: string | null;
	sessions: readonly SessionRecord[];
	eventsFor(sessionId: string): readonly AgentEvent[];
}>;

export function pullRequestAutomationEvidence(
	input: PullRequestAutomationEvidenceInput,
): PullRequestActionInput {
	const session = selectSession(input);
	if (!session) return {};
	const events = input.eventsFor(session.id);
	const lastUserIntent = [...events].reverse().find((event) => event.type === 'user.message')?.text;
	const completedRuns = events
		.filter(
			(event): event is Extract<AgentEvent, { type: 'run.completed' }> =>
				event.type === 'run.completed',
		)
		.map(({ runId, summary }) => ({
			runId,
			summary: bounded(commitLineOrSummary(summary)),
			pullRequestTitle: bounded(TRAILING_PULL_REQUEST_LINE.exec(summary)?.[1] ?? ''),
		}))
		.filter(({ summary }) => summary);
	const runSummaries = takeLastUnique(
		completedRuns.map(({ summary }) => summary),
		EVIDENCE_LIMITS.runSummaries,
	);
	const latestRunId = completedRuns.at(-1)?.runId;
	const pullRequestTitle = completedRuns
		.filter((run) => run.pullRequestTitle)
		.at(-1)?.pullRequestTitle;
	const validationEvents = takeLastUnique(
		events
			.filter(
				(event): event is Extract<AgentEvent, { type: 'command.completed' }> =>
					event.type === 'command.completed' &&
					event.exitCode === 0 &&
					isValidationCommand(event.command),
			)
			.map(({ command }) => bounded(command.trim()))
			.filter(Boolean),
		EVIDENCE_LIMITS.validationEvents,
	).map((label): PullRequestAutomationEvent => ({
		kind: 'validation',
		label,
		status: 'passed',
	}));
	const changedPaths = uniqueSorted(
		events
			.filter(
				(event): event is Extract<AgentEvent, { type: 'file.changed' }> =>
					event.type === 'file.changed',
			)
			.map(({ path }) => path.trim())
			.filter(Boolean),
	).slice(0, EVIDENCE_LIMITS.changedPaths);

	return {
		context: {
			sessionTitle: bounded(session.displayName),
			...(lastUserIntent?.trim() ? { lastUserIntent: bounded(lastUserIntent.trim()) } : {}),
			...(runSummaries.length > 0 ? { runSummaries } : {}),
			...(latestRunId ? { latestRunId } : {}),
			...(pullRequestTitle ? { pullRequestTitle } : {}),
			...(validationEvents.length > 0 ? { events: validationEvents } : {}),
		},
		...(changedPaths.length > 0 ? { changedPaths } : {}),
	};
}

function bounded(text: string): string {
	return Array.from(text).slice(0, AUTOMATION_INPUT_STRING_LIMIT).join('');
}

function commitLineOrSummary(summary: string): string {
	const commitLine = TRAILING_COMMIT_LINE.exec(summary)?.[1];
	if (commitLine) return commitLine;
	const trimmed = summary.trim();
	return describesTheChange(trimmed) ? trimmed : '';
}

const DESCRIPTIVE_SUMMARY_MIN_WORDS = 3;

// ponytail: fixed English acknowledgement list; extend it when a bare reply slips through.
const ACKNOWLEDGEMENT_WORDS = new Set([
	'a',
	'all',
	'an',
	'and',
	'as',
	'asked',
	'been',
	'change',
	'changes',
	'complete',
	'completed',
	'done',
	'everything',
	'finished',
	'fixed',
	'for',
	'good',
	'great',
	'has',
	'have',
	'here',
	'i',
	"i'm",
	"i've",
	'is',
	'it',
	"it's",
	'job',
	'made',
	'now',
	'ok',
	'okay',
	'ready',
	'request',
	'requested',
	'set',
	'so',
	'success',
	'successfully',
	'sure',
	'task',
	'that',
	"that's",
	'the',
	'this',
	'we',
	"we've",
	'work',
	'yes',
	'you',
]);

function describesTheChange(summary: string): boolean {
	const firstSentence = summary.split(/(?<=[.!?])\s+/u)[0] ?? '';
	const words =
		firstSentence
			.toLocaleLowerCase()
			.replaceAll('’', "'")
			.match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? [];
	return (
		words.length >= DESCRIPTIVE_SUMMARY_MIN_WORDS &&
		words.some((word) => !ACKNOWLEDGEMENT_WORDS.has(word))
	);
}

function selectSession(input: PullRequestAutomationEvidenceInput): SessionRecord | null {
	const requested = input.requestedSessionId
		? input.sessions.find(({ id }) => id === input.requestedSessionId)
		: null;
	if (requested?.workstreamId === input.workstreamId) return requested;
	return (
		input.sessions
			.filter(({ workstreamId }) => workstreamId === input.workstreamId)
			.sort((left, right) => {
				const byStartedAt = right.startedAt.localeCompare(left.startedAt);
				return byStartedAt !== 0 ? byStartedAt : right.id.localeCompare(left.id);
			})[0] ?? null
	);
}

function isValidationCommand(command: string): boolean {
	return /(?:^|\s|[/\\])(?:test|check|lint|typecheck|svelte-check|tsc|vitest|jest|playwright|pytest|clippy|fmt|format|build)(?:$|\s|:)/iu.test(
		command,
	);
}

function takeLastUnique(values: readonly string[], limit: number): readonly string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (let index = values.length - 1; index >= 0 && result.length < limit; index -= 1) {
		const value = values[index];
		if (!value || seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result.reverse();
}

function uniqueSorted(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
