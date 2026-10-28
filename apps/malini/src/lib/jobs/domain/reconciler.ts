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
	REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
	type EventChannel,
} from '$contract/events';
import type {
	ReconcilerCandidate,
	ReconcilerDecider,
	ReconcilerDecisionRecord,
	WakeAbout,
} from '$contract/jobs';

export const RECONCILER_RULES = [
	'triggers',
	'thens',
	'shipping',
	'resume',
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
		REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL,
		REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
		REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
		REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
		APP_STARTED_CHANNEL,
	],
	resume: [APP_STARTED_CHANNEL, JOBS_TIME_REACHED_CHANNEL],
	schedules: [JOBS_TIME_REACHED_CHANNEL],
	compatibility: [APP_UPDATED_CHANNEL],
	model: [
		CHAT_TURN_FINISHED_CHANNEL,
		JOBS_RUN_FINISHED_CHANNEL,
		REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
	],
};

export function ruleHears(rule: ReconcilerRule, channel: EventChannel): boolean {
	const heard = RULE_EVENTS[rule];
	return heard === 'every' || heard.includes(channel);
}

export const RECONCILER_WAKE_LIMIT = 3;

const REPORT_DETAIL_CHARS = 600;

export type ReconcilerChat = Readonly<{
	sessionId: string;
	workstreamId: string;
	chatName: string;
	workstreamName: string;
	working: boolean;
	lead: boolean;
	lastOutcome: string | null;
	lastNeeds: string | null;
}>;

export type ReconcilerSiblings = Readonly<{
	total: number;
	working: number;
	needYou: number;
}>;

export type TurnFinishedSituation = Readonly<{
	kind: 'turn-finished';
	workstreamId: string;
	workstreamName: string;
	chatName: string;
	status: 'succeeded' | 'failed' | 'cancelled';
	outcome: string | null;
	needs: string | null;
	starter: ReconcilerChat | null;
	starterInChain: boolean;
	siblings: ReconcilerSiblings;
	wakes: number;
}>;

export type JobRunSituation = Readonly<{
	kind: 'job-run';
	title: string;
	status: 'succeeded' | 'failed';
	detail: string | null;
	workstreamId: string | null;
	workstreamName: string | null;
	chat: ReconcilerChat | null;
	handledBy: string | null;
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
	handledBy: string | null;
	wakes: number;
}>;

export type ReconcilerSituation = TurnFinishedSituation | JobRunSituation | ConflictSituation;

export type ReconcilerQuestion = Readonly<{
	facts: readonly string[];
	candidates: readonly ReconcilerCandidate[];
}>;

export type HandledSituation = Readonly<{
	facts: readonly string[];
	candidates: readonly ReconcilerCandidate[];
	reason: string;
}>;

const NOTHING: ReconcilerCandidate = { kind: 'nothing', label: 'Do nothing' };

export function handledSituation(situation: ReconcilerSituation): HandledSituation | null {
	const reason =
		situation.kind === 'conflict' || (situation.kind === 'job-run' && situation.chat === null)
			? situation.handledBy
			: null;
	return reason === null ? null : { facts: facts(situation), candidates: [NOTHING], reason };
}

export function reconcilerQuestion(situation: ReconcilerSituation): ReconcilerQuestion | null {
	const candidates = [NOTHING, ...actions(situation)];
	if (candidates.length < 2) return null;
	return { facts: facts(situation), candidates };
}

export function rulesReason(situation: ReconcilerSituation): string | null {
	if (situation.kind !== 'turn-finished' || !situation.starter || !situation.starterInChain) {
		return null;
	}
	const { needs, starter, status } = situation;
	if (status === 'cancelled' || (status === 'succeeded' && needs === null)) return null;
	const heard = status === 'failed' ? 'that the turn failed' : 'what the turn needs';
	return `“${starter.chatName}” set this turn going, so it hears ${heard} before you do.`;
}

function actions(situation: ReconcilerSituation): ReconcilerCandidate[] {
	switch (situation.kind) {
		case 'turn-finished':
			return turnActions(situation);
		case 'job-run':
			return jobRunActions(situation);
		case 'conflict':
			return conflictActions(situation);
	}
}

function turnActions(situation: TurnFinishedSituation): ReconcilerCandidate[] {
	const { starter, needs, status } = situation;
	if (status === 'cancelled') return [];
	return [
		...(starter
			? [
					wake(
						starter,
						situation.workstreamId,
						`Wake “${starter.chatName}” with this report`,
						turnReport(situation),
						'workstream',
					),
				]
			: []),
		...(needs !== null || status === 'failed'
			? [
					ask(
						needs === null
							? `${chatIn(situation)} failed.`
							: `${chatIn(situation)} needs you: ${needs}`,
					),
				]
			: []),
	];
}

