import type {
	ExtensionPullRequestCheck,
	ExtensionPullRequestContext,
	ExtensionPullRequestMergeMethod,
	ExtensionRepositoryDiff,
	ExtensionRepositoryOperation,
	ExtensionRepositoryStatus,
	ExtensionWorkstream,
} from '@malini/extension-api';

export type RepositoryContext = {
	workstreamId: string;
	repositoryPath: string;
	repositoryFullName?: string;
	branch: string;
	baseBranch: string;
	dirtyPaths: readonly string[];
	conflictedPaths: readonly string[];
	conflictMarkerPaths: readonly string[];
	ahead: number;
	behind: number;
	hasUpstream: boolean;
	mergeInProgress: boolean;
	operationInProgress: ExtensionRepositoryOperation | null;
	pullRequest: ExtensionPullRequestContext | null;
};

export type RepositoryContextResult =
	{ ok: true; context: RepositoryContext } | { ok: false; error: string };

export type PullRequestMergeReadiness = 'ready' | 'behind' | 'blocked' | 'checking';
const READY_PULL_REQUEST_MERGEABLE_STATES = new Set(['clean', 'has_hooks', 'unstable']);

export type RepositoryFile = {
	path: string;
	name: string;
	directory: string;
	extension: string;
};

export type DiffLine = {
	kind: 'context' | 'addition' | 'deletion';
	oldLine: number | null;
	newLine: number | null;
	text: string;
};

export type RepositoryDiffNoLineChange = 'binary' | 'mode' | 'rename' | 'empty';

export const REPOSITORY_NO_LINE_CHANGE_LABEL: Readonly<Record<RepositoryDiffNoLineChange, string>> =
	Object.freeze({
		binary: 'Binary',
		mode: 'Mode changed',
		rename: 'Renamed',
		empty: 'Empty file',
	});

export const REPOSITORY_NO_LINE_CHANGE_STATEMENT: Readonly<
	Record<RepositoryDiffNoLineChange, string>
> = Object.freeze({
	binary: 'Binary file changed; no textual diff is available.',
	mode: 'File mode changed; no lines were added or removed.',
	rename: 'File renamed; no lines were added or removed.',
	empty: 'No textual lines changed in this file.',
});

export type RepositoryDiff = {
	path: string;
	lines: readonly DiffLine[];
	additions: number;
	deletions: number;
	noLineChange: RepositoryDiffNoLineChange | null;
};

export type RepositoryAgentSessionNetDiff = Readonly<{
	beforeCommit: string;
	afterCommit: string;
	capturedAt: string;
	diff: RepositoryDiff | null;
}>;

export type RepositoryAgentSessionTurnDiff = Readonly<{
	runId: string;
	turn: number;
	title: string | null;
	beforeCommit: string;
	afterCommit: string;
	diff: RepositoryDiff | null;
}>;

export type RepositoryAgentSessionDiff = Readonly<{
	sessionId: string;
	path: string;
	additions: number;
	deletions: number;
	isBinary: boolean;
	contributingRunIds: readonly string[];
	net: RepositoryAgentSessionNetDiff;
	turns: readonly RepositoryAgentSessionTurnDiff[];
}>;

export const REPOSITORY_AGENT_SESSION_DIFF_LIMITS = Object.freeze({
	maxRuns: 64,
	maxPatchBytes: 2 * 1024 * 1024,
	maxTotalPatchBytes: 2 * 1024 * 1024,
	maxPatchLines: 100_000,
	maxPathLength: 4_096,
	maxIdentifierLength: 256,
	maxCommitLength: 128,
	maxCapturedAtLength: 128,
});

export type DiffRequest = {
	path: string;
	before: string;
	after: string;
};

export function contextFromWorkstream(workstream: ExtensionWorkstream): RepositoryContext {
	return {
		workstreamId: workstream.id,
		repositoryPath: workstream.repositoryPath,
		...(workstream.repositoryFullName ? { repositoryFullName: workstream.repositoryFullName } : {}),
		branch: workstream.branch,
		baseBranch: workstream.baseBranch,
		dirtyPaths: [],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		pullRequest: null,
	};
}

export function contextFromRepository(
	workstream: ExtensionWorkstream,
	status: ExtensionRepositoryStatus,
	pullRequest: ExtensionPullRequestContext,
): RepositoryContext {
	return {
		workstreamId: workstream.id,
		repositoryPath: workstream.repositoryPath,
		...(workstream.repositoryFullName ? { repositoryFullName: workstream.repositoryFullName } : {}),
		branch: status.branch,
		baseBranch: status.baseBranch,
		dirtyPaths: [...status.dirtyPaths],
		...repositoryLocalSignals(status),
		pullRequest: clonePullRequest(pullRequest),
	};
}

