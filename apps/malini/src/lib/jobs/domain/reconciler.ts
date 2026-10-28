import {
	APP_STARTED_CHANNEL,
	APP_UPDATED_CHANNEL,
	CHAT_TURN_FINISHED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
	JOBS_TIME_REACHED_CHANNEL,
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
	PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
	type EventChannel,
} from '$contract/events';
import type {
	ReconcilerCandidate,
	ReconcilerDecider,
	ReconcilerDecisionRecord,
} from '$contract/jobs';

export const RECONCILER_RULES = [
	'triggers',
	'thens',
	'shipping',
	'resume',
	'deliveries',
	'schedules',
	'compatibility',
	'model',
] as const;

export type ReconcilerRule = (typeof RECONCILER_RULES)[number];

export const RULE_EVENTS: Readonly<Record<ReconcilerRule, readonly EventChannel[] | 'every'>> = {
	triggers: 'every',
	thens: [JOBS_RUN_FINISHED_CHANNEL],
	shipping: [
		PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
		PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
		CHAT_TURN_FINISHED_CHANNEL,
		JOBS_RUN_FINISHED_CHANNEL,
		JOBS_TIME_REACHED_CHANNEL,
		REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
		REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
		REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
		APP_STARTED_CHANNEL,
	],
	resume: [APP_STARTED_CHANNEL, JOBS_TIME_REACHED_CHANNEL],
	deliveries: [CHAT_TURN_FINISHED_CHANNEL],
	schedules: [JOBS_TIME_REACHED_CHANNEL],
	compatibility: [APP_UPDATED_CHANNEL],
	model: [JOBS_RUN_FINISHED_CHANNEL, REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL],
};

export function ruleHears(rule: ReconcilerRule, channel: EventChannel): boolean {
	const heard = RULE_EVENTS[rule];
	return heard === 'every' || heard.includes(channel);
}

export const RECONCILER_WAKE_LIMIT = 3;

export type ChatWake = Readonly<{
	sessionId: string;
	prompt: string;
	fromWorkstreamId: string | null;
	chainId: string;
	causeEventId: number;
}>;

const REPORT_DETAIL_CHARS = 600;

export type ReconcilerChat = Readonly<{
	sessionId: string;
	workstreamId: string;
	chatName: string;
	workstreamName: string;
	working: boolean;
	lastOutcome: string | null;
	lastNeeds: string | null;
}>;

export type JobRunSituation = Readonly<{
	kind: 'job-run';
	title: string;
	status: 'succeeded' | 'failed';
	detail: string | null;
	workstreamId: string | null;
	workstreamName: string | null;
	chat: ReconcilerChat | null;
	retry: Readonly<{ definitionId: string; workstreamId: string; context: string }> | null;
	runsInChain: number;
	wakes: number;
}>;

export type ConflictSituation = Readonly<{
	kind: 'conflict';
	workstreamId: string;
	workstreamName: string;
	conflictedPaths: readonly string[];
	resolverId: string | null;
	chat: ReconcilerChat | null;
	wakes: number;
}>;

export type ReconcilerSituation = JobRunSituation | ConflictSituation;

export type ReconcilerQuestion = Readonly<{
	facts: readonly string[];
	candidates: readonly ReconcilerCandidate[];
}>;

const NOTHING: ReconcilerCandidate = { kind: 'nothing', label: 'Do nothing' };

export function reconcilerQuestion(situation: ReconcilerSituation): ReconcilerQuestion | null {
	const candidates = [NOTHING, ...actions(situation)];
	if (candidates.length < 2) return null;
	return { facts: facts(situation), candidates };
}

function actions(situation: ReconcilerSituation): ReconcilerCandidate[] {
	switch (situation.kind) {
		case 'job-run':
			return jobRunActions(situation);
		case 'conflict':
			return conflictActions(situation);
	}
}

