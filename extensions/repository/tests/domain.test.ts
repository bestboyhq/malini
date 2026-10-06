import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createFileList,
	isGitInternalPath,
	parseRepositoryAgentSessionDiff,
	parseDiffRequest,
	parseRepositoryContext,
	pullRequestChecksAllowMerge,
	pullRequestBlockingChecks,
	pullRequestHasReviewBlockers,
	pullRequestMergeReadiness,
	pullRequestReviewStatusUnavailable,
	repositoryGithubSession,
	selectPullRequestMergeMethod,
	renderLineDiff,
	renderRepositoryDiff,
	repositoryFileMatches,
} from '../src/domain.js';
import { highlightFileLines, highlightLine, languageForPath } from '../src/code-tokens.js';

test('normalizes, filters, deduplicates, and describes repository files', () => {
	assert.deepEqual(
		createFileList(
			['src\\index.ts', './README.md', 'src/index.ts', '.env', 'src/.cache/value'],
			false,
		),
		[
			{ path: 'README.md', name: 'README.md', directory: '', extension: 'md' },
			{ path: 'src/index.ts', name: 'index.ts', directory: 'src', extension: 'ts' },
		],
	);
	assert.deepEqual(
		createFileList(['.env', 'src/.cache/value'], true).map(({ path }) => path),
		['.env', 'src/.cache/value'],
	);
	assert.throws(() => createFileList(['../secret'], true), /Invalid repository-relative path/u);
});

test('resolves a file named by its path, by its name, or by the end of its path', () => {
	const files = createFileList(
		[
			'remote.ts',
			'src/git/remote.ts',
			'src/git/credentials.ts',
			'packages/a/index.ts',
			'packages/b/index.ts',
		],
		false,
	);

	assert.deepEqual(repositoryFileMatches(files, 'remote.ts'), ['remote.ts']);
	assert.deepEqual(repositoryFileMatches(files, 'credentials.ts'), ['src/git/credentials.ts']);
	assert.deepEqual(repositoryFileMatches(files, 'git/credentials.ts'), ['src/git/credentials.ts']);
	assert.deepEqual(repositoryFileMatches(files, 'index.ts'), [
		'packages/a/index.ts',
		'packages/b/index.ts',
	]);
	assert.deepEqual(repositoryFileMatches(files, 'ote.ts'), []);
	assert.deepEqual(repositoryFileMatches(files, 'it/remote.ts'), []);
});

test('names the git directory and anything inside it as git internals', () => {
	assert.equal(isGitInternalPath('.git'), true);
	assert.equal(isGitInternalPath('.git/config'), true);
	assert.equal(isGitInternalPath('vendor/lib/.git/HEAD'), true);
	assert.equal(isGitInternalPath('.github/workflows/ci.yml'), false);
	assert.equal(isGitInternalPath('.gitignore'), false);
});

test('renders stable line-level changes and exact counts', () => {
	const diff = renderLineDiff({
		path: 'src/value.ts',
		before: 'alpha\nbeta\ngamma',
		after: 'alpha\nupdated\ngamma\nomega',
	});
	assert.equal(diff.additions, 2);
	assert.equal(diff.deletions, 1);
	assert.deepEqual(
		diff.lines.map(({ kind, text }) => [kind, text]),
		[
			['context', 'alpha'],
			['deletion', 'beta'],
			['addition', 'updated'],
			['context', 'gamma'],
			['addition', 'omega'],
		],
	);
});

test('renders a host-provided unified patch without recomputing authoritative counts', () => {
	const diff = renderRepositoryDiff({
		path: 'src/value.ts',
		patch: '@@ -4,2 +4,2 @@\n-old\n+new\n context',
		additions: 1,
		deletions: 1,
	});
	assert.deepEqual(diff.lines, [
		{ kind: 'deletion', oldLine: 4, newLine: null, text: 'old' },
		{ kind: 'addition', oldLine: null, newLine: 4, text: 'new' },
		{ kind: 'context', oldLine: 5, newLine: 5, text: 'context' },
	]);
	assert.equal(diff.additions, 1);
	assert.equal(diff.deletions, 1);
	assert.equal(diff.noLineChange, null);
});

function gitPatch(...lines: readonly string[]): string {
	return `${lines.join('\n')}\n`;
}