export function repositoryLocalSignals(
	status: ExtensionRepositoryStatus,
): Pick<
	RepositoryContext,
	| 'conflictedPaths'
	| 'conflictMarkerPaths'
	| 'ahead'
	| 'behind'
	| 'hasUpstream'
	| 'mergeInProgress'
	| 'operationInProgress'
> {
	return {
		conflictedPaths: [...(status.conflictedPaths ?? [])],
		conflictMarkerPaths: [...(status.conflictMarkerPaths ?? [])],
		ahead: status.ahead,
		behind: status.behind,
		hasUpstream: status.hasUpstream ?? true,
		mergeInProgress: status.mergeInProgress ?? false,
		operationInProgress: status.operationInProgress ?? null,
	};
}

export type RepositoryGithubSession = 'usable' | 'reconnect-required';

const GITHUB_SESSION_FINISHED: readonly RegExp[] = [
	/github oauth refresh failed/iu,
	/client_id and\/or client_secret/iu,
	/github authorization expired/iu,
	/\bbad credentials\b/iu,
	/\b(?:bad_refresh_token|bad_verification_code|invalid_grant|expired_token)\b/iu,
];

export function repositoryGithubSession(
	...errors: readonly (string | null | undefined)[]
): RepositoryGithubSession {
	const reported = errors.filter(
		(error): error is string => typeof error === 'string' && error.trim().length > 0,
	);
	const finished = reported.some((error) =>
		GITHUB_SESSION_FINISHED.some((signal) => signal.test(error)),
	);
	return finished ? 'reconnect-required' : 'usable';
}

export function pullRequestMergeReadiness(
	pullRequest: ExtensionPullRequestContext,
): PullRequestMergeReadiness {
	const state = pullRequest.mergeableState?.trim().toLocaleLowerCase() ?? '';
	if (state === 'behind') return 'behind';
	if (
		pullRequest.mergeable === false ||
		state === 'blocked' ||
		state === 'dirty' ||
		state === 'draft'
	) {
		return 'blocked';
	}
	if (pullRequest.mergeable !== true || !READY_PULL_REQUEST_MERGEABLE_STATES.has(state)) {
		return 'checking';
	}
	return 'ready';
}

export function pullRequestConflictsWithBase(pullRequest: ExtensionPullRequestContext): boolean {
	return (
		(pullRequest.state === 'open' || pullRequest.state === 'draft') &&
		pullRequest.mergeableState?.trim().toLocaleLowerCase() === 'dirty'
	);
}

export function pullRequestChecksAllowMerge(
	checks: ExtensionPullRequestContext['checks'],
	checkItems: readonly ExtensionPullRequestCheck[] = [],
): boolean {
	if (checks === 'unknown') return false;
	if (checkItems.length > 0) return pullRequestBlockingChecks(checkItems).length === 0;
	return checks === 'success' || checks === 'none';
}

export function pullRequestBlockingChecks(
	checkItems: readonly ExtensionPullRequestCheck[],
): readonly ExtensionPullRequestCheck[] {
	return checkItems.filter((check) => check.required !== false && !pullRequestCheckPassed(check));
}

export function pullRequestCheckFailed(check: ExtensionPullRequestCheck): boolean {
	if (pullRequestCheckPassed(check) || check.notStartedReason) return false;
	const state = check.state.trim().toLocaleLowerCase();
	return (
		state === 'failure' || state === 'error' || (state === 'completed' && check.conclusion !== null)
	);
}

export function pullRequestCheckPassed(check: ExtensionPullRequestCheck): boolean {
	const state = check.state.trim().toLocaleLowerCase();
	const conclusion = check.conclusion?.trim().toLocaleLowerCase() ?? null;
	if (conclusion !== null) {
		return state === 'completed' && ['success', 'neutral', 'skipped'].includes(conclusion);
	}
	return state === 'success';
}

export function pullRequestHasReviewBlockers(pullRequest: ExtensionPullRequestContext): boolean {
	return (
		pullRequest.reviewDecision === 'changes_requested' ||
		pullRequest.reviewDecision === 'review_required' ||
		(pullRequest.unresolvedReviewThreadCount ?? 0) > 0
	);
}

export function pullRequestReviewStatusUnavailable(
	pullRequest: ExtensionPullRequestContext,
): boolean {
	return pullRequest.unresolvedReviewThreadCount === null;
}

