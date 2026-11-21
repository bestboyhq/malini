import type { Initiative, InitiativeDependency } from '$contract/initiatives';

export type { Initiative, InitiativeDependency, InitiativeWorkstream } from '$contract/initiatives';

export type WorkstreamDot = 'merged' | 'needs' | 'failed' | 'running' | 'idle' | 'archived';

export type WorkstreamStanding = Readonly<{
	dot: WorkstreamDot;
	label: string;
	name: string;
	repositoryFullName: string | null;
	pullRequestNumber: number | null;
	open: boolean;
}>;

export type StandingOf = (workstreamId: string) => WorkstreamStanding | null;

export type DependencyState = 'todo' | 'done' | 'merged' | 'needs' | 'failed' | 'running' | 'idle';

export type InitiativeProgress = Readonly<{ done: number; total: number; needsYou: number }>;

export type NoteTarget = Readonly<{
	initiative: Initiative;
	dependency: InitiativeDependency | null;
}>;

export type RailWeek = Readonly<{ label: string | null; days: readonly string[] }>;

export type Rail = Readonly<{ earlier: readonly string[]; weeks: readonly RailWeek[] }>;

const OPEN_ORDER = ['needs', 'failed', 'running', 'idle'] as const;

const WEEKS_AHEAD = 2;

export function dependencyState(
	dependency: InitiativeDependency,
	standingOf: StandingOf,
): DependencyState {
	const dots = dependency.workstreams
		.map(({ workstreamId }) => standingOf(workstreamId)?.dot ?? 'archived')
		.filter((dot) => dot !== 'archived');
	if (dots.length === 0) return dependency.done ? 'done' : 'todo';
	return OPEN_ORDER.find((dot) => dots.includes(dot)) ?? 'merged';
}

export function isFinished(state: DependencyState): boolean {
	return state === 'done' || state === 'merged';
}

export function initiativeProgress(
	initiative: Initiative,
	standingOf: StandingOf,
): InitiativeProgress {
	const states = initiative.dependencies.map((dependency) =>
		dependencyState(dependency, standingOf),
	);
	return {
		done: states.filter(isFinished).length,
		total: states.length,
		needsYou: states.filter((state) => state === 'needs').length,
	};
}

export function initiativeFinished(initiative: Initiative, standingOf: StandingOf): boolean {
	const { done, total } = initiativeProgress(initiative, standingOf);
	return total > 0 && done === total;
}

export function initiativesOn(
	initiatives: readonly Initiative[],
	day: string | null,
): readonly Initiative[] {
	return initiatives.filter((initiative) => initiative.dueOn === day);
}

export function noteTarget(
	initiatives: readonly Initiative[],
	id: string | null,
): NoteTarget | null {
	for (const initiative of initiatives) {
		if (initiative.id === id) return { initiative, dependency: null };
		const dependency = initiative.dependencies.find((candidate) => candidate.id === id);
		if (dependency) return { initiative, dependency };
	}
	return null;
}

export function localDay(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const dayOfMonth = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

export function dateOf(day: string): Date {
	const [year = 0, month = 1, dayOfMonth = 1] = day.split('-').map(Number);
	return new Date(year, month - 1, dayOfMonth);
}

export function addDays(day: string, count: number): string {
	const date = dateOf(day);
	date.setDate(date.getDate() + count);
	return localDay(date);
}

export function isWeekend(day: string): boolean {
	const weekday = dateOf(day).getDay();
	return weekday === 0 || weekday === 6;
}

export function isDay(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && localDay(dateOf(value)) === value;
}

export function rail(
	today: string,
	initiatives: readonly Initiative[],
	standingOf: StandingOf,
): Rail {
	const dated = initiatives.flatMap((initiative) => (initiative.dueOn ? [initiative] : []));
	const earlier = [
		...new Set(
			dated
				.filter(
					(initiative) =>
						(initiative.dueOn ?? today) < today && !initiativeFinished(initiative, standingOf),
				)
				.map((initiative) => initiative.dueOn ?? today),
		),
	].sort();
	const latest = dated.reduce(
		(max, initiative) => ((initiative.dueOn ?? today) > max ? (initiative.dueOn ?? today) : max),
		today,
	);
	const minimumEnd = addDays(sundayOf(today), WEEKS_AHEAD * 7);
	const end = sundayOf(latest) > minimumEnd ? sundayOf(latest) : minimumEnd;
	const weeks: RailWeek[] = [];
	for (let start = today; start <= end; start = addDays(sundayOf(start), 1)) {
		const days: string[] = [];
		for (let day = start; day <= sundayOf(start); day = addDays(day, 1)) days.push(day);
		weeks.push({ label: weekLabel(today, start), days });
	}
	return { earlier, weeks };
}

function sundayOf(day: string): string {
	return addDays(day, (7 - dateOf(day).getDay()) % 7);
}

function weekLabel(today: string, start: string): string | null {
	if (start === today) return null;
	if (start === addDays(sundayOf(today), 1)) return 'Next week';
	const date = dateOf(start);
	return `Week of ${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })}`;
}
