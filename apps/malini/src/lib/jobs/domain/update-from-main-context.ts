import { untrustedSingleLine } from '$lib/pull-requests/domain/untrusted-text';

export type UpdateFromMainInput = Readonly<{
	branch: string;
	baseBranch: string;
	conflictedPaths: readonly string[];
	conflictMarkerPaths: readonly string[];
}>;

const CONFLICT_PATH_LIMIT = 40;
const CONTEXT_VALUE_LIMIT = 400;

export function updateFromMainJobContext(input: UpdateFromMainInput): string {
	const hint = unmarkedConflictHint(input);
	return [...hint, ...(hint.length > 0 ? [''] : []), ...conflictDetails(input)].join('\n');
}

function unmarkedConflictHint(input: UpdateFromMainInput): string[] {
	const marked = new Set(input.conflictMarkerPaths);
	return input.conflictedPaths.slice(0, CONFLICT_PATH_LIMIT).some((path) => !marked.has(path))
		? [
				"A file without conflict markers holds this branch's version. Keep it, delete it, or replace it with the incoming version (`git show MERGE_HEAD:<path>` prints it), whichever is the intended result.",
			]
		: [];
}

function conflictDetails(input: UpdateFromMainInput): string[] {
	const marked = new Set(input.conflictMarkerPaths);
	const paths = input.conflictedPaths.slice(0, CONFLICT_PATH_LIMIT);
	const omitted = input.conflictedPaths.length - paths.length;
	return [
		'Conflicted files:',
		...paths.map(
			(path) =>
				`- ${contextValue(path)}${marked.has(path) ? '' : ' (no conflict markers: binary, or deleted on one side)'}`,
		),
		...(omitted > 0 ? [`- and ${omitted} more`] : []),
		'',
		'Repository context:',
		`Branch: ${contextValue(input.branch)}`,
		`Base branch: ${contextValue(input.baseBranch)}`,
	];
}

function contextValue(value: string): string {
	return untrustedSingleLine(value, CONTEXT_VALUE_LIMIT) || 'unknown';
}
