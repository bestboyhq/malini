import type { AgentEventEnvelope } from '$contract/agent';
import type { ProjectDto, WorkstreamDto, WorkstreamFileEntry } from '$contract/repositories';
import type { ShipStateRecord } from '$contract/pull-requests';
import type { AgentEvent } from '$lib/chat/domain/events';

export const DEMO_DAY = '2026-10-29';

export const OWNER = 'bestboyhq';

const at = (time: string): string => `${DEMO_DAY}T${time}:00.000Z`;

const repository = (name: string): ProjectDto => ({
	id: name,
	name,
	repoPath: `/Users/you/Malini/repositories/${OWNER}/${name}`,
	defaultBranch: 'main',
	createdAt: at('08:00'),
	remoteUrl: `https://github.com/${OWNER}/${name}.git`,
});

export const PROJECTS: ProjectDto[] = ['malini', 'platform', 'grip', 'tony'].map(repository);

type DemoFile = Readonly<{ path: string; additions: number; deletions: number }>;

export type DemoTool = Readonly<{
	name: string;
	input: Record<string, unknown>;
	output?: unknown;
	say?: string;
}>;

export type DemoSubagent = Readonly<{
	description: string;
	prompt: string;
	tools: readonly DemoTool[];
	report: string;
}>;

export type DemoStep =
	DemoTool | Readonly<{ thought: string }> | Readonly<{ agents: readonly DemoSubagent[] }>;

export type DemoRun = Readonly<{
	id: string;
	prompt: string;
	from?: string;
	startedAt: string;
	tools: readonly DemoStep[];
	report: string;
	usage: Readonly<{ inputTokens: number; outputTokens: number }>;
}>;

export type DemoWorkstream = Readonly<{
	id: string;
	projectId: string;
	name: string;
	branch: string;
	activeAt: string;
	files: readonly DemoFile[];
	tree: readonly string[];
	runs: readonly DemoRun[];
	ship: Pick<ShipStateRecord, 'phase' | 'step' | 'pullRequestNumber'> | null;
	startedBy?: string;
}>;

const TREES: Readonly<Record<string, readonly string[]>> = {
	malini: [
		'.github/workflows/ci.yml',
		'AGENTS.md',
		'README.md',
		'apps/malini/src/lib/pull-requests/platform/push.ts',
		'apps/malini/src/lib/pull-requests/platform/push.test.ts',
		'apps/malini/src/main/git/remote.ts',
		'apps/site/scripts/og-image.ts',
		'apps/site/src/lib/Hero.svelte',
		'apps/site/src/lib/og.png',
		'apps/site/src/routes/og/+page.svelte',
		'docs/adr/README.md',
		'package.json',
		'pnpm-lock.yaml',
	],
	platform: ['AGENTS.md', 'README.md', 'docs/design.md', 'og/OgImage.svelte', 'og/render.ts'],
	grip: [
		'.github/workflows/ci.yml',
		'AGENTS.md',
		'README.md',
		'electron/transcript.ts',
		'electron/transcript.test.ts',
		'package.json',
		'scripts/readme/captions/demo.ts',
		'site/scripts/og.ts',
		'site/src/routes/og/+page.svelte',
		'src/engine/transcript/index.ts',
		'src/engine/transcript/index.test.ts',
		'src/windows/dev/labs/Transcript.svelte',
	],
	tony: [
		'.github/workflows/ci.yml',
		'AGENTS.md',
		'Package.swift',
		'README.md',
		'build/icon.png',
		'site/scripts/og.ts',
		'site/src/lib/Hero.svelte',
		'site/src/lib/Pill.svelte',
		'site/src/lib/assets/og.png',
		'site/src/lib/assets/og.sha256',
		'site/src/routes/og/+page.svelte',
		'site/tests/og.test.ts',
	],
};

export const treeOf = (projectId: string): readonly string[] => TREES[projectId] ?? [];