export function selectPullRequestMergeMethod(
	pullRequest: ExtensionPullRequestContext,
	preferred?: ExtensionPullRequestMergeMethod | null,
): ExtensionPullRequestMergeMethod | null {
	const allowed = [...new Set(pullRequest.allowedMergeMethods ?? [])];
	if (preferred && allowed.includes(preferred)) return preferred;
	if (pullRequest.defaultMergeMethod && allowed.includes(pullRequest.defaultMergeMethod)) {
		return pullRequest.defaultMergeMethod;
	}
	return allowed[0] ?? null;
}

export function pullRequestViewerCanMerge(pullRequest: ExtensionPullRequestContext): boolean {
	return pullRequest.viewerCanMerge === true && selectPullRequestMergeMethod(pullRequest) !== null;
}

export function parseRepositoryContext(input: unknown): RepositoryContextResult {
	if (!isRecord(input)) return invalid('context must be an object');

	const workstreamId = readRequiredString(input, ['workstreamId', 'id']);
	if (!workstreamId) return invalid('workstreamId must be a non-empty string');
	const repositoryPath = readRequiredString(input, ['repositoryPath']);
	if (!repositoryPath) return invalid('repositoryPath must be a non-empty string');
	const repositoryFullName = readRequiredString(input, ['repositoryFullName']);
	const branch = readRequiredString(input, ['branch']);
	if (!branch) return invalid('branch must be a non-empty string');
	const baseBranch = readRequiredString(input, ['baseBranch']);
	if (!baseBranch) return invalid('baseBranch must be a non-empty string');
	const dirtyPaths = parseDirtyPaths(input.dirtyPaths);
	if (typeof dirtyPaths === 'string') return invalid(dirtyPaths);
	const conflictedPaths = parseDirtyPaths(input.conflictedPaths);
	if (typeof conflictedPaths === 'string') {
		return invalid(conflictedPaths.replace('dirtyPaths', 'conflictedPaths'));
	}
	const conflictMarkerPaths = parseDirtyPaths(input.conflictMarkerPaths);
	if (typeof conflictMarkerPaths === 'string') {
		return invalid(conflictMarkerPaths.replace('dirtyPaths', 'conflictMarkerPaths'));
	}
	const operationInProgress = parseOperation(input.operationInProgress);
	if (operationInProgress === undefined) {
		return invalid('operationInProgress must be merge, rebase, cherry-pick, revert or null');
	}
	const ahead = parseNonNegativeInteger(input.ahead, 'ahead');
	if (typeof ahead === 'string') return invalid(ahead);
	const behind = parseNonNegativeInteger(input.behind, 'behind');
	if (typeof behind === 'string') return invalid(behind);

	const pullRequest = parsePullRequest(input.pullRequest);
	if (typeof pullRequest === 'string') return invalid(pullRequest);
	return {
		ok: true,
		context: {
			workstreamId,
			repositoryPath,
			...(repositoryFullName ? { repositoryFullName } : {}),
			branch,
			baseBranch,
			dirtyPaths,
			conflictedPaths,
			conflictMarkerPaths,
			ahead,
			behind,
			hasUpstream: input.hasUpstream !== false,
			mergeInProgress: input.mergeInProgress === true,
			operationInProgress,
			pullRequest,
		},
	};
}

export function parseDiffRequest(input: unknown): DiffRequest {
	if (!isRecord(input)) throw new Error('Diff request must be an object');
	const path = readRequiredString(input, ['path']);
	if (!path) throw new Error('Diff request path must be a non-empty string');
	if (typeof input.before !== 'string') throw new Error('Diff request before must be a string');
	if (typeof input.after !== 'string') throw new Error('Diff request after must be a string');
	return { path: normalizeRepositoryPath(path), before: input.before, after: input.after };
}

export function createFileList(
	paths: readonly string[],
	showHidden: boolean,
): readonly RepositoryFile[] {
	const unique = new Set<string>();
	for (const path of paths) {
		const normalized = normalizeRepositoryPath(path);
		if (!showHidden && normalized.split('/').some((part) => part.startsWith('.'))) continue;
		unique.add(normalized);
	}
	return [...unique]
		.sort((left, right) => left.localeCompare(right))
		.map((path) => {
			const segments = path.split('/');
			const name = segments.at(-1) ?? path;
			const extensionIndex = name.lastIndexOf('.');
			return {
				path,
				name,
				directory: segments.length > 1 ? segments.slice(0, -1).join('/') : '',
				extension: extensionIndex > 0 ? name.slice(extensionIndex + 1).toLowerCase() : '',
			};
		});
}