function jobRunActions(situation: JobRunSituation): ReconcilerCandidate[] {
	const { chat, retry, status, title } = situation;
	const verb = status === 'failed' ? 'failed' : 'finished';
	return [
		...(chat
			? [
					wake(
						chat,
						situation.workstreamId ?? chat.workstreamId,
						`Tell “${chat.chatName}” that ${title} ${verb}`,
						jobReport(situation),
					),
				]
			: []),
		...(status === 'failed' && retry
			? [
					{
						kind: 'run-job' as const,
						label: `Run ${title} again`,
						definitionId: retry.definitionId,
						workstreamId: retry.workstreamId,
						context: retry.context,
					},
				]
			: []),
		...(status === 'failed'
			? [
					ask(
						`${title} failed${situation.workstreamName ? ` in ${situation.workstreamName}` : ''}.`,
					),
				]
			: []),
	];
}

function conflictActions(situation: ConflictSituation): ReconcilerCandidate[] {
	const { chat, resolverId, workstreamId, workstreamName, conflictedPaths } = situation;
	const files = `${conflictedPaths.length} ${conflictedPaths.length === 1 ? 'file' : 'files'}`;
	return [
		...(resolverId
			? [
					{
						kind: 'run-job' as const,
						label: 'Run Resolve conflicts',
						definitionId: resolverId,
						workstreamId,
						context: `The merge stopped on conflicts in: ${conflictedPaths.join(', ')}`,
					},
				]
			: []),
		...(chat
			? [
					wake(
						chat,
						workstreamId,
						`Tell “${chat.chatName}” about the conflicts`,
						`A merge in “${workstreamName}” stopped on conflicts in ${files}: ${conflictedPaths.join(', ')}.`,
					),
				]
			: []),
		ask(`A merge in ${workstreamName} stopped on conflicts in ${files}.`),
	];
}

function wake(
	chat: ReconcilerChat,
	from: string,
	label: string,
	report: string,
): ReconcilerCandidate {
	return {
		kind: 'wake-chat',
		label,
		sessionId: chat.sessionId,
		workstreamId: chat.workstreamId,
		from,
		report,
	};
}

function ask(reason: string): ReconcilerCandidate {
	return { kind: 'ask-you', label: 'Ask you', reason };
}

function jobReport(situation: JobRunSituation): string {
	const where = situation.workstreamName ? ` in “${situation.workstreamName}”` : '';
	const head = `${situation.title}, the job you ran${where}, ${situation.status === 'failed' ? 'failed' : 'finished'}.`;
	const detail = situation.detail?.trim().slice(0, REPORT_DETAIL_CHARS);
	return detail ? `${head}\n\n${detail}` : head;
}

function facts(situation: ReconcilerSituation): string[] {
	switch (situation.kind) {
		case 'job-run':
			return [
				`Event: the job ${situation.title}${situation.workstreamName ? ` in “${situation.workstreamName}”` : ''} ${situation.status}.`,
				...(situation.detail ? [`Its result: ${oneLine(situation.detail)}`] : []),
				...(situation.chat
					? [`The chat “${situation.chat.chatName}” ran it.`, chatState(situation.chat)]
					: ['No chat ran it.']),
				`It ran ${situation.runsInChain} ${situation.runsInChain === 1 ? 'time' : 'times'} in this chain of events.`,
				...wakeFacts(situation.chat, situation.wakes),
			];
		case 'conflict':
			return [
				`Event: a merge in “${situation.workstreamName}” stopped on conflicts in ${situation.conflictedPaths.length} ${situation.conflictedPaths.length === 1 ? 'file' : 'files'}.`,
				`Conflicted: ${situation.conflictedPaths.slice(0, 8).join(', ')}`,
				...(situation.chat
					? [`Its chat is “${situation.chat.chatName}”.`, chatState(situation.chat)]
					: ['No chat works in it.']),
				...wakeFacts(situation.chat, situation.wakes),
			];
	}
}

