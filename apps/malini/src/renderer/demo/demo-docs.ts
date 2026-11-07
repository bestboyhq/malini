import { DEMO_DAY, type DemoRun, type DemoStep, type DemoWorkstream } from './demo-data';

const at = (time: string): string => `${DEMO_DAY}T${time}:00.000Z`;

const PUSH = 'apps/malini/src/lib/pull-requests/platform/push.ts';
const PUSH_TEST = 'apps/malini/src/lib/pull-requests/platform/push.test.ts';
const MERGE = 'apps/malini/src/lib/pull-requests/platform/merge.ts';
const SHIP_STATE = 'apps/malini/src/lib/pull-requests/domain/ship-state.ts';
const SHIP_BUTTON = 'apps/malini/src/lib/pull-requests/presentation/ShipButton.svelte';

const MALINI_TREE = [
	'AGENTS.md',
	'README.md',
	PUSH,
	PUSH_TEST,
	MERGE,
	SHIP_STATE,
	SHIP_BUTTON,
	'apps/malini/src/main/git/remote.ts',
	'package.json',
];

const usage = { inputTokens: 48_200, outputTokens: 1_900 };

const CONTEXT: DemoWorkstream = {
	id: 'docs-context',
	projectId: 'malini',
	name: 'Retry a rejected push',
	branch: 'malini/retry-a-rejected-push',
	activeAt: at('10:40'),
	files: [
		{ path: PUSH, additions: 31, deletions: 6 },
		{ path: PUSH_TEST, additions: 58, deletions: 0 },
		{ path: MERGE, additions: 7, deletions: 2 },
	],
	tree: MALINI_TREE,
	ship: null,
	runs: [
		{
			id: 'run-docs-context-1',
			prompt:
				'When GitHub rejects a push because the branch moved, Merge gives up. Fetch, replay our commits on top and push once more.',
			startedAt: at('10:01'),
			tools: [
				{ thought: 'Merge stops at the first rejected push. Finding where it decides that.' },
				{ name: 'Grep', input: { pattern: 'non-fast-forward', path: 'apps/malini/src' } },
				{ name: 'Read', input: { file_path: PUSH } },
				{
					name: 'Edit',
					input: {
						file_path: PUSH,
						old_string: "if (rejected) return { status: 'failed' };",
						new_string: 'if (rejected) return retryOnMovedBranch(workstream);',
					},
				},
				{
					name: 'Bash',
					input: { command: 'pnpm --filter malini test push', description: 'Run the push tests' },
					output: '✓ src/lib/pull-requests/platform/push.test.ts (9 tests) 1.8s',
				},
			],
			report: [
				'- Changed: a push GitHub rejects for a moved branch fetches, replays and pushes once more',
				'- Verified: `pnpm --filter malini test push` passes, 4 new cases on a real repository',
				'',
				'Outcome: Merge survives a branch that moved while it waited',
				'Needs: nothing',
			].join('\n'),
			usage,
		},
		{
			id: 'run-docs-context-2',
			prompt: 'Cover a branch that moves twice while Merge waits.',
			startedAt: at('10:18'),
			tools: [
				{
					name: 'Edit',
					input: {
						file_path: PUSH,
						old_string: 'return retryOnMovedBranch(workstream);',
						new_string: 'while (rejected) rejected = await retryOnMovedBranch(workstream);',
					},
				},
				{
					name: 'Edit',
					input: {
						file_path: PUSH_TEST,
						old_string: "test('replays once', async () => {",
						new_string:
							"test('replays until the branch holds still', async () => {\n\tawait moveBranchTwice();",
					},
				},
				{
					name: 'Bash',
					input: { command: 'pnpm --filter malini test push', description: 'Run the push tests' },
					output: '✓ src/lib/pull-requests/platform/push.test.ts (11 tests) 2.1s',
				},
			],
			report: [
				'- Changed: Merge replays and pushes until the branch holds still',
				'- Verified: a branch moved twice during a push lands, 11 push tests pass',
				'',
				'Outcome: A branch that moves twice still merges',
				'Needs: nothing',
			].join('\n'),
			usage,
		},
	],
};

const CONTEXT_RUN: DemoRun = {
	id: 'run-docs-context-3',
	prompt: 'Check that everything calling the retry copes with more than one replay.',
	startedAt: at('10:36'),
	tools: [
		{ thought: 'Three separate questions. Sending a subagent after each.' },
		{
			agents: [
				{
					description: 'Read the push retry tests',
					prompt: 'List what push.test.ts covers about a branch that moves during a push.',
					tools: [
						{ name: 'Read', input: { file_path: PUSH_TEST } },
						{ name: 'Grep', input: { pattern: 'moveBranch', path: PUSH_TEST } },
					],
					report:
						'push.test.ts covers one move and two moves. Nothing covers a push that never lands.',
				},
				{
					description: 'Find every caller of retryOnMovedBranch',
					prompt: 'Find every caller of retryOnMovedBranch and what each does with its result.',
					tools: [
						{ name: 'Grep', input: { pattern: 'retryOnMovedBranch', path: 'apps/malini/src' } },
						{ name: 'Read', input: { file_path: MERGE } },
					],
					report: 'Two callers. push.ts loops, merge.ts still stops after one replay.',
				},
				{
					description: 'Replay a branch moved three times',
					prompt: 'Move a scratch branch three times while a push waits, and report what happens.',
					tools: [
						{
							name: 'Bash',
							input: {
								command: 'git push origin HEAD',
								description: 'Push while the branch moves',
							},
							output: '! [rejected] HEAD -> main (non-fast-forward)',
						},
						{
							name: 'Bash',
							input: { command: 'git pull --rebase origin main', description: 'Replay on top' },
						},
						{
							name: 'Bash',
							input: { command: 'git push origin HEAD', description: 'Push once more' },
							output: 'main -> main',
						},
					],
					report: 'Three moves, three replays, one push lands.',
				},
			],
		},
		{
			name: 'Edit',
			input: {
				file_path: MERGE,
				old_string: 'const rejected = await retryOnMovedBranch(workstream);',
				new_string:
					'let rejected = true;\nwhile (rejected) rejected = await retryOnMovedBranch(workstream);',
			},
		},
		{
			name: 'Bash',
			input: { command: 'pnpm --filter malini test merge', description: 'Run the merge tests' },
			output: '✓ src/lib/pull-requests/platform/merge.test.ts (14 tests) 2.4s',
		},
	],
	report: [
		'- Changed: merge.ts replays until the branch holds still, like push.ts',
		'- Verified: 14 merge tests pass, a branch moved three times still lands',
		'',
		'Outcome: Both callers replay until the push lands',
		'Needs: nothing',
	].join('\n'),
	usage,
};