function jobRunActions(situation: JobRunSituation): ReconcilerCandidate[] {
	const { chat, retry, status, title, handledBy } = situation;
	const verb = status === 'failed' ? 'failed' : 'finished';
	const yours = handledBy === null;
	return [
		...(chat
			? [
					wake(
						chat,
						situation.workstreamId ?? chat.workstreamId,
						`Tell “${chat.chatName}” that ${title} ${verb}`,
						jobReport(situation),
						'job',
					),
				]
			: []),
		...(status === 'failed' && retry && yours
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
		...(status === 'failed' && yours
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
						`A merge in “${workstreamName}”, in work you asked for, stopped on conflicts in ${files}: ${conflictedPaths.join(', ')}.`,
						'conflict',
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
	about: WakeAbout,
): ReconcilerCandidate {
	return {
		kind: 'wake-chat',
		label,
		sessionId: chat.sessionId,
		workstreamId: chat.workstreamId,
		from,
		report,
		about,
	};
}

function ask(reason: string): ReconcilerCandidate {
	return { kind: 'ask-you', label: 'Ask you', reason };
}

function turnReport(situation: TurnFinishedSituation): string {
	return [
		`“${situation.workstreamName}”, a workstream you started, ${situation.status === 'failed' ? 'failed its turn' : 'finished a turn'}.`,
		`Outcome: ${situation.outcome ?? 'none'}`,
		`Needs: ${situation.needs ?? 'nothing'}`,
	].join('\n');
}

function jobReport(situation: JobRunSituation): string {
	const where = situation.workstreamName ? ` in “${situation.workstreamName}”` : '';
	const head = `${situation.title}, the job you ran${where}, ${situation.status === 'failed' ? 'failed' : 'finished'}.`;
	const detail = situation.detail?.trim().slice(0, REPORT_DETAIL_CHARS);
	return detail ? `${head}\n\n${detail}` : head;
}

function facts(situation: ReconcilerSituation): string[] {
	switch (situation.kind) {
		case 'turn-finished':
			return [
				`Event: the chat ${chatIn(situation)} ${situation.status === 'failed' ? 'failed its turn' : 'finished a turn'}.`,
				`Outcome: ${situation.outcome ?? 'none'}`,
				`Needs: ${situation.needs ?? 'nothing'}`,
				...(situation.starter
					? starterFacts(situation.starter, situation.starterInChain, situation.siblings)
					: []),
				...wakeFacts(situation.starter, situation.wakes),
			];
		case 'job-run':
			return [
				`Event: the job ${situation.title}${situation.workstreamName ? ` in “${situation.workstreamName}”` : ''} ${situation.status}.`,
				...(situation.detail ? [`Its result: ${oneLine(situation.detail)}`] : []),
				...(situation.handledBy ? [situation.handledBy] : []),
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
				...(situation.handledBy ? [situation.handledBy] : []),
				...(situation.chat
					? [
							`“${situation.chat.chatName}” asked for the work that merged.`,
							chatState(situation.chat),
						]
					: ['No chat asked for the work that merged.']),
				...wakeFacts(situation.chat, situation.wakes),
			];
	}
}

function chatIn({ chatName, workstreamName }: TurnFinishedSituation): string {
	return chatName === workstreamName ? `“${chatName}”` : `“${chatName}” in “${workstreamName}”`;
}

function chatState(chat: ReconcilerChat): string {
	if (chat.working) return `“${chat.chatName}” is working now.`;
	if (chat.lastOutcome === null) return `“${chat.chatName}” is idle.`;
	return `“${chat.chatName}” is idle; its last turn ended with Outcome: ${oneLine(chat.lastOutcome)}, Needs: ${chat.lastNeeds === null ? 'nothing' : oneLine(chat.lastNeeds)}.`;
}

function starterFacts(
	starter: ReconcilerChat,
	inChain: boolean,
	siblings: ReconcilerSiblings,
): string[] {
	const others = siblings.total - 1;
	return [
		`The ${starter.lead ? 'lead chat' : 'chat'} “${starter.chatName}” started it${inChain ? ' and set this turn going' : ', but not this turn'}.`,
		chatState(starter),
		...(others > 0
			? [
					`“${starter.chatName}” started ${siblings.total} workstreams: ${siblings.working} working, ${siblings.needYou} need you, ${siblings.total - siblings.working} not working.`,
				]
			: []),
	];
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

export type WakeReport = Readonly<{ report: string; about: WakeAbout }>;

export function wakePrompt(reports: readonly WakeReport[]): string {
	const started = reports.some(({ about }) => about === 'workstream');
	return [
		started
			? 'Malini woke you: work you started moved on. Answer what your plan covers with workstreams_send, and put what only the user can decide in your Needs line.'
			: 'Malini woke you: work you asked for moved on. Put what only the user can decide in your Needs line.',
		...reports.map(({ report }) => report),
	].join('\n\n');
}

export function actionableCandidates(
	candidates: readonly ReconcilerCandidate[],
): readonly Readonly<{ index: number; candidate: ReconcilerCandidate }>[] {
	return candidates.flatMap((candidate, index) =>
		candidate.kind === 'ask-you' ? [] : [{ index, candidate }],
	);
}