function chatState(chat: ReconcilerChat): string {
	if (chat.working) return `“${chat.chatName}” is working now.`;
	if (chat.lastOutcome === null) return `“${chat.chatName}” is idle.`;
	return `“${chat.chatName}” is idle; its last turn ended with Outcome: ${oneLine(chat.lastOutcome)}, Needs: ${chat.lastNeeds === null ? 'nothing' : oneLine(chat.lastNeeds)}.`;
}

function wakeFacts(chat: ReconcilerChat | null, wakes: number): string[] {
	if (chat === null) return [];
	return [
		`Malini woke “${chat.chatName}” about this work ${wakes} of ${RECONCILER_WAKE_LIMIT} times in this chain of events.`,
	];
}

function oneLine(text: string): string {
	return text.replaceAll(/\s+/gu, ' ').trim().slice(0, REPORT_DETAIL_CHARS);
}

export function reconcilerPrompt(question: ReconcilerQuestion): string {
	return [
		...question.facts,
		'',
		'Candidates:',
		...question.candidates.map((candidate, index) => `${index + 1}. ${candidate.label}`),
	].join('\n');
}

const CANDIDATE_LINE = /^(\d+)\. (.+)$/u;

export function promptCandidates(prompt: string): string[] {
	const lines = prompt.split('\n');
	const start = lines.lastIndexOf('Candidates:');
	if (start === -1) return [];
	return lines.slice(start + 1).flatMap((line, index) => {
		const match = CANDIDATE_LINE.exec(line);
		return match && Number(match[1]) === index + 1 && match[2] ? [match[2]] : [];
	});
}

export function pickOutput(labels: readonly string[], pick: number): string {
	return `${pick}. ${labels[pick - 1] ?? ''}`.trim();
}

export function outputPick(output: string | null): number | null {
	const match = /^(\d+)\./u.exec(output?.trim() ?? '');
	return match ? Number(match[1]) : null;
}

export type ValidatedPick = Readonly<{
	candidates: readonly ReconcilerCandidate[];
	chosen: number;
	decidedBy: ReconcilerDecider;
	detail: string | null;
}>;

export function validatePick(
	candidates: readonly ReconcilerCandidate[],
	pick: number | null,
	wakesOf: (sessionId: string) => number,
): ValidatedPick {
	const answer = pick === null || candidates[pick] === undefined ? null : pick;
	const chosen = answer ?? defaultPick(candidates);
	const decidedBy: ReconcilerDecider = answer === null ? 'rules' : 'model';
	const picked = candidates[chosen];
	if (picked?.kind !== 'wake-chat') return { candidates, chosen, decidedBy, detail: null };
	const wakes = wakesOf(picked.sessionId);
	if (wakes < RECONCILER_WAKE_LIMIT) return { candidates, chosen, decidedBy, detail: null };
	const reason = `Malini already woke this chat ${wakes} times about this work in one chain of events, so it asks you first. ${picked.label}?`;
	const asking = candidates.findIndex((candidate) => candidate.kind === 'ask-you');
	if (asking !== -1) return { candidates, chosen: asking, decidedBy: 'rules', detail: reason };
	return {
		candidates: [...candidates, ask(reason)],
		chosen: candidates.length,
		decidedBy: 'rules',
		detail: reason,
	};
}

function defaultPick(candidates: readonly ReconcilerCandidate[]): number {
	const wake = candidates.findIndex((candidate) => candidate.kind === 'wake-chat');
	if (wake !== -1) return wake;
	const ask = candidates.findIndex((candidate) => candidate.kind === 'ask-you');
	return ask === -1 ? 0 : ask;
}

export function wakesInChain(
	decisions: readonly Pick<
		ReconcilerDecisionRecord,
		'candidates' | 'chosen' | 'status' | 'workstreamId'
	>[],
	sessionId: string,
	workstreamId: string | null,
): number {
	return decisions.filter((decision) => {
		const chosen = decision.candidates[decision.chosen];
		return (
			chosen?.kind === 'wake-chat' &&
			chosen.sessionId === sessionId &&
			decision.workstreamId === workstreamId &&
			(decision.status === 'done' || decision.status === 'pending')
		);
	}).length;
}