test('reads every line of a patch from its hunks, never from the preamble above them', () => {
	const added = renderRepositoryDiff({
		path: 'PARITY-CHECK.md',
		patch: gitPatch(
			'diff --git a/PARITY-CHECK.md b/PARITY-CHECK.md',
			'new file mode 100644',
			'index 00000000..891b3267',
			'--- /dev/null',
			'+++ b/PARITY-CHECK.md',
			'@@ -0,0 +1 @@',
			'+parity e2e run',
		),
		additions: 1,
		deletions: 0,
	});
	assert.deepEqual(added.lines, [
		{ kind: 'addition', oldLine: null, newLine: 1, text: 'parity e2e run' },
	]);

	const deleted = renderRepositoryDiff({
		path: 'gone.txt',
		patch: gitPatch(
			'diff --git a/gone.txt b/gone.txt',
			'deleted file mode 100644',
			'index 290a7fd0..00000000',
			'--- a/gone.txt',
			'+++ /dev/null',
			'@@ -1,2 +0,0 @@',
			'-to be deleted',
			'-second line',
		),
		additions: 0,
		deletions: 2,
	});
	assert.deepEqual(deleted.lines, [
		{ kind: 'deletion', oldLine: 1, newLine: null, text: 'to be deleted' },
		{ kind: 'deletion', oldLine: 2, newLine: null, text: 'second line' },
	]);

	const modified = renderRepositoryDiff({
		path: 'many.txt',
		patch: gitPatch(
			'diff --git a/many.txt b/many.txt',
			'index 68745ba1..7e22d2a9 100644',
			'--- a/many.txt',
			'+++ b/many.txt',
			'@@ -1,3 +1,3 @@',
			' alpha',
			'-beta',
			'+BETA',
			' gamma',
			'@@ -17,3 +17,3 @@ pi',
			' tau',
			'-upsilon',
			'+UPSILON',
			' phi',
		),
		additions: 2,
		deletions: 2,
	});
	assert.deepEqual(modified.lines, [
		{ kind: 'context', oldLine: 1, newLine: 1, text: 'alpha' },
		{ kind: 'deletion', oldLine: 2, newLine: null, text: 'beta' },
		{ kind: 'addition', oldLine: null, newLine: 2, text: 'BETA' },
		{ kind: 'context', oldLine: 3, newLine: 3, text: 'gamma' },
		{ kind: 'context', oldLine: 17, newLine: 17, text: 'tau' },
		{ kind: 'deletion', oldLine: 18, newLine: null, text: 'upsilon' },
		{ kind: 'addition', oldLine: null, newLine: 18, text: 'UPSILON' },
		{ kind: 'context', oldLine: 19, newLine: 19, text: 'phi' },
	]);

	const renamed = renderRepositoryDiff({
		path: 'src/new-name.ts',
		patch: gitPatch(
			'diff --git a/src/old-name.ts b/src/new-name.ts',
			'similarity index 87%',
			'rename from src/old-name.ts',
			'rename to src/new-name.ts',
			'index 3b18e510..a1b2c3d4 100644',
			'--- a/src/old-name.ts',
			'+++ b/src/new-name.ts',
			'@@ -4,2 +4,2 @@ export function value() {',
			'-const before = 1;',
			'+const after = 2;',
			' return before;',
		),
		additions: 1,
		deletions: 1,
	});
	assert.deepEqual(renamed.lines, [
		{ kind: 'deletion', oldLine: 4, newLine: null, text: 'const before = 1;' },
		{ kind: 'addition', oldLine: null, newLine: 4, text: 'const after = 2;' },
		{ kind: 'context', oldLine: 5, newLine: 5, text: 'return before;' },
	]);

	const unterminated = renderRepositoryDiff({
		path: 'PARITY-CHECK.md',
		patch: gitPatch(
			'diff --git a/PARITY-CHECK.md b/PARITY-CHECK.md',
			'new file mode 100644',
			'index 00000000..891b3267',
			'--- /dev/null',
			'+++ b/PARITY-CHECK.md',
			'@@ -0,0 +1 @@',
			'+parity e2e run',
			'\\ No newline at end of file',
		),
		additions: 1,
		deletions: 0,
	});
	assert.deepEqual(unterminated.lines, [
		{ kind: 'addition', oldLine: null, newLine: 1, text: 'parity e2e run' },
	]);
});

