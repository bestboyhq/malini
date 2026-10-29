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

type DemoTool = Readonly<{ name: string; input: Record<string, unknown>; output?: unknown }>;

export type DemoRun = Readonly<{
	id: string;
	prompt: string;
	from?: string;
	startedAt: string;
	tools: readonly DemoTool[];
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
	scope?: string;
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
		'site/scripts/og.ts',
		'site/src/lib/assets/og.png',
		'site/src/lib/assets/og.sha256',
		'site/src/routes/og/+page.svelte',
		'site/tests/og.test.ts',
	],
};

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
				prompt:
					'Captions show up a beat after the word is spoken. Make them land on the word, and record a clip so I can see it.',
				startedAt: at('10:14'),
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
					'- Changed: a caption shows when its word starts, 180 ms sooner than before',
					'- Verified: `npm test -- transcript` passes, and the clip above is a real recording',
					'',
					'Outcome: Captions land on the word as it is spoken',
					'Needs: nothing',
					'Commit: fix(captions): show each word when it starts',
					'Pull request: fix(captions): show each word when it starts',
				].join('\n'),
				usage: { inputTokens: 47_820, outputTokens: 1_730 },
			},
		],
	},
	{
		id: 'ws-tony-og',
		projectId: 'tony',
		name: 'New OG image',
		branch: 'malini/new-og-image',
		activeAt: at('10:34'),
		files: [
			{ path: 'site/src/routes/og/+page.svelte', additions: 38, deletions: 52 },
			{ path: 'site/src/lib/assets/og.sha256', additions: 3, deletions: 3 },
		],
		tree: TREES['tony'] ?? [],
		ship: null,
		runs: [
			{
				id: 'run-tony-og-1',
				prompt:
					'Our OG image is just the hero again. Put the Tony icon on the brand horizon instead, and show me before and after.',
				startedAt: at('10:28'),
				tools: [
					{ name: 'Read', input: { file_path: 'site/src/routes/og/+page.svelte' } },
					{
						name: 'Edit',
						input: {
							file_path: 'site/src/routes/og/+page.svelte',
							old_string: '<Hero og />',
							new_string: '<OgIcon name="Tony" line="Hold a key. Speak. Let go." />',
						},
					},
					{
						name: 'Bash',
						input: { command: 'pnpm og', description: 'Render the Open Graph image' },
						output: 'Wrote src/lib/assets/og.png and og.sha256',
					},
					{
						name: 'Bash',
						input: { command: 'pnpm test og', description: 'Run the Open Graph tests' },
						output: '✓ tests/og.test.ts (2 tests) 640ms',
					},
				],
				report: [
					'![Before: the old Tony OG image, the hero headline again](.context/tony-og-before.webp)',
					'![After: the Tony icon on the brand horizon](.context/tony-og-after.webp)',
					'',
					'- Changed: `/og` draws the app icon, the name and the tagline on the brand horizon',
					'- Verified: `pnpm og` rendered it at 1200 by 630, and `pnpm test og` passes',
					'- Next: draw Grip and Malini from the same view',
					'',
					'Outcome: Tony’s OG image leads with the icon, not the hero',
					'Needs: nothing',
					'Commit: feat(site): lead the Open Graph image with the Tony icon',
					'Pull request: feat(site): lead the Open Graph image with the Tony icon',
				].join('\n'),
				usage: { inputTokens: 39_460, outputTokens: 1_520 },
			},
		],
	},
];

export const LEAD_PROMPT =
	'I don’t like our OG images. Show me directions we could take them, across all our sites.';

export const LEAD_ID = 'ws-og-lead';

export type StartedWorkstream = DemoWorkstream & Readonly<{ workMs: number }>;

const startedRun = (
	id: string,
	product: string,
	tools: readonly DemoTool[],
	report: string,
): DemoRun => ({
	id: `run-${id}-1`,
	prompt: `Prototype three Open Graph directions for ${product}: icon, product shot and type. Render each at 1200 by 630 under .context/ and report them as variants.`,
	from: LEAD_ID,
	startedAt: at('10:44'),
	tools,
	report,
	usage: { inputTokens: 28_400, outputTokens: 2_210 },
});

const directions = (prefix: string, product: string): string =>
	[
		`![Variant A: Icon - the ${product} icon on the brand horizon](.context/${prefix}og-icon.webp)`,
		`![Variant B: Product - the real app beside the headline](.context/${prefix}og-product.webp)`,
		`![Variant C: Type - one loud line, the family of icons below](.context/${prefix}og-type.webp)`,
	].join('\n');

const prototypeTools = (site: string): readonly DemoTool[] => [
	{ name: 'Read', input: { file_path: `${site}/og/+page.svelte` } },
	{ name: 'Write', input: { file_path: '.context/og/directions.html', content: '' } },
	{
		name: 'Bash',
		input: {
			command: 'npx playwright screenshot .context/og/directions.html',
			description: 'Render the three directions',
		},
		output: 'Saved 3 screenshots',
	},
];

