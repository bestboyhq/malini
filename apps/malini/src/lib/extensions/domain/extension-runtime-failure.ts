export type ExtensionRuntimeFailureOperation = 'startup' | 'workstream-transition';

export type ExtensionRuntimeErrorDetail = Readonly<{
	name: string;
	message: string;
	stack?: string;
}>;

export type ExtensionRuntimeFailureDiagnostic = Readonly<{
	operation: ExtensionRuntimeFailureOperation;
	fromWorkstreamId: string | null;
	toWorkstreamId: string;
	error: ExtensionRuntimeErrorDetail;
	forwardError: ExtensionRuntimeErrorDetail;
	rollbackErrors: readonly ExtensionRuntimeErrorDetail[];
}>;

export type ExtensionWorkstreamPostCommitEffect = 'workstreamChanged' | 'repositoryRefresh';

export type ExtensionWorkstreamPostCommitFailure = Readonly<{
	effect: ExtensionWorkstreamPostCommitEffect;
	extensionId: string | null;
	error: unknown;
}>;

export type ExtensionWorkstreamPostCommitFailureDiagnostic = Readonly<{
	operation: 'workstream-post-commit';
	fromWorkstreamId: string;
	toWorkstreamId: string;
	failures: readonly Readonly<{
		effect: ExtensionWorkstreamPostCommitEffect;
		extensionId: string | null;
		error: ExtensionRuntimeErrorDetail;
	}>[];
}>;

export function extensionRuntimeFailureDiagnostic(input: {
	operation: ExtensionRuntimeFailureOperation;
	fromWorkstreamId: string | null;
	toWorkstreamId: string;
	error: unknown;
}): ExtensionRuntimeFailureDiagnostic {
	const members = aggregateMembers(input.error);
	const cause = errorCause(input.error);
	return {
		operation: input.operation,
		fromWorkstreamId: input.fromWorkstreamId,
		toWorkstreamId: input.toWorkstreamId,
		error: errorDetail(input.error),
		forwardError: errorDetail(firstLeafError(cause ?? members[0] ?? input.error)),
		rollbackErrors: members
			.slice(1)
			.flatMap((member) => errorLeaves(member))
			.map(errorDetail),
	};
}

export function extensionWorkstreamPostCommitFailureDiagnostic(input: {
	fromWorkstreamId: string;
	toWorkstreamId: string;
	failures: readonly ExtensionWorkstreamPostCommitFailure[];
}): ExtensionWorkstreamPostCommitFailureDiagnostic {
	return {
		operation: 'workstream-post-commit',
		fromWorkstreamId: input.fromWorkstreamId,
		toWorkstreamId: input.toWorkstreamId,
		failures: input.failures.map(({ effect, extensionId, error }) => ({
			effect,
			extensionId,
			error: errorDetail(error),
		})),
	};
}

function firstLeafError(error: unknown): unknown {
	return errorLeaves(error)[0] ?? error;
}

function errorLeaves(error: unknown, seen = new Set<unknown>()): readonly unknown[] {
	if (seen.has(error)) return [];
	seen.add(error);
	const members = aggregateMembers(error);
	if (members.length > 0) return members.flatMap((member) => errorLeaves(member, seen));
	const cause = errorCause(error);
	return cause === null ? [error] : errorLeaves(cause, seen);
}

function aggregateMembers(error: unknown): readonly unknown[] {
	if (error instanceof AggregateError) return [...error.errors];
	if (typeof error !== 'object' || error === null) return [];
	const errors = (error as { errors?: unknown }).errors;
	return Array.isArray(errors) ? errors : [];
}

function errorCause(error: unknown): unknown | null {
	if (typeof error !== 'object' || error === null || !('cause' in error)) return null;
	return (error as { cause?: unknown }).cause ?? null;
}

function errorDetail(error: unknown): ExtensionRuntimeErrorDetail {
	if (error instanceof Error) {
		return {
			name: error.name || 'Error',
			message: error.message || String(error),
			...(error.stack ? { stack: error.stack } : {}),
		};
	}
	return { name: typeof error, message: String(error) };
}