test('says why a patch has no line delta rather than reporting zero and zero', () => {
	const binary = renderRepositoryDiff({
		path: 'assets/logo.png',
		patch: gitPatch(
			'diff --git a/assets/logo.png b/assets/logo.png',
			'index 67357440..b036c4a1 100644',
			'Binary files a/assets/logo.png and b/assets/logo.png differ',
		),
		additions: 0,
		deletions: 0,
	});
	assert.equal(binary.noLineChange, 'binary');
	assert.deepEqual(binary.lines, []);

	const mode = renderRepositoryDiff({
		path: 'scripts/run.sh',
		patch: gitPatch(
			'diff --git a/scripts/run.sh b/scripts/run.sh',
			'old mode 100644',
			'new mode 100755',
		),
		additions: 0,
		deletions: 0,
	});
	assert.equal(mode.noLineChange, 'mode');
	assert.deepEqual(mode.lines, []);

	const renamed = renderRepositoryDiff({
		path: 'src/new-name.ts',
		patch: gitPatch(
			'diff --git a/src/old-name.ts b/src/new-name.ts',
			'similarity index 100%',
			'rename from src/old-name.ts',
			'rename to src/new-name.ts',
		),
		additions: 0,
		deletions: 0,
	});
	assert.equal(renamed.noLineChange, 'rename');
	assert.deepEqual(renamed.lines, []);

	const empty = renderRepositoryDiff({
		path: 'src/blank.ts',
		patch: '',
		additions: 0,
		deletions: 0,
	});
	assert.equal(empty.noLineChange, 'empty');
	assert.deepEqual(empty.lines, []);
});

test('rejects malformed diff requests before touching repository state', () => {
	assert.throws(() => parseDiffRequest({ path: '../escape', before: '', after: '' }), /Invalid/u);
	assert.throws(() => parseDiffRequest({ path: 'valid.ts', before: 1, after: '' }), /before/u);
});

test('parses one path-scoped net chat patch without mixing it with live repository state', () => {
	const sessionDiff = parseRepositoryAgentSessionDiff({
		sessionId: 'session-1',
		path: 'src/value.ts',
		additions: 3,
		deletions: 1,
		isBinary: false,
		contributingRunIds: ['run-1', 'run-2'],
		net: {
			beforeCommit: '1111111',
			afterCommit: '4444444',
			capturedAt: '2026-07-22T08:05:00Z',
			patch:
				'diff --git a/src/value.ts b/src/value.ts\n--- a/src/value.ts\n+++ b/src/value.ts\n@@ -1,2 +1,3 @@\n-old\n+new\n+second\n first',
		},
	});

	assert.equal(sessionDiff.path, 'src/value.ts');
	assert.deepEqual(sessionDiff.contributingRunIds, ['run-1', 'run-2']);
	assert.deepEqual(
		sessionDiff.net.diff?.lines
			.filter(({ kind }) => kind !== 'context')
			.map(({ kind, text }) => [kind, text]),
		[
			['deletion', 'old'],
			['addition', 'new'],
			['addition', 'second'],
		],
	);
	assert.throws(
		() => parseRepositoryAgentSessionDiff({ ...sessionDiff, path: '../outside.ts' }),
		/Invalid repository-relative path/u,
	);
});

