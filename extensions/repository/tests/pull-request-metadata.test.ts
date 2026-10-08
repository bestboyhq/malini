import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AUTOMATED_PULL_REQUEST_METADATA_LIMITS,
	automatedPullRequestMetadata,
} from '../src/pull-request-metadata.js';

test('never publishes an absolute path: workstream paths turn relative, others shrink to a name', () => {
	const workstreamPath = '/Users/someone/Library/Application Support/malini/workstreams/01ABC';
	const metadata = automatedPullRequestMetadata({
		branch: 'malini/01ABC',
		baseBranch: 'main',
		workstreamPath,
		changedPaths: [`${workstreamPath}/src/a.ts`, 'src/b.ts'],
		context: {
			runSummaries: [
				`Saved the plan to /Users/someone/.claude/plans/plan.md and ${workstreamPath}/docs/x.md`,
			],
			events: [
				{
					kind: 'validation',
					status: 'passed',
					label: `cd "${workstreamPath}" && corepack pnpm check`,
				},
				{
					kind: 'validation',
					status: 'passed',
					label: `cd "${workstreamPath}/packages/agent-bridge" && npx vitest run`,
				},
				{
					kind: 'validation',
					status: 'passed',
					label: 'node /tmp/probe/build.mjs --check 2>/dev/null',
				},
			],
		},
	});

	const published = `${metadata.title}\n${metadata.commitMessage}\n${metadata.body}`;
	assert.doesNotMatch(published, /\/Users|someone|Application Support|\/tmp/u);
	assert.match(metadata.body, /Passed - Validation: corepack pnpm check$/mu);
	assert.match(
		metadata.body,
		/Passed - Validation: cd "packages\/agent-bridge" && npx vitest run/u,
	);
	assert.match(metadata.body, /Passed - Validation: node build\.mjs --check 2\\>\/dev\/null/u);
	assert.match(metadata.body, /`src\/a\.ts`/u);
	assert.match(metadata.body, /plan\.md and docs\/x\.md/u);
});

test('derives useful PR and commit metadata from session, repository, and validation context', () => {
	const metadata = automatedPullRequestMetadata({
		branch: 'codex/automatic-pr-workflow',
		baseBranch: 'main',
		changedPaths: ['src/workflow.ts', 'README.md', 'src/workflow.ts'],
		context: {
			sessionTitle: 'Automate the pull request workflow',
			lastUserIntent: 'Please remove every metadata form.',
			runSummaries: ['Create pull requests in one click and keep review status inside malini.'],
			events: [
				{ kind: 'validation', label: 'Repository unit tests', status: 'passed' },
				{
					kind: 'terminal',
					label: 'pnpm check',
					status: 'completed',
					detail: '0 errors',
				},
			],
		},
	});

	assert.equal(
		metadata.title,
		'Create pull requests in one click and keep review status inside malini',
	);
	assert.equal(metadata.commitMessage, metadata.title);
	assert.match(metadata.body, /Create pull requests in one click/u);
	assert.match(metadata.body, /`codex\/automatic-pr-workflow` against `main`/u);
	assert.ok(metadata.body.indexOf('`README.md`') < metadata.body.indexOf('`src/workflow.ts`'));
	assert.equal(metadata.body.match(/src\/workflow\.ts/gu)?.length, 1);
	assert.match(metadata.body, /Passed - Validation: Repository unit tests/u);
	assert.match(metadata.body, /Completed - Terminal: pnpm check - 0 errors/u);
});