export function repositoryFileMatches(
	files: readonly RepositoryFile[],
	path: string,
): readonly string[] {
	if (files.some((file) => file.path === path)) return [path];
	const suffix = `/${path}`;
	return files.filter((file) => file.path.endsWith(suffix)).map((file) => file.path);
}

export function isGitInternalPath(path: string): boolean {
	return path.split('/').includes('.git');
}

export function renderLineDiff(request: DiffRequest): RepositoryDiff {
	const before = splitLines(request.before);
	const after = splitLines(request.after);
	const lcs = buildLcsTable(before, after);
	const lines: DiffLine[] = [];
	let beforeIndex = 0;
	let afterIndex = 0;
	let oldLine = 1;
	let newLine = 1;

	while (beforeIndex < before.length || afterIndex < after.length) {
		if (before[beforeIndex] === after[afterIndex] && beforeIndex < before.length) {
			lines.push({
				kind: 'context',
				oldLine: oldLine++,
				newLine: newLine++,
				text: before[beforeIndex] ?? '',
			});
			beforeIndex += 1;
			afterIndex += 1;
			continue;
		}

		const deleteScore = getScore(lcs, beforeIndex + 1, afterIndex);
		const addScore = getScore(lcs, beforeIndex, afterIndex + 1);
		if (afterIndex < after.length && (beforeIndex >= before.length || addScore > deleteScore)) {
			lines.push({
				kind: 'addition',
				oldLine: null,
				newLine: newLine++,
				text: after[afterIndex] ?? '',
			});
			afterIndex += 1;
		} else if (beforeIndex < before.length) {
			lines.push({
				kind: 'deletion',
				oldLine: oldLine++,
				newLine: null,
				text: before[beforeIndex] ?? '',
			});
			beforeIndex += 1;
		}
	}

	const additions = lines.filter(({ kind }) => kind === 'addition').length;
	const deletions = lines.filter(({ kind }) => kind === 'deletion').length;
	return {
		path: normalizeRepositoryPath(request.path),
		lines,
		additions,
		deletions,
		noLineChange: additions === 0 && deletions === 0 ? 'empty' : null,
	};
}

export function renderRepositoryDiff(input: ExtensionRepositoryDiff): RepositoryDiff {
	return {
		path: normalizeRepositoryPath(input.path),
		lines: parseUnifiedPatchHunks(input.patch),
		additions: input.additions,
		deletions: input.deletions,
		noLineChange:
			input.additions === 0 && input.deletions === 0
				? classifyRepositoryNoLineChange(input.patch)
				: null,
	};
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

function parseUnifiedPatchHunks(patch: string): readonly DiffLine[] {
	const source = splitLines(patch);
	const lines: DiffLine[] = [];
	for (let index = 0; index < source.length; index += 1) {
		const header = HUNK_HEADER_PATTERN.exec(source[index] ?? '');
		if (!header) continue;
		let oldLine = Number(header[1]);
		let newLine = Number(header[3]);
		let oldRemaining = header[2] === undefined ? 1 : Number(header[2]);
		let newRemaining = header[4] === undefined ? 1 : Number(header[4]);
		while (index + 1 < source.length && (oldRemaining > 0 || newRemaining > 0)) {
			const text = source[index + 1] ?? '';
			if (HUNK_HEADER_PATTERN.test(text)) break;
			index += 1;
			if (text.startsWith('\\')) continue;
			if (text.startsWith('+')) {
				lines.push({ kind: 'addition', oldLine: null, newLine: newLine++, text: text.slice(1) });
				newRemaining -= 1;
			} else if (text.startsWith('-')) {
				lines.push({ kind: 'deletion', oldLine: oldLine++, newLine: null, text: text.slice(1) });
				oldRemaining -= 1;
			} else {
				lines.push({
					kind: 'context',
					oldLine: oldLine++,
					newLine: newLine++,
					text: text.startsWith(' ') ? text.slice(1) : text,
				});
				oldRemaining -= 1;
				newRemaining -= 1;
			}
		}
	}
	return lines;
}

function classifyRepositoryNoLineChange(patch: string): RepositoryDiffNoLineChange {
	let sawOldMode = false;
	let sawNewMode = false;
	let sawRename = false;
	for (const line of splitLines(patch)) {
		if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) return 'binary';
		if (line.startsWith('old mode ')) sawOldMode = true;
		else if (line.startsWith('new mode ')) sawNewMode = true;
		else if (line.startsWith('rename from ')) sawRename = true;
	}
	if (sawOldMode && sawNewMode) return 'mode';
	return sawRename ? 'rename' : 'empty';
}

