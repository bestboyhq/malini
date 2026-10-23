import type { MaliniEditReview } from '$contract/approvals';
import { OUTPUT_COPY, RUNS_IN_COPY } from './approval-request';

export type ReviewChange = Readonly<{
	key: string;
	label: string;
	before: string;
	after: string;
	current: unknown;
	proposed: unknown;
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
	['output', 'When done', (value) => OUTPUT_COPY[String(value)] ?? String(value)],
	['skills', 'Skills', (value) => list(value).join(', ') || 'Every skill that is on'],
];

export function editReview(
	review: MaliniEditReview,
	input: unknown,
	jobName: (reference: string) => string = (reference) => reference,
): EditReview {
	const proposed = (key: string): unknown =>
		typeof input === 'object' && input !== null ? Reflect.get(input, key) : undefined;
	if (review.kind === 'job') {
		const current: Readonly<Record<string, unknown>> = review.current;
		const instructions = proposed('instructions');
		return {
			subject: `job ‘${review.current.name}’`,
			changes: JOB_FIELDS.flatMap(([key, label, show]) =>
				change(key, label, current[key], proposed(key), show),
			),
			text:
				typeof instructions === 'string' && instructions !== review.current.instructions
					? {
							key: 'instructions',
							label: 'Instructions',
							before: review.current.instructions,
							after: instructions,
							current: review.current.instructions,
							proposed: instructions,
						}
					: null,
		};
	}
	const steps = review.current.steps.flatMap((step) => ('job' in step ? [step.job] : []));
	const showSteps = (value: unknown): string => list(value).map(jobName).join(' → ');
	return {
		subject: `routine ‘${review.current.label}’`,
		changes: [
			...change('label', 'Name', review.current.label, proposed('label'), String),
			...change('when', 'When', review.current.when, proposed('when'), String),
			...change('steps', 'Runs', steps, proposed('steps'), showSteps),
		],
		text: null,
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
		...edit.changes.map(({ key, current, proposed }) => [
			key,
			rejected.has(key) ? current : proposed,
		]),
		...(edit.text && text !== null ? [[edit.text.key, text]] : []),
	]);
}

export function keepsCurrent(
	edit: EditReview,
	rejected: ReadonlySet<string>,
	text: string | null,
): boolean {
	return (
		edit.changes.every(({ key }) => rejected.has(key)) &&
		(edit.text === null || text === edit.text.before)
	);
}

function change(
	key: string,
	label: string,
	current: unknown,
	proposed: unknown,
	show: (value: unknown) => string,
): ReviewChange[] {
	if (proposed === undefined) return [];
	const before = show(current);
	const after = show(proposed);
	return before === after ? [] : [{ key, label, before, after, current, proposed }];
}

function list(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