export const WORKSTREAMS: readonly DemoWorkstream[] = [
	{
		id: 'ws-malini-push',
		projectId: 'malini',
		name: 'Retry a rejected push',
		branch: 'malini/retry-a-rejected-push',
		activeAt: at('10:12'),
		files: [
			{ path: 'apps/malini/src/lib/pull-requests/platform/push.ts', additions: 27, deletions: 6 },
			{
				path: 'apps/malini/src/lib/pull-requests/platform/push.test.ts',
				additions: 44,
				deletions: 0,
			},
		],
		tree: TREES['malini'] ?? [],
		ship: { phase: 'draft', step: null, pullRequestNumber: 104 },
		runs: [
			{
				id: 'run-malini-push-1',
				prompt:
					'When GitHub rejects a push because the branch moved, Merge gives up. Fetch, replay our commits on top and push once more.',
				startedAt: at('10:01'),
				tools: [
					{ name: 'Grep', input: { pattern: 'non-fast-forward', path: 'apps/malini/src' } },
					{
						name: 'Read',
						input: { file_path: 'apps/malini/src/lib/pull-requests/platform/push.ts' },
					},
					{
						name: 'Edit',
						input: {
							file_path: 'apps/malini/src/lib/pull-requests/platform/push.ts',
							old_string: "if (rejected) return { status: 'failed' };",
							new_string: 'if (rejected) return retryOnMovedBranch(workstream);',
						},
					},
					{
						name: 'Bash',
						input: {
							command: 'pnpm --filter malini test push',
							description: 'Run the push tests',
						},
						output: '✓ src/lib/pull-requests/platform/push.test.ts (9 tests) 1.8s',
					},
				],
				report: [
					'- Changed: a push GitHub rejects for a moved branch fetches, replays and pushes once more',
					'- Verified: `pnpm --filter malini test push` passes, 4 new cases on a real repository',
					'',
					'Outcome: Merge survives a branch that moved while it waited',
					'Needs: nothing',
					'Commit: fix(pull-requests): retry a push GitHub rejects for a moved branch',
					'Pull request: fix(pull-requests): retry a push GitHub rejects for a moved branch',
				].join('\n'),
				usage: { inputTokens: 52_310, outputTokens: 2_140 },
			},
		],
	},
	{
		id: 'ws-grip-captions',
		projectId: 'grip',
		name: 'Captions land on the word',
		branch: 'malini/captions-land-on-the-word',
		activeAt: at('10:26'),
		files: [
			{ path: 'src/engine/transcript/index.ts', additions: 18, deletions: 9 },
			{ path: 'src/engine/transcript/index.test.ts', additions: 36, deletions: 2 },
		],
		tree: TREES['grip'] ?? [],
		ship: { phase: 'queued', step: 'waiting-for-checks', pullRequestNumber: 64 },
		runs: [
			{
				id: 'run-grip-captions-1',
				prompt: 'Captions show up a beat after the word is spoken. Make them land on the word.',
				startedAt: at('09:41'),
				tools: [
					{ name: 'Read', input: { file_path: 'src/engine/transcript/index.ts' } },
					{ name: 'Grep', input: { pattern: 'endMs', path: 'src/engine/transcript' } },
					{
						name: 'Edit',
						input: {
							file_path: 'src/engine/transcript/index.ts',
							old_string: 'const shownAt = word.endMs;',
							new_string: 'const shownAt = word.startMs;',
						},
					},
					{
						name: 'Bash',
						input: { command: 'npm test -- transcript', description: 'Run the transcript tests' },
						output: '✓ src/engine/transcript/index.test.ts (14 tests) 380ms',
					},
				],
				report: [
					'- Changed: a caption shows when its word starts, 180 ms sooner than before',
					'- Verified: `npm test -- transcript` passes, 3 new cases on real recordings',
					'- Next: hold each caption until the next word starts, so short words do not flash',
					'',
					'Outcome: Captions land on the word as it is spoken',
					'Needs: nothing',
					'Commit: fix(captions): show each word when it starts',
				].join('\n'),
				usage: { inputTokens: 47_820, outputTokens: 1_730 },
			},
			{
				id: 'run-grip-captions-2',
				prompt: 'Hold each caption until the next word starts, so short words do not flash',
				startedAt: at('09:52'),
				tools: [
					{
						name: 'Edit',
						input: {
							file_path: 'src/engine/transcript/index.ts',
							old_string: 'const hiddenAt = word.endMs;',
							new_string: 'const hiddenAt = Math.max(next.startMs, word.startMs + 120);',
						},
					},
					{
						name: 'Bash',
						input: { command: 'npm test -- transcript', description: 'Run the transcript tests' },
						output: '✓ src/engine/transcript/index.test.ts (16 tests) 410ms',
					},
				],
				report: [
					'- Changed: a caption stays up until the next word starts, never under 120 ms',
					'- Verified: no caption in the demo clip shows for less than 120 ms',
					'',
					'Outcome: Short words stay up long enough to read',
					'Needs: nothing',
					'Commit: fix(captions): hold each word until the next one starts',
				].join('\n'),
				usage: { inputTokens: 51_240, outputTokens: 1_180 },
			},
			{
				id: 'run-grip-captions-3',
				prompt: 'Before we lock this in, show me a few caption styles on the real clip.',
				startedAt: at('10:03'),
				tools: [
					{ name: 'Read', input: { file_path: 'src/windows/dev/labs/Transcript.svelte' } },
					{
						name: 'Bash',
						input: {
							command: 'npx tsx scripts/readme/captions/demo.ts --styles word,line,subtitles',
							description: 'Draw each caption style on the clip',
						},
						output: 'Saved 3 frames to .context/',
					},
				],
				report: [
					'![Variant A: One word - the word being said, big, as today](.context/grip-caption-word.webp)',
					'![Variant B: Line - the whole line, lit up to the word being said](.context/grip-caption-line.webp)',
					'![Variant C: Subtitles - two quiet lines, like a film](.context/grip-caption-subtitles.webp)',
					'',
					'- Changed: nothing in the code, each style is drawn on the same frame of the clip',
					'- Verified: all three fit the frame at 1152 by 720',
					'',
					'Outcome: Three caption styles on the real clip',
					'Needs: pick a caption style',
				].join('\n'),
				usage: { inputTokens: 58_610, outputTokens: 2_020 },
			},
			{
				id: 'run-grip-captions-4',
				prompt: 'Go with variant A (One word).\nWhy: Big words read on a phone',
				startedAt: at('10:14'),
				tools: [
					{
						name: 'Edit',
						input: {
							file_path: 'src/engine/transcript/index.ts',
							old_string: 'const words = line.words;',
							new_string: 'const words = [word];',
						},
					},
					{
						name: 'Bash',
						input: { command: 'npm test -- transcript', description: 'Run the transcript tests' },
						output: '✓ src/engine/transcript/index.test.ts (17 tests) 420ms',
					},
					{
						name: 'Bash',
						input: {
							command: 'npx tsx scripts/readme/captions/demo.ts',
							description: 'Record the captions clip',
						},
						output: 'Saved .context/grip-captions.mp4',
					},
				],
				report: [
					'![Captions landing on each word as it is spoken](.context/grip-captions.mp4)',
					'',
					'- Changed: one word at a time is the only style, sized to the window',
					'- Verified: `npm test -- transcript` passes, and the clip above is a real recording',
					'- Next: hold the last word of a sentence a beat longer',
					'',
					'Outcome: Captions pop one word at a time, on the beat',
					'Needs: nothing',
					'Commit: feat(captions): show one word at a time, on the beat',
					'Pull request: feat(captions): show one word at a time, on the beat',
				].join('\n'),
				usage: { inputTokens: 49_370, outputTokens: 1_640 },
			},
		],
	},
	{
		id: 'ws-tony-hero',
		projectId: 'tony',
		name: 'Show the words in the hero',
		branch: 'malini/show-the-words-in-the-hero',
		activeAt: at('10:34'),
		files: [
			{ path: 'site/src/lib/Pill.svelte', additions: 31, deletions: 4 },
			{ path: 'site/src/lib/Hero.svelte', additions: 6, deletions: 1 },
		],
		tree: TREES['tony'] ?? [],
		ship: null,
		runs: [
			{
				id: 'run-tony-hero-1',
				prompt:
					'The hero pill listens, but you never see what it heard. Show the words landing above it, and show me before and after.',
				startedAt: at('10:28'),
				tools: [
					{ name: 'Read', input: { file_path: 'site/src/lib/Pill.svelte' } },
					{
						name: 'Edit',
						input: {
							file_path: 'site/src/lib/Pill.svelte',
							old_string: '<img class="moving"',
							new_string: '<p class="heard">{heard}</p>\n\t<img class="moving"',
						},
					},
					{
						name: 'Bash',
						input: { command: 'pnpm test', description: 'Run the site tests' },
						output: '✓ tests/site.test.ts (14 tests) 1.3s',
					},
					{
						name: 'Bash',
						input: {
							command: 'npx playwright screenshot --color-scheme=dark /tony hero.png',
							description: 'Capture the hero before and after',
						},
						output: 'Saved .context/tony-hero-before.webp and .context/tony-hero-after.webp',
					},
				],
				report: [
					'![Before: the Tony hero, the pill alone on its stage](.context/tony-hero-before.webp)',
					'![After: the words Tony heard land above the pill](.context/tony-hero-after.webp)',
					'',
					'- Changed: the stage shows the sentence the pill hears, word by word, above it',
					'- Verified: `pnpm test` passes, and the hero reads right in light and dark',
					'- Next: time each word to the bars in the pill',
					'',
					'Outcome: Tony’s hero shows what you said, not only that it listened',
					'Needs: nothing',
					'Commit: feat(site): show the words Tony hears in the hero',
					'Pull request: feat(site): show the words Tony hears in the hero',
				].join('\n'),
				usage: { inputTokens: 39_460, outputTokens: 1_520 },
			},
		],
	},
];