export function parseRepositoryAgentSessionDiff(input: unknown): RepositoryAgentSessionDiff {
	if (!isRecord(input)) throw new Error('Agent session diff must be an object');
	const sessionId = readBoundedString(
		input,
		'sessionId',
		'Agent session diff sessionId',
		REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxIdentifierLength,
	);
	const rawPath = readBoundedString(
		input,
		'path',
		'Agent session diff path',
		REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxPathLength,
	);
	const path = normalizeRepositoryPath(rawPath);
	const additions = parseNonNegativeInteger(input.additions, 'additions');
	if (typeof additions === 'string') throw new Error(`Agent session diff ${additions}`);
	const deletions = parseNonNegativeInteger(input.deletions, 'deletions');
	if (typeof deletions === 'string') throw new Error(`Agent session diff ${deletions}`);
	if (typeof input.isBinary !== 'boolean') {
		throw new Error('Agent session diff isBinary must be a boolean');
	}
	if (!Array.isArray(input.contributingRunIds) || input.contributingRunIds.length === 0) {
		throw new Error('Agent session diff contributingRunIds must be a non-empty array');
	}
	if (input.contributingRunIds.length > REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxRuns) {
		throw new Error(
			`Agent session diff has ${input.contributingRunIds.length} runs; at most ${REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxRuns} are supported`,
		);
	}
	const contributingRunIds = input.contributingRunIds.map((runId, index) => {
		if (typeof runId !== 'string' || runId.length === 0) {
			throw new Error(`Agent session diff contributing run ${index + 1} is invalid`);
		}
		if (runId.length > REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxIdentifierLength) {
			throw new Error(`Agent session diff contributing run ${index + 1} is too long`);
		}
		return runId;
	});
	if (new Set(contributingRunIds).size !== contributingRunIds.length) {
		throw new Error('Agent session diff contributingRunIds must be unique');
	}
	if (!isRecord(input.net)) throw new Error('Agent session net diff must be an object');
	const beforeCommit = readBoundedString(
		input.net,
		'beforeCommit',
		'Agent session net diff beforeCommit',
		REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxCommitLength,
	);
	const afterCommit = readBoundedString(
		input.net,
		'afterCommit',
		'Agent session net diff afterCommit',
		REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxCommitLength,
	);
	const capturedAt = readBoundedString(
		input.net,
		'capturedAt',
		'Agent session net diff capturedAt',
		REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxCapturedAtLength,
	);
	if (typeof input.net.patch !== 'string') {
		throw new Error('Agent session net diff patch must be a string');
	}
	let totalPatchBytes = validateRepositoryAgentPatch(input.net.patch, sessionId);
	const turns = parseRepositoryAgentSessionTurns(input.turns, path, contributingRunIds);
	for (const turn of turns) totalPatchBytes += turn.patchBytes;
	if (totalPatchBytes > REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxTotalPatchBytes) {
		throw new Error(
			`Agent session diff ${sessionId} exceeds the ${REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxTotalPatchBytes}-byte limit`,
		);
	}

	const net: RepositoryAgentSessionNetDiff = {
		beforeCommit,
		afterCommit,
		capturedAt,
		diff: input.isBinary
			? null
			: renderRepositoryDiff({
					path,
					patch: input.net.patch,
					additions,
					deletions,
				}),
	};

	return {
		sessionId,
		path,
		additions,
		deletions,
		isBinary: input.isBinary,
		contributingRunIds,
		net,
		turns: turns.map(({ turn }) => turn),
	};
}

