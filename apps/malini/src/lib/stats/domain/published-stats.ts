import type {
	NamedCount,
	Percentiles,
	PublishedStats,
	SharedParts,
	SharedStats,
	StatsTechniques,
} from '$contract/stats';
import { dayStreak, localDate, shiftDate } from './activity';
import { agentsAtOnce } from './agents-at-once';
import { MALINI_SERVER, type CatalogNames } from './catalog-names';
import {
	BROWSER_TOOL_PREFIX,
	languageOf,
	modelFamily,
	SCREENSHOT_TOOL,
	SKILL_TOOL,
	SUBAGENT_TOOLS,
	toolGroup,
	WEB_TOOLS,
} from './stats-names';

export type StatsRun = Readonly<{
	id: string;
	startedAt: string;
	completedAt: string | null;
	endedAt: string | null;
	job: boolean;
	model: string | null;
	workstreamId: string;
	repository: string | null;
}>;

export type StatsToolCalls = Readonly<{
	runId: string;
	tool: string;
	skill: string;
	calls: number;
}>;

export type StatsChangedFile = Readonly<{
	runId: string;
	repository: string;
	path: string;
	additions: number;
	deletions: number;
}>;

export type StatsWorkstream = Readonly<{ createdAt: string; mergedAt: string | null }>;

export type StatsRepository = Readonly<{ fullName: string; public: boolean }>;

export type StatsSources = Readonly<{
	runs: readonly StatsRun[];
	finishedToolCalls: readonly StatsToolCalls[];
	changedFiles: readonly StatsChangedFile[];
	workstreams: readonly StatsWorkstream[];
	repositories: ReadonlyMap<string, StatsRepository>;
	picked: readonly string[];
	names: CatalogNames;
}>;

const PUBLISHED_DAYS = 371;
const MAX_REPOSITORIES = 10;
const MAX_NAMES = 40;
const MAX_RUN_SECONDS = 30 * 24 * 60 * 60;