const QUEUE: DemoWorkstream = {
	id: 'docs-queue',
	projectId: 'malini',
	name: 'Say what a merge waits for',
	branch: 'malini/say-what-a-merge-waits-for',
	activeAt: at('11:02'),
	files: [],
	tree: MALINI_TREE,
	ship: null,
	runs: [],
};

const QUEUE_RUN: DemoRun = {
	id: 'run-docs-queue-1',
	prompt:
		'The Merge button says Waiting and nothing else. Say what it waits for: checks, a review or the queue.',
	startedAt: at('11:00'),
	tools: [
		{
			thought: 'The button reads one phase. The step under it already knows what blocks the merge.',
		},
		{ name: 'Grep', input: { pattern: 'waiting-for-checks', path: 'apps/malini/src' } },
		{ name: 'Read', input: { file_path: SHIP_STATE } },
		{ name: 'Read', input: { file_path: SHIP_BUTTON } },
		{
			name: 'Edit',
			input: {
				file_path: SHIP_STATE,
				old_string: "case 'queued': return 'Waiting';",
				new_string: "case 'queued': return waitingFor(state.step);",
			},
		},
		{
			name: 'Edit',
			input: {
				file_path: SHIP_BUTTON,
				old_string: '{label}',
				new_string: '{label}<span class="step">{detail}</span>',
			},
		},
		{
			name: 'Bash',
			input: {
				command: 'pnpm --filter malini test ship-state',
				description: 'Run the ship state tests',
			},
			output: '✓ src/lib/pull-requests/domain/ship-state.test.ts (17 tests) 640ms',
		},
		{
			name: 'Bash',
			input: { command: 'pnpm --filter malini check', description: 'Typecheck the app' },
			output: 'svelte-check found 0 errors and 0 warnings',
		},
		{
			name: 'Bash',
			input: {
				command: 'pnpm --filter malini test:e2e ship-button',
				description: 'Run the Merge button specs',
			},
			output: '6 passed (41.2s)',
		},
	],
	report: [
		'- Changed: Merge says what it waits for: **Waiting for checks**, **Waiting for a review**, **In the queue**',
		'- Verified: 17 ship state tests and 6 Merge button specs pass',
		'',
		'Outcome: Merge names what it waits for',
		'Needs: nothing',
	].join('\n'),
	usage,
};

export const DOCS_QUEUE_DRAFT = 'Name the check when only one is left.';

export type DocsReply = Readonly<{ tools: readonly DemoStep[]; report: string; workMs: number }>;

export const DOCS_REPLIES: ReadonlyMap<string, DocsReply> = new Map([
	[
		DOCS_QUEUE_DRAFT,
		{
			tools: [
				{
					name: 'Edit',
					input: {
						file_path: SHIP_STATE,
						old_string: "return 'Waiting for checks';",
						new_string:
							"return pending.length === 1 ? `Waiting for ${pending[0].name}` : 'Waiting for checks';",
					},
				},
				{
					name: 'Bash',
					input: {
						command: 'pnpm --filter malini test ship-state',
						description: 'Run the ship state tests',
					},
					output: '✓ src/lib/pull-requests/domain/ship-state.test.ts (18 tests) 650ms',
				},
			],
			report: [
				'- Changed: with one check left, Merge names it, such as **Waiting for e2e**',
				'- Verified: 18 ship state tests pass',
				'',
				'Outcome: Merge names the last check it waits for',
				'Needs: nothing',
			].join('\n'),
			workMs: 5_000,
		},
	],
]);

export const DOCS_LIVE: readonly Readonly<{
	workstreamId: string;
	run: DemoRun;
	workMs: number;
}>[] = [
	{ workstreamId: CONTEXT.id, run: CONTEXT_RUN, workMs: 36_000 },
	{ workstreamId: QUEUE.id, run: QUEUE_RUN, workMs: 70_000 },
];

export const DOCS_DRAFTS: ReadonlyMap<string, string> = new Map([[QUEUE.id, DOCS_QUEUE_DRAFT]]);

export const DOCS_WORKSTREAMS: readonly DemoWorkstream[] = [CONTEXT, QUEUE];