function parseRepositoryAgentSessionTurns(
	input: unknown,
	path: string,
	contributingRunIds: readonly string[],
): Array<{ turn: RepositoryAgentSessionTurnDiff; patchBytes: number }> {
	if (input === undefined) return [];
	if (!Array.isArray(input)) throw new Error('Agent session diff turns must be an array');
	if (input.length > contributingRunIds.length) {
		throw new Error('Agent session diff has more turns than contributing runs');
	}
	return input.map((raw: unknown, index) => {
		if (!isRecord(raw)) throw new Error(`Agent session diff turn ${index + 1} is invalid`);
		const runId = readBoundedString(
			raw,
			'runId',
			'Agent session diff turn runId',
			REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxIdentifierLength,
		);
		if (!contributingRunIds.includes(runId)) {
			throw new Error(`Agent session diff turn ${runId} is not a contributing run`);
		}
		const turn = parseNonNegativeInteger(raw.turn, 'turn');
		if (typeof turn === 'string' || turn === 0) {
			throw new Error(`Agent session diff turn ${index + 1} has no turn number`);
		}
		const title =
			raw.title === null
				? null
				: readBoundedString(
						raw,
						'title',
						'Agent session diff turn title',
						REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxIdentifierLength,
					);
		const additions = parseNonNegativeInteger(raw.additions, 'additions');
		if (typeof additions === 'string') throw new Error(`Agent session diff turn ${additions}`);
		const deletions = parseNonNegativeInteger(raw.deletions, 'deletions');
		if (typeof deletions === 'string') throw new Error(`Agent session diff turn ${deletions}`);
		if (typeof raw.isBinary !== 'boolean') {
			throw new Error('Agent session diff turn isBinary must be a boolean');
		}
		if (typeof raw.patch !== 'string') {
			throw new Error('Agent session diff turn patch must be a string');
		}
		const patchBytes = validateRepositoryAgentPatch(raw.patch, runId);
		return {
			patchBytes,
			turn: {
				runId,
				turn,
				title,
				beforeCommit: readBoundedString(
					raw,
					'beforeCommit',
					'Agent session diff turn beforeCommit',
					REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxCommitLength,
				),
				afterCommit: readBoundedString(
					raw,
					'afterCommit',
					'Agent session diff turn afterCommit',
					REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxCommitLength,
				),
				diff: raw.isBinary
					? null
					: renderRepositoryDiff({ path, patch: raw.patch, additions, deletions }),
			},
		};
	});
}

function readBoundedString(
	record: Record<string, unknown>,
	key: string,
	label: string,
	maxLength: number,
): string {
	const value = record[key];
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	if (value.length > maxLength) {
		throw new Error(`${label} exceeds the ${maxLength}-character limit`);
	}
	return value;
}

function validateRepositoryAgentPatch(patch: string, runId: string): number {
	if (patch.length > REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxPatchBytes) {
		throw new Error(
			`Agent session diff run ${runId} patch exceeds the ${REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxPatchBytes}-byte limit`,
		);
	}
	const patchBytes = new TextEncoder().encode(patch).byteLength;
	if (patchBytes > REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxPatchBytes) {
		throw new Error(
			`Agent session diff run ${runId} patch exceeds the ${REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxPatchBytes}-byte limit`,
		);
	}
	let lineCount = patch.length === 0 ? 0 : 1;
	for (let index = patch.indexOf('\n'); index !== -1; index = patch.indexOf('\n', index + 1)) {
		lineCount += 1;
		if (lineCount > REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxPatchLines) {
			throw new Error(
				`Agent session diff run ${runId} patch exceeds the ${REPOSITORY_AGENT_SESSION_DIFF_LIMITS.maxPatchLines}-line rendering limit`,
			);
		}
	}
	return patchBytes;
}

export function normalizeRepositoryPath(path: string): string {
	const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '');
	if (
		normalized.length === 0 ||
		normalized.startsWith('/') ||
		normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
	) {
		throw new Error(`Invalid repository-relative path: ${path}`);
	}
	return normalized;
}

function buildLcsTable(
	before: readonly string[],
	after: readonly string[],
): readonly (readonly number[])[] {
	const table = Array.from({ length: before.length + 1 }, () =>
		Array.from({ length: after.length + 1 }, () => 0),
	);
	for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
		for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
			table[beforeIndex]![afterIndex] =
				before[beforeIndex] === after[afterIndex]
					? 1 + getScore(table, beforeIndex + 1, afterIndex + 1)
					: Math.max(
							getScore(table, beforeIndex + 1, afterIndex),
							getScore(table, beforeIndex, afterIndex + 1),
						);
		}
	}
	return table;
}

function getScore(table: readonly (readonly number[])[], row: number, column: number): number {
	return table[row]?.[column] ?? 0;
}

function splitLines(value: string): readonly string[] {
	return value === '' ? [] : value.replaceAll('\r\n', '\n').split('\n');
}