export const SETUP_WORKSTREAM: DemoWorkstream = {
	id: 'ws-malini-duplicate',
	projectId: 'malini',
	name: 'Duplicate a chat from its tab',
	branch: 'malini/duplicate-a-chat-from-its-tab',
	activeAt: at('10:40'),
	files: [
		{ path: 'apps/malini/src/lib/chat/presentation/ChatTabs.svelte', additions: 14, deletions: 1 },
		{ path: 'packages/hyper-ui/src/icons/copy.svg', additions: 4, deletions: 0 },
	],
	tree: TREES['malini'] ?? [],
	ship: null,
	runs: [
		{
			id: 'run-malini-duplicate-1',
			prompt: 'Add Duplicate to the chat tab’s menu, with an icon to match.',
			startedAt: at('10:31'),
			tools: [
				{
					say: 'The icon pack has no copy glyph, so I’ll draw one.',
					name: 'Skill',
					input: { skill: 'draw-icon' },
				},
				{
					say: 'Adding Duplicate to the tab’s menu.',
					name: 'mcp__plugin_svelte_svelte__svelte-autofixer',
					input: { code: '<Menu.Item onclick={duplicate}>', desired_svelte_version: 5 },
					output: 'No issues found',
				},
				{
					name: 'Bash',
					input: { command: 'pnpm check', description: 'Type-check and lint' },
					output: '✓ 0 errors, 0 warnings',
				},
				{
					say: 'Your CLAUDE.md says done means checked in the app.',
					name: 'Skill',
					input: { skill: 'test-malini-app' },
				},
			],
			report: [
				'- Changed: Duplicate sits in the chat tab’s menu, with a copy icon drawn for the pack',
				'- Verified: `pnpm check` passes, and Duplicate opens a copy in the built app',
				'',
				'Outcome: A chat duplicates from its tab',
				'Needs: nothing',
				'Commit: feat(chat): duplicate a chat from its tab',
			].join('\n'),
			usage: { inputTokens: 44_120, outputTokens: 1_910 },
		},
	],
};