test('parses per-turn chat patches for a file the chat could not compose', () => {
	const sessionDiff = parseRepositoryAgentSessionDiff({
		sessionId: 'session-1',
		path: 'notes.txt',
		additions: 2,
		deletions: 1,
		isBinary: false,
		contributingRunIds: ['run-1', 'run-2'],
		net: {
			beforeCommit: '1111111',
			afterCommit: '4444444',
			capturedAt: '2026-07-22T08:05:00Z',
			patch: '',
		},
		turns: [
			{
				runId: 'run-1',
				turn: 1,
				title: 'Write the notes',
				beforeCommit: '1111111',
				afterCommit: '2222222',
				additions: 1,
				deletions: 0,
				isBinary: false,
				patch: '@@ -0,0 +1 @@\n+agent one',
			},
			{
				runId: 'run-2',
				turn: 2,
				title: null,
				beforeCommit: '3333333',
				afterCommit: '4444444',
				additions: 1,
				deletions: 1,
				isBinary: false,
				patch: '@@ -1 +1 @@\n-written by hand\n+agent two',
			},
		],
	});

	assert.deepEqual(
		sessionDiff.turns.map(({ turn, title, diff }) => [
			turn,
			title,
			diff?.lines.map(({ kind, oldLine, newLine, text }) => [kind, oldLine, newLine, text]),
		]),
		[
			[1, 'Write the notes', [['addition', null, 1, 'agent one']]],
			[
				2,
				null,
				[
					['deletion', 1, null, 'written by hand'],
					['addition', null, 1, 'agent two'],
				],
			],
		],
	);
	assert.throws(
		() =>
			parseRepositoryAgentSessionDiff({
				sessionId: 'session-1',
				path: 'notes.txt',
				additions: 1,
				deletions: 0,
				isBinary: false,
				contributingRunIds: ['run-1'],
				net: { beforeCommit: '1', afterCommit: '2', capturedAt: 'now', patch: '' },
				turns: [
					{
						runId: 'run-9',
						turn: 1,
						title: null,
						beforeCommit: '1',
						afterCommit: '2',
						additions: 1,
						deletions: 0,
						isBinary: false,
						patch: '',
					},
				],
			}),
		/is not a contributing run/u,
	);
});

test('rejects excessive agent diff fan-out and payloads before rendering', () => {
	const net = {
		beforeCommit: '1111111',
		afterCommit: '2222222',
		capturedAt: '2026-07-22T08:00:00Z',
		patch: '@@ -1 +1 @@\n-old\n+new',
	};
	const input = {
		sessionId: 'session-1',
		path: 'src/value.ts',
		additions: 1,
		deletions: 0,
		isBinary: false,
		contributingRunIds: ['run-1'],
		net,
	};

	assert.throws(
		() =>
			parseRepositoryAgentSessionDiff({
				...input,
				contributingRunIds: Array.from({ length: 65 }, (_, index) => `run-${index}`),
			}),
		/at most 64 are supported/u,
	);
	assert.throws(
		() =>
			parseRepositoryAgentSessionDiff({
				...input,
				net: { ...net, patch: 'x'.repeat(2 * 1024 * 1024 + 1) },
			}),
		/exceeds the 2097152-byte limit/u,
	);
	assert.throws(
		() => parseRepositoryAgentSessionDiff({ ...input, sessionId: 's'.repeat(257) }),
		/exceeds the 256-character limit/u,
	);
});

test('paints a diff line with the app-wide lexer, not a panel-local one', () => {
	const tokens = highlightLine(
		'src/value.ts',
		'export const answer: Result = compute("forty-two"); // stable',
	);
	const painted = tokens.filter(({ kind }) => kind !== 'plain' && kind !== 'punctuation');
	assert.deepEqual(
		painted.map(({ kind, text }) => [kind, text]),
		[
			['keyword', 'export'],
			['keyword', 'const'],
			['type', 'Result'],
			['function', 'compute'],
			['string', '"forty-two"'],
			['comment', '// stable'],
		],
	);
});

test('cuts a file into lines after tokenizing it, so a block comment survives', () => {
	const lines = highlightFileLines('src/value.ts', '/* one\n   two */\nconst a = 1;\n');
	assert.equal(lines.length, 4);
	assert.deepEqual(
		lines[0]?.map(({ kind }) => kind),
		['comment'],
	);
	assert.deepEqual(
		lines[1]?.map(({ kind }) => kind),
		['comment'],
	);
	assert.equal(lines[2]?.find(({ text }) => text === 'const')?.kind, 'keyword');
});

test('reads the language from a path, and says nothing about a dotfile', () => {
	assert.equal(languageForPath('src/main.rs'), 'rust');
	assert.equal(languageForPath('apps/a/vite.config.mts'), 'typescript');
	assert.equal(languageForPath('.gitignore'), null);
	assert.equal(languageForPath('Makefile'), null);
});

