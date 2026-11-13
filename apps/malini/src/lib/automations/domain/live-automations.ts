import type {
	AutomationRunRecord,
	AutomationRunStatus,
	ReconcilerDecisionRecord,
} from '$contract/automations';

export type LiveAutomation = Readonly<{
	key: string;
	run: AutomationRunRecord | null;
	question: ReconcilerDecisionRecord | null;
	workstreamId: string | null;
}>;

export type LiveAutomationCounts = Readonly<{ running: number; queued: number; needsYou: number }>;

const LIVE_RANK: Partial<Readonly<Record<AutomationRunStatus, number>>> = {
	waiting: 0,
	'needs-you': 0,
	running: 1,
	queued: 2,
};

export function liveAutomations(
	runs: readonly AutomationRunRecord[],
	decisions: readonly ReconcilerDecisionRecord[],
): LiveAutomation[] {
	const byId = new Map(runs.map((run) => [run.id, run]));
	const asking = decisions.filter((decision) => decision.status === 'asking');
	const askedAbout = new Set(asking.map((decision) => decision.subjectRunId));
	const questions = asking.map((question) => {
		const run = question.subjectRunId === null ? null : (byId.get(question.subjectRunId) ?? null);
		return {
			entry: { key: question.id, run, question, workstreamId: question.workstreamId },
			rank: 0,
			at: question.createdAt,
		};
	});
	const live = runs.flatMap((run) => {
		const rank = LIVE_RANK[run.status];
		return rank === undefined || askedAbout.has(run.id)
			? []
			: [
					{
						entry: { key: run.id, run, question: null, workstreamId: run.workstreamId },
						rank,
						at: run.createdAt,
					},
				];
	});
	return [...questions, ...live]
		.sort((left, right) => left.rank - right.rank || left.at.localeCompare(right.at))
		.map(({ entry }) => entry);
}

export function liveAutomationsHere(
	entries: readonly LiveAutomation[],
	workstreamId: string,
	chatSessionId: string | null,
): LiveAutomation[] {
	return entries.filter(
		(entry) =>
			entry.workstreamId === workstreamId ||
			(chatSessionId !== null && entry.run?.chatSessionId === chatSessionId),
	);
}

export function asksYou(entry: LiveAutomation): boolean {
	return (
		entry.question !== null || entry.run?.status === 'waiting' || entry.run?.status === 'needs-you'
	);
}

export function liveAutomationCounts(entries: readonly LiveAutomation[]): LiveAutomationCounts {
	const count = (matches: (entry: LiveAutomation) => boolean): number =>
		entries.filter(matches).length;
	return {
		running: count((entry) => !asksYou(entry) && entry.run?.status === 'running'),
		queued: count((entry) => !asksYou(entry) && entry.run?.status === 'queued'),
		needsYou: count(asksYou),
	};
}