export type StartedWorkstream = DemoWorkstream &
	Readonly<{ workMs: number; thought: string; opens?: string }>;

const OG_DIRECTIONS: DemoWorkstream = {
	id: 'ws-og-lead',
	projectId: 'malini',
	name: 'OG image directions',
	branch: 'malini/og-image-directions',
	activeAt: at('10:44'),
	files: [],
	tree: [],
	ship: null,
	runs: [
		{
			id: 'run-og-directions-1',
			prompt:
				'I don’t like our OG images. Show me directions we could take them, across all our sites.',
			startedAt: at('10:12'),
			tools: [],
			report: [
				'![Variant A: Gradient - the name on the brand gradient](.context/malini-og-gradient.webp)',
				'![Variant B: Mascot - each product drawn as a character](.context/malini-og-mascot.webp)',
				'![Variant C: Terminal - the install command, big](.context/malini-og-terminal.webp)',
				'',
				'- Changed: nothing on any `main`, the prototypes live in their workstreams',
				'- Verified: malini, grip and tony each rendered all three at 1200 by 630',
				'',
				'Outcome: Three OG directions for every Bestboy site',
				'Needs: pick the direction for malini, grip and tony',
			].join('\n'),
			usage: { inputTokens: 21_900, outputTokens: 1_640 },
		},
		{
			id: 'run-og-directions-2',
			prompt:
				'None of these variants fit; make new ones.\nWhy: They look like every other dev tool',
			startedAt: at('10:20'),
			tools: [],
			report: [
				'![Variant A: Icon - the Malini icon on the brand horizon](.context/malini-og-icon.webp)',
				'![Variant B: Product - the real app beside the headline](.context/malini-og-product.webp)',
				'![Variant C: Type - one loud line, the family of icons below](.context/malini-og-type.webp)',
				'',
				'- Changed: nothing on any `main`, three new prototypes in each workstream',
				'- Verified: malini, grip and tony each rendered all three at 1200 by 630',
				'',
				'Outcome: Three new directions, after none fit',
				'Needs: pick the direction for malini, grip and tony',
			].join('\n'),
			usage: { inputTokens: 24_310, outputTokens: 1_720 },
		},
		{
			id: 'run-og-directions-3',
			prompt: 'Go with variant B (Product).\nWhy: Show the app, not a logo',
			startedAt: at('10:31'),
			tools: [],
			report: [
				'- Changed: started a workstream in malini, grip and tony to build the Product card',
				'- Verified: each one renders its own app, not a copy of Malini',
				'',
				'Outcome: The Product card is building in malini, grip and tony',
				'Needs: nothing',
			].join('\n'),
			usage: { inputTokens: 26_050, outputTokens: 1_190 },
		},
		{
			id: 'run-og-directions-4',
			prompt: 'Show me the winner on malini, before and after.',
			startedAt: at('10:44'),
			tools: [],
			report: [
				'![Before: the Malini card, the hero cut to 1200 by 630](.context/malini-og-before.webp)',
				'![After: the Product card, the real app beside the headline](.context/malini-og-product.webp)',
				'',
				'- Changed: malini, grip and tony share the Product card, each with its own app inside',
				'- Verified: each site’s og test renders it at 1200 by 630',
				'',
				'Outcome: Every Bestboy site shares the Product card',
				'Needs: nothing',
			].join('\n'),
			usage: { inputTokens: 29_870, outputTokens: 1_460 },
		},
	],
};