test('parses workstream and pull request context without accepting partial records', () => {
	assert.deepEqual(
		parseRepositoryContext({
			id: 'workstream-2',
			repositoryPath: '/tmp/repository',
			branch: 'feature/repository',
			baseBranch: 'main',
			pullRequest: {
				number: 42,
				title: 'Repository panels',
				url: 'https://example.test/pull/42',
				state: 'open',
				baseBranch: 'main',
				headBranch: 'feature/repository',
				headSha: 'head-42',
				mergeable: true,
				mergeableState: 'clean',
				checks: 'success',
				checkItems: [
					{
						name: 'Unit tests',
						appId: 15_368,
						state: 'completed',
						conclusion: 'success',
						required: true,
						url: 'https://example.test/check/42',
						startedAt: '2026-07-22T08:00:00Z',
						completedAt: '2026-07-22T08:01:00Z',
					},
				],
			},
		}),
		{
			ok: true,
			context: {
				workstreamId: 'workstream-2',
				repositoryPath: '/tmp/repository',
				branch: 'feature/repository',
				baseBranch: 'main',
				dirtyPaths: [],
				conflictedPaths: [],
				conflictMarkerPaths: [],
				ahead: 0,
				behind: 0,
				hasUpstream: true,
				mergeInProgress: false,
				operationInProgress: null,
				pullRequest: {
					number: 42,
					title: 'Repository panels',
					url: 'https://example.test/pull/42',
					state: 'open',
					baseBranch: 'main',
					headBranch: 'feature/repository',
					headSha: 'head-42',
					mergeable: true,
					mergeableState: 'clean',
					checks: 'success',
					checkItems: [
						{
							name: 'Unit tests',
							appId: 15_368,
							state: 'completed',
							conclusion: 'success',
							required: true,
							url: 'https://example.test/check/42',
							startedAt: '2026-07-22T08:00:00Z',
							completedAt: '2026-07-22T08:01:00Z',
						},
					],
				},
			},
		},
	);
	assert.deepEqual(parseRepositoryContext({ branch: 'main' }), {
		ok: false,
		error: 'Malformed repository context: workstreamId must be a non-empty string',
	});
});

test('reads the operation a worktree holds and refuses one it does not know', () => {
	const context = {
		workstreamId: 'workstream-2',
		repositoryPath: '/tmp/repository',
		branch: 'feature/repository',
		baseBranch: 'main',
	};
	const parsed = parseRepositoryContext({ ...context, operationInProgress: 'cherry-pick' });
	assert.equal(parsed.ok && parsed.context.operationInProgress, 'cherry-pick');
	assert.deepEqual(parseRepositoryContext({ ...context, operationInProgress: 'bisect' }), {
		ok: false,
		error:
			'Malformed repository context: operationInProgress must be merge, rebase, cherry-pick, revert or null',
	});
});

test('allows successful or genuinely absent checks but not uncertain checks', () => {
	assert.equal(pullRequestChecksAllowMerge('success'), true);
	assert.equal(pullRequestChecksAllowMerge('none'), true);
	assert.equal(pullRequestChecksAllowMerge('pending'), false);
	assert.equal(pullRequestChecksAllowMerge('failed'), false);
	assert.equal(pullRequestChecksAllowMerge('unknown'), false);
});

test('gates on detailed required checks while optional failures remain visible but non-blocking', () => {
	const optionalFailure = {
		name: 'Preview deploy',
		appId: 15_368,
		state: 'completed',
		conclusion: 'failure',
		required: false,
		url: 'https://example.test/check/preview',
		startedAt: '2026-07-22T08:00:00Z',
		completedAt: '2026-07-22T08:01:00Z',
	} as const;
	const requiredSuccess = {
		...optionalFailure,
		name: 'Unit tests',
		required: true,
		conclusion: 'success',
	} as const;
	assert.equal(pullRequestChecksAllowMerge('failed', [optionalFailure, requiredSuccess]), true);
	assert.equal(
		pullRequestChecksAllowMerge('unknown', [requiredSuccess]),
		false,
		'partial successful rows must not override an unknown aggregate gate',
	);
	const unknownRequirednessPending = {
		...optionalFailure,
		name: 'Policy',
		state: 'queued',
		conclusion: null,
		required: null,
	} as const;
	assert.deepEqual(pullRequestBlockingChecks([optionalFailure, unknownRequirednessPending]), [
		unknownRequirednessPending,
	]);
	assert.equal(
		pullRequestChecksAllowMerge('success', [optionalFailure, unknownRequirednessPending]),
		false,
	);
});

