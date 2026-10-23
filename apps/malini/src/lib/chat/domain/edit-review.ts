import type { MaliniEditReview } from '$contract/approvals';
import { MODE_COPY, NO_THEN, NO_TRIGGER, RUNS_IN_COPY } from './approval-request';

export type ReviewChange = Readonly<{
	key: string;
	label: string;
	before: string;
	after: string;
	current: unknown;
	proposed: unknown;
	follows: string | null;
}>;

export type EditReview = Readonly<{
	subject: string;
	changes: readonly ReviewChange[];
	text: ReviewChange | null;
}>;

type Field = readonly [key: string, label: string, show: (value: unknown) => string];

const JOB_FIELDS: readonly Field[] = [
	['name', 'Name', String],
	['model', 'Model', String],
	['effort', 'Effort', String],
	['runsIn', 'Runs in', (value) => RUNS_IN_COPY[String(value)] ?? String(value)],
	['skills', 'Skills', (value) => list(value).join(', ') || 'Every skill that is on'],
];

export function editReview(
	review: MaliniEditReview,
	input: unknown,
	jobName: (reference: string) => string = (reference) => reference,
): EditReview {
	const proposed = (key: string): unknown =>
		typeof input === 'object' && input !== null ? Reflect.get(input, key) : undefined;
	const { current } = review;
	const fields: Readonly<Record<string, unknown>> = current;
	const currentMode = current.trigger?.mode ?? null;
	const when = change('when', 'When', current.trigger?.when ?? null, proposed('when'), showWhen);
	const instructions = proposed('instructions');
	return {
		subject: `job ‘${current.name}’`,
		changes: [
			...JOB_FIELDS.flatMap(([key, label, show]) =>
				change(key, label, fields[key], proposed(key), show),
			),
			...when,
			...when.flatMap(({ proposed: next }) =>
				change(
					'mode',
					'Runs',
					currentMode,
					typeof next === 'string' ? (currentMode ?? 'off') : null,
					showMode,
					'when',
				),
			),
			...change('then', 'Then', current.thenJobId, proposed('then'), (value) =>
				typeof value === 'string' ? jobName(value) : NO_THEN,
			),
		],
		text:
			typeof instructions === 'string' && instructions !== current.instructions
				? {
						key: 'instructions',
						label: 'Instructions',
						before: current.instructions,
						after: instructions,
						current: current.instructions,
						proposed: instructions,
						follows: null,
					}
				: null,
	};
}

export function reviewedInput(
	review: MaliniEditReview,
	edit: EditReview,
	rejected: ReadonlySet<string>,
	text: string | null,
): Record<string, unknown> {
	return Object.fromEntries([
		['id', review.current.id],
		...edit.changes.flatMap(({ key, current, proposed, follows }) =>
			follows === null ? [[key, rejected.has(key) ? current : proposed]] : [],
		),
		...(edit.text && text !== null ? [[edit.text.key, text]] : []),
	]);
}

export function keepsCurrent(
	edit: EditReview,
	rejected: ReadonlySet<string>,
	text: string | null,
): boolean {
	return (
		edit.changes.every(({ key, follows }) => follows !== null || rejected.has(key)) &&
		(edit.text === null || text === edit.text.before)
	);
}

function change(
	key: string,
	label: string,
	current: unknown,
	proposed: unknown,
	show: (value: unknown) => string,
	follows: string | null = null,
): ReviewChange[] {
	if (proposed === undefined) return [];
	const before = show(current);
	const after = show(proposed);
	return before === after ? [] : [{ key, label, before, after, current, proposed, follows }];
}

function showWhen(value: unknown): string {
	return typeof value === 'string' ? value : NO_TRIGGER;
}

function showMode(value: unknown): string {
	return typeof value === 'string' ? (MODE_COPY[value] ?? value) : NO_TRIGGER;
}

function list(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