const TOOL_MS = [420, 2_150, 180, 140, 3_900, 260];

export const WORKSTREAM_PATH = (id: string): string => `/Users/you/Malini/workstreams/${id}`;

export function workstreamDto(workstream: DemoWorkstream): WorkstreamDto {
	return {
		id: workstream.id,
		projectId: workstream.projectId,
		name: workstream.name,
		path: WORKSTREAM_PATH(workstream.id),
		branch: workstream.branch,
		baseBranch: 'main',
		status: 'active',
		createdAt: workstream.runs[0]?.startedAt ?? workstream.activeAt,
		startedBy: workstream.startedBy ?? null,
		activeAt: workstream.activeAt,
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: WORKSTREAM_PATH(workstream.id),
	};
}

export const sessionId = (workstreamId: string): string => `session-${workstreamId}`;

export function reportedWorkstream(id: string): DemoWorkstream | undefined {
	return [...WORKSTREAMS, OG_DIRECTIONS, SETUP_WORKSTREAM].find(
		(workstream) => workstream.id === id,
	);
}

function toolInput(workstreamId: string, tool: DemoTool): Record<string, unknown> {
	const path = tool.input['file_path'];
	if (typeof path !== 'string' || path.startsWith('/')) return tool.input;
	return { ...tool.input, file_path: `${WORKSTREAM_PATH(workstreamId)}/${path}` };
}

function toolCall(
	workstreamId: string,
	runId: string,
	toolCallId: string,
	tool: DemoTool,
	ts: number,
	ms: number,
	parentToolCallId?: string,
): AgentEvent[] {
	const parent = parentToolCallId ? { parentToolCallId } : {};
	return [
		{
			type: 'tool.started',
			runId,
			name: tool.name,
			input: toolInput(workstreamId, tool),
			toolCallId,
			ts,
			...parent,
		},
		{
			type: 'tool.completed',
			runId,
			name: tool.name,
			output: tool.output ?? 'ok',
			toolCallId,
			ts: ts + ms,
			...parent,
		},
	];
}