export function statsCutoff(now: Date): Date {
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function publishedStats(sources: StatsSources, cutoff: Date): PublishedStats | null {
	const { runs } = sources;
	const end = cutoff.getTime();
	const through = shiftDate(localDate(cutoff), -1);
	const runsByDay = countBy(runs, (run) => localDate(new Date(run.startedAt)));
	const dates = [...runsByDay.keys()].sort();
	const since = dates[0];
	if (since === undefined) return null;
	const agents = agentsAtOnce(
		runs.map((run) => ({
			start: Date.parse(run.startedAt),
			end: Math.min(run.endedAt === null ? end : Date.parse(run.endedAt), end),
		})),
	);
	const finished = runs.filter(
		(run) => run.completedAt !== null && Date.parse(run.completedAt) < end,
	);
	const stepsByRun = sumBy(
		sources.finishedToolCalls,
		(call) => call.runId,
		(call) => call.calls,
	);
	const linesByRun = sumBy(
		sources.changedFiles,
		(file) => file.runId,
		(file) => file.additions + file.deletions,
	);
	const firstDay = shiftDate(through, 1 - PUBLISHED_DAYS);
	return {
		version: 1,
		through,
		since,
		totals: {
			runs: runs.length,
			jobRuns: runs.filter((run) => run.job).length,
			changeRuns: linesByRun.size,
			activeDays: dates.length,
			toolCalls: total(sources.finishedToolCalls, (call) => call.calls),
			screenshots: total(
				sources.finishedToolCalls.filter((call) => call.tool === SCREENSHOT_TOOL),
				(call) => call.calls,
			),
			workstreams: sources.workstreams.filter(
				(workstream) => Date.parse(workstream.createdAt) < end,
			).length,
			mergedPullRequests: sources.workstreams.filter(
				(workstream) => workstream.mergedAt !== null && Date.parse(workstream.mergedAt) < end,
			).length,
			linesAdded: total(sources.changedFiles, (file) => file.additions),
			linesDeleted: total(sources.changedFiles, (file) => file.deletions),
			filesChanged: new Set(sources.changedFiles.map((file) => `${file.repository}\0${file.path}`))
				.size,
		},
		days: dates
			.filter((date) => date >= firstDay)
			.map((date) => ({
				date,
				runs: runsByDay.get(date) ?? 0,
				agents: twoPlaces(agents?.days.get(date) ?? 1),
			})),
		intensity: {
			agents: agents
				? { mean: twoPlaces(agents.mean), p50: agents.p50, p90: agents.p90, max: agents.max }
				: { mean: 1, p50: 1, p90: 1, max: 1 },
			runSeconds: percentiles(finished.map(runSeconds)),
			steps: percentiles(finished.map((run) => stepsByRun.get(run.id) ?? 0)),
			runsPerActiveDay: percentiles([...runsByDay.values()]),
			linesPerChange: { p50: percentiles([...linesByRun.values()]).p50 },
			runsPerWorkstream: {
				p50: percentiles([
					...countBy(runs, (run) => (run.repository === null ? null : run.workstreamId)).values(),
				]).p50,
			},
		},
		techniques: runTechniques(sources.finishedToolCalls),
		models: namedCounts(countBy(runs, (run) => modelFamily(run.model))),
		languages: namedCounts(
			sumBy(
				sources.changedFiles,
				(file) => languageOf(file.path),
				(file) => file.additions + file.deletions,
			),
		),
		tools: namedCounts(
			sumBy(
				sources.finishedToolCalls,
				(call) => toolGroup(call.tool),
				(call) => call.calls,
			),
		),
		mcpServers: cappedCounts(
			sumBy(
				sources.finishedToolCalls,
				(call) => sources.names.mcpServer(call.tool),
				(call) => call.calls,
			),
		),
		skills: cappedCounts(
			sumBy(
				sources.finishedToolCalls,
				(call) => (call.tool === SKILL_TOOL ? sources.names.skill(call.skill) : null),
				(call) => call.calls,
			),
		),
		...repositoryCounts(runs, sources.repositories, sources.picked),
	};
}

export function sharedStats(stats: PublishedStats, parts: SharedParts): SharedStats {
	const { techniques, tools, models, languages, mcpServers, skills, ...always } = stats;
	return {
		...always,
		...(parts.techniques ? { techniques } : {}),
		...(parts.tools ? { tools } : {}),
		...(parts.models ? { models } : {}),
		...(parts.languages ? { languages } : {}),
		...(parts.mcpServers ? { mcpServers } : {}),
		...(parts.skills ? { skills } : {}),
	};
}

export function publishedStreak(stats: PublishedStats): number {
	return dayStreak(stats.days, shiftDate(stats.through, 1));
}

function repositoryCounts(
	runs: readonly StatsRun[],
	repositories: ReadonlyMap<string, StatsRepository>,
	picked: readonly string[],
): Pick<PublishedStats, 'repositories' | 'otherRepositories'> {
	const pickedNames = new Set(picked.map((name) => name.toLowerCase()));
	const named = new Map<string, number>();
	const others = { public: { repositories: 0, runs: 0 }, private: { repositories: 0, runs: 0 } };
	for (const [id, count] of countBy(runs, (run) => run.repository)) {
		const repository = repositories.get(id);
		if (repository?.public && pickedNames.has(repository.fullName.toLowerCase())) {
			named.set(repository.fullName, count);
			continue;
		}
		const group = repository?.public ? others.public : others.private;
		group.repositories += 1;
		group.runs += count;
	}
	return { repositories: namedCounts(named).slice(0, MAX_REPOSITORIES), otherRepositories: others };
}

function runTechniques(calls: readonly StatsToolCalls[]): StatsTechniques {
	const runsUsing = (uses: (tool: string) => boolean): number =>
		new Set(calls.filter((call) => uses(call.tool)).map((call) => call.runId)).size;
	return {
		browserRuns: runsUsing((tool) => tool.startsWith(BROWSER_TOOL_PREFIX)),
		subagentRuns: runsUsing((tool) => SUBAGENT_TOOLS.has(tool)),
		skillRuns: runsUsing((tool) => tool === SKILL_TOOL),
		mcpRuns: runsUsing(
			(tool) => tool.startsWith('mcp__') && !tool.startsWith(`mcp__${MALINI_SERVER}__`),
		),
		webRuns: runsUsing((tool) => WEB_TOOLS.has(tool)),
	};
}

function cappedCounts(counts: ReadonlyMap<string, number>): NamedCount[] {
	const sorted = namedCounts(counts);
	if (sorted.length <= MAX_NAMES) return sorted;
	const named = sorted.filter(({ name }) => name !== 'other').slice(0, MAX_NAMES - 1);
	const kept = new Set(named.map(({ name }) => name));
	const other = total(
		sorted.filter(({ name }) => !kept.has(name)),
		({ count }) => count,
	);
	return namedCounts(
		new Map([...named.map(({ name, count }) => [name, count] as const), ['other', other]]),
	);
}

function runSeconds(run: StatsRun): number {
	const seconds = (Date.parse(run.endedAt ?? run.startedAt) - Date.parse(run.startedAt)) / 1000;
	return Math.min(MAX_RUN_SECONDS, Math.max(0, Math.round(seconds)));
}

function percentiles(values: readonly number[]): Percentiles {
	const sorted = [...values].sort((left, right) => left - right);
	return { p50: nearestRank(sorted, 0.5), p90: nearestRank(sorted, 0.9), max: sorted.at(-1) ?? 0 };
}

function nearestRank(sorted: readonly number[], share: number): number {
	return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] ?? 0;
}

function namedCounts(counts: ReadonlyMap<string, number>): NamedCount[] {
	return [...counts]
		.filter(([, count]) => count > 0)
		.map(([name, count]) => ({ name, count }))
		.sort((left, right) => right.count - left.count || (left.name < right.name ? -1 : 1));
}

function countBy<Item>(
	items: readonly Item[],
	key: (item: Item) => string | null,
): Map<string, number> {
	return sumBy(items, key, () => 1);
}

function sumBy<Item>(
	items: readonly Item[],
	key: (item: Item) => string | null,
	value: (item: Item) => number,
): Map<string, number> {
	const sums = new Map<string, number>();
	for (const item of items) {
		const name = key(item);
		if (name !== null) sums.set(name, (sums.get(name) ?? 0) + value(item));
	}
	return sums;
}

function total<Item>(items: readonly Item[], value: (item: Item) => number): number {
	return items.reduce((sum, item) => sum + value(item), 0);
}

function twoPlaces(value: number): number {
	return Math.round(value * 100) / 100;
}