function parsePullRequest(input: unknown): ExtensionPullRequestContext | null | string {
	if (input === undefined || input === null) return null;
	if (!isRecord(input)) return 'pullRequest must be an object or null';
	if (!isPullRequestState(input.state)) {
		return 'pullRequest.state is invalid';
	}
	if (input.number !== null && (!Number.isInteger(input.number) || Number(input.number) < 1)) {
		return 'pullRequest.number must be a positive integer or null';
	}
	if (input.title !== null && typeof input.title !== 'string') {
		return 'pullRequest.title must be a string or null';
	}
	if (input.url !== null && typeof input.url !== 'string') {
		return 'pullRequest.url must be a string or null';
	}
	const baseBranch = readRequiredString(input, ['baseBranch']);
	if (!baseBranch) return 'pullRequest.baseBranch must be a non-empty string';
	const headBranch = readRequiredString(input, ['headBranch']);
	if (!headBranch) return 'pullRequest.headBranch must be a non-empty string';
	if (input.headSha !== undefined && input.headSha !== null && typeof input.headSha !== 'string') {
		return 'pullRequest.headSha must be a string or null';
	}
	if (
		input.mergeable !== undefined &&
		input.mergeable !== null &&
		typeof input.mergeable !== 'boolean'
	) {
		return 'pullRequest.mergeable must be a boolean or null';
	}
	if (
		input.mergeableState !== undefined &&
		input.mergeableState !== null &&
		typeof input.mergeableState !== 'string'
	) {
		return 'pullRequest.mergeableState must be a string or null';
	}
	if (!isPullRequestChecksState(input.checks)) {
		return 'pullRequest.checks is invalid';
	}
	const checkItems = parsePullRequestChecks(input.checkItems);
	if (typeof checkItems === 'string') return checkItems;
	if (
		input.viewerCanMerge !== undefined &&
		input.viewerCanMerge !== null &&
		typeof input.viewerCanMerge !== 'boolean'
	) {
		return 'pullRequest.viewerCanMerge must be a boolean or null';
	}
	const allowedMergeMethods = parseMergeMethods(input.allowedMergeMethods);
	if (typeof allowedMergeMethods === 'string') return allowedMergeMethods;
	const defaultMergeMethod = input.defaultMergeMethod;
	if (
		defaultMergeMethod !== undefined &&
		defaultMergeMethod !== null &&
		!isMergeMethod(defaultMergeMethod)
	) {
		return 'pullRequest.defaultMergeMethod is invalid';
	}
	const reviewDecision = input.reviewDecision;
	if (
		reviewDecision !== undefined &&
		reviewDecision !== null &&
		!isPullRequestReviewDecision(reviewDecision)
	) {
		return 'pullRequest.reviewDecision is invalid';
	}
	if (
		input.unresolvedReviewThreadCount !== undefined &&
		input.unresolvedReviewThreadCount !== null &&
		(!Number.isSafeInteger(input.unresolvedReviewThreadCount) ||
			Number(input.unresolvedReviewThreadCount) < 0)
	) {
		return 'pullRequest.unresolvedReviewThreadCount must be a non-negative integer or null';
	}
	return {
		state: input.state,
		number: input.number as number | null,
		title: input.title as string | null,
		url: input.url as string | null,
		baseBranch,
		headBranch,
		headSha: typeof input.headSha === 'string' ? input.headSha : null,
		mergeable: typeof input.mergeable === 'boolean' ? input.mergeable : null,
		mergeableState: typeof input.mergeableState === 'string' ? input.mergeableState : null,
		checks: input.checks,
		...(checkItems === undefined ? {} : { checkItems }),
		...(input.viewerCanMerge === undefined
			? {}
			: { viewerCanMerge: input.viewerCanMerge as boolean | null }),
		...(allowedMergeMethods === undefined ? {} : { allowedMergeMethods }),
		...(defaultMergeMethod === undefined ? {} : { defaultMergeMethod }),
		...(reviewDecision === undefined ? {} : { reviewDecision }),
		...(input.unresolvedReviewThreadCount === undefined
			? {}
			: {
					unresolvedReviewThreadCount: input.unresolvedReviewThreadCount as number | null,
				}),
	};
}