function subagentEvents(
	workstreamId: string,
	runId: string,
	toolCallId: string,
	agent: DemoSubagent,
	ts: number,
): AgentEvent[] {
	const input = { description: agent.description, subagent_type: 'Explore', prompt: agent.prompt };
	const steps = agent.tools.flatMap((tool, index) =>
		toolCall(
			workstreamId,
			runId,
			`${toolCallId}-${index}`,
			tool,
			ts + (index + 1) * 6_000,
			TOOL_MS[index % TOOL_MS.length] ?? 0,
			toolCallId,
		),
	);
	const back = ts + (agent.tools.length + 1) * 6_000;
	return [
		{ type: 'tool.started', runId, name: 'Agent', input, toolCallId, ts },
		...steps,
		...toolCall(
			workstreamId,
			runId,
			`${toolCallId}-back`,
			{ name: 'SubagentHandback', input: { message: agent.report } },
			back,
			0,
			toolCallId,
		),
		{
			type: 'tool.completed',
			runId,
			name: 'Agent',
			output: 'The report was delivered to the parent.',
			toolCallId,
			ts: back,
		},
	];
}

const timeOf = (event: AgentEvent): number => ('ts' in event ? (event.ts ?? 0) : 0);

export function stepEvents(
	step: DemoStep,
	workstreamId: string,
	runId: string,
	index: number,
	ts: number,
): AgentEvent[] {
	const key = `${runId}-step-${index}`;
	if ('thought' in step) {
		return [{ type: 'thinking.message', runId, contentId: key, text: step.thought }];
	}
	if ('agents' in step) {
		return step.agents
			.flatMap((agent, at) => subagentEvents(workstreamId, runId, `${key}-agent-${at}`, agent, ts))
			.sort((left, right) => timeOf(left) - timeOf(right));
	}
	const said: AgentEvent[] = step.say
		? [{ type: 'assistant.message', runId, text: step.say, contentId: `${runId}-say-${index}` }]
		: [];
	return [
		...said,
		...toolCall(workstreamId, runId, key, step, ts, TOOL_MS[index % TOOL_MS.length] ?? 0),
	];
}

export function toolEvents(
	workstreamId: string,
	runId: string,
	tools: readonly DemoStep[],
	started: number,
): AgentEvent[] {
	return tools.flatMap((step, index) =>
		stepEvents(step, workstreamId, runId, index, started + (index + 1) * 9_000),
	);
}

export function openingEvents(workstreamId: string, run: DemoRun): AgentEvent[] {
	return [
		{ type: 'run.started', runId: run.id, sessionId: sessionId(workstreamId) },
		{
			type: 'user.message',
			runId: run.id,
			text: run.prompt,
			...(run.from ? { from: run.from } : {}),
		},
	];
}

export function closingEvents(run: DemoRun): AgentEvent[] {
	return [
		{ type: 'assistant.message', runId: run.id, text: run.report, contentId: `${run.id}-report` },
		{
			type: 'usage.updated',
			runId: run.id,
			inputTokens: run.usage.inputTokens,
			outputTokens: run.usage.outputTokens,
			contextTokens: run.usage.inputTokens,
			contextWindowTokens: 1_000_000,
		},
		{ type: 'run.completed', runId: run.id, summary: '' },
	];
}

export function runEvents(workstreamId: string, run: DemoRun): AgentEvent[] {
	return [
		...openingEvents(workstreamId, run),
		...toolEvents(workstreamId, run.id, run.tools, Date.parse(run.startedAt)),
		...closingEvents(run),
	];
}

export function envelopesOf(workstream: DemoWorkstream): AgentEventEnvelope[] {
	const id = sessionId(workstream.id);
	let seq = 0;
	return workstream.runs.flatMap((run) =>
		runEvents(workstream.id, run).map((event) => ({
			sessionId: id,
			runId: run.id,
			seq: ++seq,
			event,
		})),
	);
}

export function filesOf(workstream: DemoWorkstream | undefined): WorkstreamFileEntry[] {
	return (workstream?.tree ?? []).map((path) => ({ path }));
}