test('titles the pull request after the whole branch and commits under the latest change', () => {
	const input = {
		branch: 'malini/workstream-1',
		baseBranch: 'main',
		changedPaths: ['src/clone.ts'],
		context: {
			runSummaries: ['fix(repositories): accept SSH clone URLs'],
			pullRequestTitle: 'feat(repositories): clone over SSH and HTTPS',
		},
	} as const;

	const metadata = automatedPullRequestMetadata(input);

	assert.equal(metadata.title, 'feat(repositories): clone over SSH and HTTPS');
	assert.equal(metadata.commitMessage, 'fix(repositories): accept SSH clone URLs');
	assert.match(metadata.body, /## Summary\n\nfeat\(repositories\): clone over SSH and HTTPS\n/u);

	const withoutBranchTitle = automatedPullRequestMetadata({
		...input,
		context: { runSummaries: input.context.runSummaries },
	});
	assert.equal(withoutBranchTitle.title, 'fix(repositories): accept SSH clone URLs');
	assert.match(
		withoutBranchTitle.body,
		/## Summary\n\nfix\(repositories\): accept SSH clone URLs\n/u,
	);
});

test('falls back deterministically from generic chat context to the branch and changed paths', () => {
	const input = {
		branch: 'feature/keyboard-navigation',
		baseBranch: 'main',
		changedPaths: ['src/z.ts', 'src/a.ts'],
		context: {
			sessionTitle: 'New chat',
			lastUserIntent: 'Untitled',
		},
	} as const;
	const first = automatedPullRequestMetadata(input);
	const second = automatedPullRequestMetadata({
		...input,
		changedPaths: [...input.changedPaths].reverse(),
	});

	assert.equal(first.title, 'Keyboard navigation');
	assert.deepEqual(first, second);
	assert.ok(first.body.indexOf('`src/a.ts`') < first.body.indexOf('`src/z.ts`'));
});

test('removes terminal controls, bidi overrides, markdown injection, credentials, and common tokens', () => {
	const metadata = automatedPullRequestMetadata({
		branch: 'feature/safe',
		baseBranch: 'main',
		changedPaths: ['src/`unsafe`.ts'],
		context: {
			sessionTitle: '# Please ship\u001b[31m this\u202e now\nsecret=visible',
			lastUserIntent:
				'Use **safe** output with Bearer private-token and https://user:pass@example.test/path',
			events: [
				{
					kind: 'terminal',
					label: 'api_key=super-secret',
					detail: 'ghp_1234567890abcdef',
				},
			],
		},
	});

	assert.doesNotMatch(metadata.title, /[\n\r\u001b\u202e]/u);
	assert.doesNotMatch(
		`${metadata.title}\n${metadata.body}`,
		/private-token|super-secret|user:pass|ghp_/u,
	);
	assert.ok(metadata.body.includes('Use **safe** output with Bearer \\[redacted\\]'));
	assert.ok(metadata.body.includes('api_key=\\[redacted\\]'));
});

test('bounds every field and limits untrusted context fan-out', () => {
	const metadata = automatedPullRequestMetadata({
		branch: `feature/${'b'.repeat(1_000)}`,
		baseBranch: 'm'.repeat(1_000),
		changedPaths: Array.from({ length: 80 }, (_, index) => `src/${index}-${'p'.repeat(500)}.ts`),
		context: {
			sessionTitle: '😀'.repeat(500),
			lastUserIntent: 'intent '.repeat(1_000),
			runSummaries: Array.from({ length: 50 }, (_, index) => `summary ${index} ${'x'.repeat(500)}`),
			events: Array.from({ length: 50 }, (_, index) => ({
				kind: 'validation' as const,
				label: `validation ${index} ${'y'.repeat(500)}`,
				status: 'passed' as const,
			})),
		},
	});

	assert.ok(Array.from(metadata.title).length <= AUTOMATED_PULL_REQUEST_METADATA_LIMITS.title);
	assert.ok(
		Array.from(metadata.commitMessage).length <=
			AUTOMATED_PULL_REQUEST_METADATA_LIMITS.commitMessage,
	);
	assert.ok(Array.from(metadata.body).length <= AUTOMATED_PULL_REQUEST_METADATA_LIMITS.body);
	assert.equal(metadata.body.match(/Passed - Validation:/gu)?.length, 8);
	assert.match(metadata.body, /68 more changed path\(s\)/u);
});

const PARITY_RUN = Object.freeze({
	sessionTitle: 'Create a new file PARITY-CHECK.md at the 2',
	prompt:
		'Create a new file PARITY-CHECK.md at the repository root containing exactly one line: parity e2e run. Then append a new last line to README.md containing exactly: parity-e2e-marker. Do not run any tests, builds or git commands.',
	summary:
		'Created `PARITY-CHECK.md` with the requested line and added `README.md` containing the requested marker, since no repository-root README previously existed.',
});

test('states what the run did instead of echoing a truncated, counted chat title', () => {
	const metadata = automatedPullRequestMetadata({
		branch: 'malini/parity-e2e',
		baseBranch: 'main',
		changedPaths: ['PARITY-CHECK.md', 'README.md'],
		context: {
			sessionTitle: PARITY_RUN.sessionTitle,
			lastUserIntent: PARITY_RUN.prompt,
			runSummaries: [PARITY_RUN.summary],
		},
	});

	assert.equal(
		metadata.title,
		'Created `PARITY-CHECK.md` with the requested line and added `README.md` containing the requested…',
	);
	assert.equal(metadata.commitMessage, metadata.title);
	assert.doesNotMatch(metadata.title, /\s\d+$/u);
	assert.doesNotMatch(metadata.commitMessage, /\s\d+$/u);
});

test('gives two commits in one chat session subjects that describe their own work', () => {
	const branch = { branch: 'malini/parity-e2e', baseBranch: 'main' } as const;
	const firstSummary = 'Created PARITY-CHECK.md and appended the marker line to README.md.';
	const first = automatedPullRequestMetadata({
		...branch,
		changedPaths: ['PARITY-CHECK.md', 'README.md'],
		context: {
			sessionTitle: PARITY_RUN.sessionTitle,
			lastUserIntent: PARITY_RUN.prompt,
			runSummaries: [firstSummary],
		},
	});
	const second = automatedPullRequestMetadata({
		...branch,
		changedPaths: ['PARITY-CHECK.md'],
		context: {
			sessionTitle: PARITY_RUN.sessionTitle,
			lastUserIntent:
				'Append a second line to PARITY-CHECK.md that reads: second pass. Change nothing else.',
			runSummaries: [
				firstSummary,
				'Appended a second line reading second pass to PARITY-CHECK.md.',
			],
		},
	});

	assert.equal(
		first.commitMessage,
		'Created PARITY-CHECK.md and appended the marker line to README.md',
	);
	assert.equal(
		second.commitMessage,
		'Appended a second line reading second pass to PARITY-CHECK.md',
	);
	assert.notEqual(second.commitMessage, first.commitMessage);
});

test('never carries the host duplicate-name counter into a title or a commit subject', () => {
	const onlyTheChatName = (sessionTitle: string) =>
		automatedPullRequestMetadata({
			branch: 'main',
			baseBranch: 'main',
			changedPaths: [],
			context: { sessionTitle },
		});

	assert.equal(onlyTheChatName('Refresh the billing page 3').title, 'Refresh the billing page');
	assert.equal(onlyTheChatName('Chat 4').title, 'Update workstream');
	assert.equal(onlyTheChatName('Fix issue 1').title, 'Fix issue 1');
});

test('finishes a phrase the chat-title cut left dangling', () => {
	assert.equal(
		automatedPullRequestMetadata({
			branch: 'main',
			baseBranch: 'main',
			changedPaths: [],
			context: { sessionTitle: 'Create a new file PARITY-CHECK.md at the' },
		}).title,
		'Create a new file PARITY-CHECK.md',
	);
});

test('keeps a conventional commit subject from the agent as written', () => {
	const metadata = automatedPullRequestMetadata({
		branch: 'malini/ws-1',
		baseBranch: 'main',
		changedPaths: ['apps/malini/src/lib/app/presentation/pages/RepositoriesPage.svelte'],
		context: { runSummaries: ['fix(repositories): accept SSH clone URLs'] },
	});
	assert.equal(metadata.title, 'fix(repositories): accept SSH clone URLs');
	assert.equal(metadata.commitMessage, 'fix(repositories): accept SSH clone URLs');
});

test('cuts an over-long title between words and marks the cut', () => {
	const summary =
		'Replaced the polling loop in the workstream watcher with a filesystem subscription so a rename lands immediately';
	const { title } = automatedPullRequestMetadata({
		branch: 'malini/watcher',
		baseBranch: 'main',
		changedPaths: ['src/watcher.ts'],
		context: { runSummaries: [summary] },
	});

	assert.ok(Array.from(title).length <= AUTOMATED_PULL_REQUEST_METADATA_LIMITS.title);
	assert.ok(title.endsWith('…'));
	const kept = title.slice(0, -1);
	assert.ok(summary.startsWith(kept), `${kept} is not a whole prefix of the summary`);
	assert.equal(summary.charAt(kept.length), ' ', `${kept} stopped inside a word`);
});

test('lets an agent summary render as prose while refusing injected structure', () => {
	const summary =
		'Created `PARITY-CHECK.md` with **one** line, since no repository-root README existed.';
	const metadata = automatedPullRequestMetadata({
		branch: 'malini/markdown',
		baseBranch: 'main',
		changedPaths: ['PARITY-CHECK.md'],
		context: {
			runSummaries: [summary],
			events: [
				{
					kind: 'validation',
					label: '## Injected heading',
					status: 'passed',
					detail: '- [Approve](https://evil.test) for @maintainer about #40 <img src=x>',
				},
			],
		},
	});

	assert.ok(metadata.body.includes(summary));
	assert.ok(metadata.body.includes('\\#\\# Injected heading'));
	assert.ok(metadata.body.includes('\\- \\[Approve\\](https://evil.test)'));
	assert.ok(metadata.body.includes('\\@maintainer'));
	assert.ok(metadata.body.includes('\\#40'));
	assert.ok(metadata.body.includes('\\<img src=x\\>'));
});