function parsePullRequestChecks(
	input: unknown,
): readonly ExtensionPullRequestCheck[] | undefined | string {
	if (input === undefined) return undefined;
	if (!Array.isArray(input)) return 'pullRequest.checkItems must be an array';
	const checks: ExtensionPullRequestCheck[] = [];
	for (const value of input) {
		if (!isRecord(value)) return 'pullRequest.checkItems must contain objects';
		if (typeof value.name !== 'string' || value.name.trim() === '') {
			return 'pullRequest.checkItems.name must be a non-empty string';
		}
		if (value.appId !== null && (!Number.isSafeInteger(value.appId) || Number(value.appId) < 1)) {
			return 'pullRequest.checkItems.appId must be a positive integer or null';
		}
		if (typeof value.state !== 'string' || value.state.trim() === '') {
			return 'pullRequest.checkItems.state must be a non-empty string';
		}
		if (value.conclusion !== null && typeof value.conclusion !== 'string') {
			return 'pullRequest.checkItems.conclusion must be a string or null';
		}
		if (value.required !== null && typeof value.required !== 'boolean') {
			return 'pullRequest.checkItems.required must be a boolean or null';
		}
		if (value.url !== null && typeof value.url !== 'string') {
			return 'pullRequest.checkItems.url must be a string or null';
		}
		if (value.startedAt !== null && typeof value.startedAt !== 'string') {
			return 'pullRequest.checkItems.startedAt must be a string or null';
		}
		if (value.completedAt !== null && typeof value.completedAt !== 'string') {
			return 'pullRequest.checkItems.completedAt must be a string or null';
		}
		if (
			value.notStartedReason !== undefined &&
			value.notStartedReason !== null &&
			typeof value.notStartedReason !== 'string'
		) {
			return 'pullRequest.checkItems.notStartedReason must be a string or null';
		}
		checks.push({
			name: value.name,
			appId: value.appId as number | null,
			state: value.state,
			conclusion: value.conclusion as string | null,
			required: value.required as boolean | null,
			url: value.url as string | null,
			startedAt: value.startedAt as string | null,
			completedAt: value.completedAt as string | null,
			...(typeof value.notStartedReason === 'string'
				? { notStartedReason: value.notStartedReason }
				: {}),
		});
	}
	return checks;
}

function parseMergeMethods(
	input: unknown,
): readonly ExtensionPullRequestMergeMethod[] | undefined | string {
	if (input === undefined) return undefined;
	if (!Array.isArray(input) || !input.every(isMergeMethod)) {
		return 'pullRequest.allowedMergeMethods is invalid';
	}
	return [...new Set(input)];
}

function isMergeMethod(input: unknown): input is ExtensionPullRequestMergeMethod {
	return input === 'merge' || input === 'squash' || input === 'rebase';
}

const PULL_REQUEST_STATES: ReadonlySet<string> = new Set([
	'not_open',
	'draft',
	'open',
	'merged',
	'closed',
	'unavailable',
]);

function isPullRequestState(input: unknown): input is ExtensionPullRequestContext['state'] {
	return typeof input === 'string' && PULL_REQUEST_STATES.has(input);
}

const PULL_REQUEST_CHECKS_STATES: ReadonlySet<string> = new Set([
	'none',
	'unknown',
	'pending',
	'success',
	'failed',
]);

function isPullRequestChecksState(input: unknown): input is ExtensionPullRequestContext['checks'] {
	return typeof input === 'string' && PULL_REQUEST_CHECKS_STATES.has(input);
}

const PULL_REQUEST_REVIEW_DECISIONS: ReadonlySet<string> = new Set([
	'approved',
	'changes_requested',
	'review_required',
]);

function isPullRequestReviewDecision(
	input: unknown,
): input is NonNullable<ExtensionPullRequestContext['reviewDecision']> {
	return typeof input === 'string' && PULL_REQUEST_REVIEW_DECISIONS.has(input);
}

function clonePullRequest(pullRequest: ExtensionPullRequestContext): ExtensionPullRequestContext {
	return {
		...pullRequest,
		...(pullRequest.checkItems
			? { checkItems: pullRequest.checkItems.map((check) => ({ ...check })) }
			: {}),
		...(pullRequest.allowedMergeMethods
			? { allowedMergeMethods: [...pullRequest.allowedMergeMethods] }
			: {}),
	};
}

const REPOSITORY_OPERATIONS: readonly ExtensionRepositoryOperation[] = [
	'merge',
	'rebase',
	'cherry-pick',
	'revert',
];

function parseOperation(input: unknown): ExtensionRepositoryOperation | null | undefined {
	if (input === undefined || input === null) return null;
	return REPOSITORY_OPERATIONS.find((operation) => operation === input);
}

function parseDirtyPaths(input: unknown): readonly string[] | string {
	if (input === undefined) return [];
	if (!Array.isArray(input) || !input.every((path) => typeof path === 'string')) {
		return 'dirtyPaths must be an array of repository-relative paths';
	}
	try {
		return input.map((path) => normalizeRepositoryPath(path));
	} catch {
		return 'dirtyPaths must contain only repository-relative paths';
	}
}

function parseNonNegativeInteger(input: unknown, name: string): number | string {
	if (input === undefined) return 0;
	if (!Number.isSafeInteger(input) || Number(input) < 0) {
		return `${name} must be a non-negative integer`;
	}
	return Number(input);
}

function readRequiredString(
	record: Record<string, unknown>,
	keys: readonly string[],
): string | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === 'string' && value.trim() !== '') return value;
	}
	return null;
}

function invalid(error: string): RepositoryContextResult {
	return { ok: false, error: `Malformed repository context: ${error}` };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