export const STARTED: readonly StartedWorkstream[] = [
	{
		id: 'ws-og-malini',
		projectId: 'malini',
		name: 'OG directions for Malini',
		branch: 'malini/og-directions-for-malini',
		activeAt: at('10:45'),
		files: [],
		tree: TREES['malini'] ?? [],
		ship: null,
		workMs: 4_200,
		runs: [
			startedRun(
				'ws-og-malini',
				'Malini',
				prototypeTools('apps/site/src/routes'),
				[
					directions('', 'Malini'),
					'',
					'- Changed: three prototypes under `.context/og/`, nothing in `apps/site` yet',
					'',
					'Outcome: Three Malini OG directions are ready to pick',
					'Needs: pick the direction to build into `/og`',
				].join('\n'),
			),
		],
	},
	{
		id: 'ws-og-grip',
		projectId: 'grip',
		name: 'OG directions for Grip',
		branch: 'malini/og-directions-for-grip',
		activeAt: at('10:45'),
		files: [],
		tree: TREES['grip'] ?? [],
		ship: null,
		workMs: 4_600,
		runs: [
			startedRun(
				'ws-og-grip',
				'Grip',
				prototypeTools('site/src/routes'),
				[
					directions('grip-', 'Grip'),
					'',
					'- Changed: three prototypes under `.context/og/`, nothing in `site` yet',
					'',
					'Outcome: Three Grip OG directions are ready to pick',
					'Needs: pick the direction to build into `/og`',
				].join('\n'),
			),
		],
	},
	{
		id: 'ws-og-platform',
		projectId: 'platform',
		name: 'One OG view for every site',
		branch: 'malini/one-og-view-for-every-site',
		activeAt: at('10:45'),
		files: [
			{ path: 'og/OgImage.svelte', additions: 84, deletions: 0 },
			{ path: 'og/render.ts', additions: 61, deletions: 0 },
		],
		tree: TREES['platform'] ?? [],
		ship: null,
		workMs: 3_800,
		runs: [
			{
				id: 'run-ws-og-platform-1',
				prompt:
					'Draw every direction from one OG view in platform, so malini, grip and tony share it.',
				from: LEAD_ID,
				startedAt: at('10:44'),
				tools: [
					{ name: 'Read', input: { file_path: 'docs/design.md' } },
					{ name: 'Write', input: { file_path: 'og/OgImage.svelte', content: '' } },
					{ name: 'Write', input: { file_path: 'og/render.ts', content: '' } },
				],
				report: [
					'- Changed: `og/OgImage.svelte` draws the icon, product and type directions from one set of props',
					'- Verified: it renders all three sites at 1200 by 630 with the fonts from `docs/design.md`',
					'',
					'Outcome: Every Bestboy site can draw its OG image from one view',
					'Needs: nothing',
				].join('\n'),
				usage: { inputTokens: 31_050, outputTokens: 2_480 },
			},
		],
	},
];

export const LEAD_REPORT = [
	directions('', 'Malini'),
	'',
	'- Changed: nothing on any `main`, the prototypes live in their workstreams',
	'- Verified: all three draw from one view in `platform`, the way Tony’s new image already does',
	'',
	'Outcome: Three OG directions for every Bestboy site are ready',
	'Needs: pick the direction for malini, grip and tony',
].join('\n');

export const LEAD_WORKSTREAM: DemoWorkstream = {
	id: LEAD_ID,
	projectId: 'malini-lead-space',
	name: 'OG image directions',
	branch: 'main',
	activeAt: at('10:44'),
	files: [],
	tree: [],
	ship: null,
	scope: `owner:${OWNER}`,
	runs: [
		{
			id: 'run-og-lead-1',
			prompt: LEAD_PROMPT,
			startedAt: at('10:44'),
			tools: [],
			report: LEAD_REPORT,
			usage: { inputTokens: 21_900, outputTokens: 1_640 },
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
		scope: workstream.scope ?? null,
		startedBy: workstream.startedBy ?? null,
		activeAt: workstream.activeAt,
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: WORKSTREAM_PATH(workstream.id),
	};
}

export const sessionId = (workstreamId: string): string => `session-${workstreamId}`;

export function reportedWorkstream(id: string): DemoWorkstream | undefined {
	return [...WORKSTREAMS, ...STARTED, LEAD_WORKSTREAM].find((workstream) => workstream.id === id);
}

export function toolInput(workstreamId: string, tool: DemoTool): Record<string, unknown> {
	const path = tool.input['file_path'];
	if (typeof path !== 'string' || path.startsWith('/')) return tool.input;
	return { ...tool.input, file_path: `${WORKSTREAM_PATH(workstreamId)}/${path}` };
}

export function toolEvents(
	workstreamId: string,
	runId: string,
	tools: readonly DemoTool[],
	started: number,
): AgentEvent[] {
	return tools.flatMap((tool, index): AgentEvent[] => {
		const toolCallId = `${runId}-tool-${index}`;
		const ts = started + (index + 1) * 9_000;
		return [
			{
				type: 'tool.started',
				runId,
				name: tool.name,
				input: toolInput(workstreamId, tool),
				toolCallId,
				ts,
			},
			{
				type: 'tool.completed',
				runId,
				name: tool.name,
				output: tool.output ?? 'ok',
				toolCallId,
				ts: ts + (TOOL_MS[index % TOOL_MS.length] ?? 0),
			},
		];
	});
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