test('selects only enabled merge methods and distinguishes review blockers from unavailable reads', () => {
	const pullRequest = {
		state: 'open' as const,
		number: 42,
		title: 'Ship it',
		url: 'https://example.test/pull/42',
		baseBranch: 'main',
		headBranch: 'feature/repository',
		headSha: 'head-42',
		checks: 'success' as const,
		allowedMergeMethods: ['squash', 'rebase'] as const,
		defaultMergeMethod: 'rebase' as const,
	};
	assert.equal(selectPullRequestMergeMethod(pullRequest), 'rebase');
	assert.equal(selectPullRequestMergeMethod(pullRequest, 'squash'), 'squash');
	assert.equal(selectPullRequestMergeMethod(pullRequest, 'merge'), 'rebase');
	assert.equal(pullRequestHasReviewBlockers(pullRequest), false);
	assert.equal(
		pullRequestHasReviewBlockers({ ...pullRequest, reviewDecision: 'changes_requested' }),
		true,
	);
	assert.equal(
		pullRequestReviewStatusUnavailable({ ...pullRequest, unresolvedReviewThreadCount: null }),
		true,
	);
	assert.equal(
		pullRequestReviewStatusUnavailable({ ...pullRequest, unresolvedReviewThreadCount: 0 }),
		false,
	);
	assert.equal(pullRequestReviewStatusUnavailable(pullRequest), false);
});

test('treats GitHub behind, blocked, and pending mergeability as non-mergeable', () => {
	const pullRequest = {
		state: 'open' as const,
		number: 42,
		title: 'Ship it',
		url: 'https://example.test/pull/42',
		baseBranch: 'main',
		headBranch: 'feature/repository',
		headSha: 'head-42',
		checks: 'success' as const,
	};
	assert.equal(
		pullRequestMergeReadiness({ ...pullRequest, mergeable: true, mergeableState: 'clean' }),
		'ready',
	);
	assert.equal(
		pullRequestMergeReadiness({ ...pullRequest, mergeable: true, mergeableState: 'behind' }),
		'behind',
	);
	assert.equal(
		pullRequestMergeReadiness({ ...pullRequest, mergeable: true, mergeableState: 'blocked' }),
		'blocked',
	);
	assert.equal(
		pullRequestMergeReadiness({ ...pullRequest, mergeable: null, mergeableState: 'unknown' }),
		'checking',
	);
	assert.equal(
		pullRequestMergeReadiness({
			...pullRequest,
			mergeable: true,
			mergeableState: 'future_readyish_state',
		}),
		'checking',
	);
	for (const mergeableState of ['has_hooks', 'unstable']) {
		assert.equal(
			pullRequestMergeReadiness({ ...pullRequest, mergeable: true, mergeableState }),
			'ready',
		);
	}
});

test('reads a finished GitHub session apart from a failed read', () => {
	const live =
		'API request failed: POST /api/auth/github/refresh 502: {"message":"GitHub OAuth refresh failed: The client_id and/or client_secret passed are incorrect.","error":"Bad Gateway","statusCode":502}';
	for (const finished of [
		live,
		'The client_id and/or client_secret passed are incorrect.',
		'GitHub OAuth refresh failed',
		'GitHub authorization expired. Continue with GitHub again to refresh repository access.',
		'Unauthorized: Bad credentials',
		'refresh failed: bad_refresh_token',
		'bad_verification_code',
		'invalid_grant',
		'expired_token',
	]) {
		assert.equal(repositoryGithubSession(finished), 'reconnect-required');
	}

	for (const transient of [
		'checks endpoint failed',
		'git status failed',
		'Request timed out after 30000ms',
		'API request failed: POST /api/auth/github/refresh 502: {"message":"upstream unavailable","statusCode":502}',
		'API request failed: GET /api/github/repositories 500',
	]) {
		assert.equal(repositoryGithubSession(transient), 'usable');
	}
});

test('takes the verdict from whichever error slot the host filled', () => {
	assert.equal(repositoryGithubSession(), 'usable');
	assert.equal(repositoryGithubSession(null, undefined, '   '), 'usable');
	assert.equal(
		repositoryGithubSession(null, 'GitHub OAuth refresh failed', null),
		'reconnect-required',
	);
	assert.equal(
		repositoryGithubSession('git status failed', null, 'Unauthorized: Bad credentials'),
		'reconnect-required',
	);
	assert.equal(repositoryGithubSession('unauthorized: bad credentials'), 'reconnect-required');
});
