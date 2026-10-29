import type { AgentEventEnvelope, AgentSessionSummary } from '$contract/agent';
import type { ProjectDto, WorkstreamDto, WorkstreamFileEntry } from '$contract/repositories';
import type { ShipStateRecord } from '$contract/pull-requests';
import type { AgentEvent } from '$lib/chat/domain/events';

export const DEMO_DAY = '2026-10-29';

const at = (time: string): string => `${DEMO_DAY}T${time}:00.000Z`;

export const PROJECTS: ProjectDto[] = [
	{
		id: 'acme-web',
		name: 'web',
		repoPath: '/Users/you/Malini/repositories/acme/web',
		defaultBranch: 'main',
		createdAt: at('08:00'),
		remoteUrl: 'https://github.com/acme/web.git',
	},
	{
		id: 'acme-api',
		name: 'api',
		repoPath: '/Users/you/Malini/repositories/acme/api',
		defaultBranch: 'main',
		createdAt: at('08:00'),
		remoteUrl: 'https://github.com/acme/api.git',
	},
];

type DemoFile = Readonly<{ path: string; additions: number; deletions: number }>;

type DemoWorkstream = Readonly<{
	id: string;
	projectId: string;
	name: string;
	branch: string;
	activeAt: string;
	files: readonly DemoFile[];
	tree: readonly string[];
	runs: readonly DemoRun[];
	ship: Pick<ShipStateRecord, 'phase' | 'step' | 'pullRequestNumber'> | null;
}>;

type DemoTool = Readonly<{ name: string; input: Record<string, unknown>; output?: unknown }>;

export type DemoRun = Readonly<{
	id: string;
	prompt: string;
	startedAt: string;
	tools: readonly DemoTool[];
	report: string;
	usage: Readonly<{ inputTokens: number; outputTokens: number }>;
}>;

const WEB_TREE = [
	'.github/workflows/ci.yml',
	'AGENTS.md',
	'README.md',
	'package.json',
	'pnpm-lock.yaml',
	'src/app.css',
	'src/routes/+layout.svelte',
	'src/routes/+page.svelte',
	'src/routes/checkout/+page.svelte',
	'src/routes/checkout/PayButton.svelte',
	'src/routes/pricing/+page.svelte',
	'src/routes/pricing/PlanCard.svelte',
	'src/routes/pricing/PricingHero.svelte',
	'src/lib/tokens.css',
	'tests/checkout.spec.ts',
	'tests/pricing.spec.ts',
	'tsconfig.json',
	'vite.config.ts',
];

const API_TREE = [
	'.github/workflows/ci.yml',
	'AGENTS.md',
	'README.md',
	'go.mod',
	'go.sum',
	'cmd/api/main.go',
	'internal/http/middleware/ratelimit.go',
	'internal/http/middleware/ratelimit_test.go',
	'internal/http/router.go',
	'internal/webhooks/deliver.go',
	'internal/webhooks/deliver_test.go',
	'docs/rate-limits.md',
];

export const WORKSTREAMS: readonly DemoWorkstream[] = [
	{
		id: 'ws-checkout',
		projectId: 'acme-web',
		name: 'Checkout button contrast',
		branch: 'malini/checkout-button-contrast',
		activeAt: at('10:42'),
		files: [
			{ path: 'src/routes/checkout/PayButton.svelte', additions: 6, deletions: 4 },
			{ path: 'src/lib/tokens.css', additions: 2, deletions: 1 },
		],
		tree: WEB_TREE,
		ship: null,
		runs: [
			{
				id: 'run-checkout-1',
				prompt:
					'The Pay button on checkout is hard to read in dark mode. Fix the contrast and keep the brand color.',
				startedAt: at('10:38'),
				tools: [
					{
						name: 'Read',
						input: { file_path: 'src/routes/checkout/PayButton.svelte' },
					},
					{
						name: 'Bash',
						input: {
							command: 'pnpm exec playwright screenshot --color-scheme=dark /checkout before.png',
							description: 'Capture the checkout in dark mode',
						},
						output: 'Saved .context/checkout-before.png',
					},
					{
						name: 'Edit',
						input: {
							file_path: 'src/lib/tokens.css',
							old_string: '--pay-fg: var(--indigo-200);',
							new_string: '--pay-fg: var(--white);',
						},
					},
					{
						name: 'Edit',
						input: {
							file_path: 'src/routes/checkout/PayButton.svelte',
							old_string: 'background: var(--brand-500);',
							new_string: 'background: var(--brand-600);',
						},
					},
					{
						name: 'Bash',
						input: {
							command: 'pnpm test checkout',
							description: 'Run the checkout tests',
						},
						output: '✓ tests/checkout.spec.ts (6 tests) 2.1s',
					},
				],
				report: [
					'![Before: Pay button in dark mode, grey on indigo](.context/checkout-before.webp)',
					'![After: Pay button in dark mode, white on deep indigo](.context/checkout-after.webp)',
					'',
					'- Changed: the Pay button reads white on a deeper brand indigo, 7.1:1 contrast',
					'- Verified: `pnpm test checkout` passes, light mode is unchanged',
					'- Next: apply the same token to the Upgrade button in settings',
					'',
					'Outcome: The Pay button passes WCAG AAA in dark mode',
					'Needs: nothing',
					'Commit: fix(checkout): raise the Pay button contrast in dark mode',
					'Pull request: fix(checkout): raise the Pay button contrast in dark mode',
				].join('\n'),
				usage: { inputTokens: 48_210, outputTokens: 1_960 },
			},
		],
	},
	{
		id: 'ws-pricing',
		projectId: 'acme-web',
		name: 'Pricing page hero',
		branch: 'malini/pricing-page-hero',
		activeAt: at('10:31'),
		files: [],
		tree: WEB_TREE,
		ship: null,
		runs: [
			{
				id: 'run-pricing-1',
				prompt:
					'Give the pricing page a hero that sells the annual plan. Show me a few directions.',
				startedAt: at('10:22'),
				tools: [
					{ name: 'Read', input: { file_path: 'src/routes/pricing/+page.svelte' } },
					{ name: 'Read', input: { file_path: 'src/routes/pricing/PlanCard.svelte' } },
					{
						name: 'Write',
						input: { file_path: '.context/pricing-hero/index.html', content: '' },
					},
					{
						name: 'Bash',
						input: {
							command: 'pnpm exec playwright screenshot .context/pricing-hero/a.html a.webp',
							description: 'Capture each variant',
						},
						output: 'Saved 3 screenshots',
					},
				],
				report: [
					'![Variant A: Toggle - monthly and annual side by side, annual preselected](.context/pricing-a.webp)',
					'![Variant B: Savings - one big number, what a year saves](.context/pricing-b.webp)',
					'![Variant C: Calm - a quiet headline and the plan cards up top](.context/pricing-c.webp)',
					'',
					'- Changed: three hero prototypes under `.context/pricing-hero/`, nothing in `src/` yet',
					'',
					'Outcome: Three pricing hero directions are ready to pick',
					'Needs: pick the variant to build into the pricing page',
				].join('\n'),
				usage: { inputTokens: 61_480, outputTokens: 4_120 },
			},
		],
	},
	{
		id: 'ws-rate-limit',
		projectId: 'acme-api',
		name: 'Rate limit headers',
		branch: 'malini/rate-limit-headers',
		activeAt: at('09:58'),
		files: [
			{ path: 'internal/http/middleware/ratelimit.go', additions: 24, deletions: 3 },
			{ path: 'internal/http/middleware/ratelimit_test.go', additions: 41, deletions: 0 },
			{ path: 'docs/rate-limits.md', additions: 9, deletions: 2 },
		],
		tree: API_TREE,
		ship: { phase: 'queued', step: 'waiting-for-checks', pullRequestNumber: 412 },
		runs: [
			{
				id: 'run-rate-limit-1',
				prompt: 'Where do we rate limit requests today, and how is a quota counted?',
				startedAt: at('09:31'),
				tools: [
					{ name: 'Grep', input: { pattern: 'RateLimit|quota', path: 'internal' } },
					{ name: 'Read', input: { file_path: 'internal/http/middleware/ratelimit.go' } },
					{ name: 'Read', input: { file_path: 'internal/http/router.go' } },
				],
				report: [
					'- Changed: nothing, this turn only read the code',
					'- Verified: one middleware in `ratelimit.go` counts 600 requests a minute per API token',
					'',
					'Outcome: Rate limits live in one middleware, keyed by API token',
					'Needs: nothing',
				].join('\n'),
				usage: { inputTokens: 18_220, outputTokens: 940 },
			},
			{
				id: 'run-rate-limit-2',
				prompt:
					'Send RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset on every response, and Retry-After on a 429.',
				startedAt: at('09:41'),
				tools: [
					{
						name: 'Edit',
						input: {
							file_path: 'internal/http/middleware/ratelimit.go',
							old_string: 'if !allowed {',
							new_string: 'setRateLimitHeaders(w, quota)\n\tif !allowed {',
						},
					},
					{
						name: 'Write',
						input: { file_path: 'internal/http/middleware/ratelimit_test.go', content: '' },
					},
					{
						name: 'Bash',
						input: { command: 'go test ./internal/http/...', description: 'Run the HTTP tests' },
						output: 'ok  \tacme/api/internal/http/middleware\t0.412s',
					},
				],
				report: [
					'- Changed: every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`',
					'- Changed: a 429 adds `Retry-After` in seconds',
					'- Verified: `go test ./internal/http/...` passes, 7 new cases',
					'',
					'Outcome: Clients can see their quota on every response',
					'Needs: nothing',
				].join('\n'),
				usage: { inputTokens: 39_870, outputTokens: 2_340 },
			},
			{
				id: 'run-rate-limit-3',
				prompt: 'Document the headers for API clients.',
				startedAt: at('09:52'),
				tools: [
					{ name: 'Read', input: { file_path: 'docs/rate-limits.md' } },
					{
						name: 'Edit',
						input: {
							file_path: 'docs/rate-limits.md',
							old_string: '## Limits',
							new_string: '## Limits\n\n## Headers',
						},
					},
					{
						name: 'Bash',
						input: {
							command: 'curl -si localhost:8080/v1/projects | grep -i ratelimit',
							description: 'Check the headers on a real response',
						},
						output: 'RateLimit-Limit: 600\nRateLimit-Remaining: 599\nRateLimit-Reset: 60',
					},
				],
				report: [
					'- Changed: `docs/rate-limits.md` explains all four headers, with an example response',
					'- Verified: the example matches `curl -si` against the dev server',
					'- Next: add the four headers to the OpenAPI spec',
					'',
					'Outcome: API clients can read how to stay under their quota',
					'Needs: nothing',
					'Commit: feat(http): send rate limit headers on every response',
					'Pull request: feat(http): send rate limit headers on every response',
				].join('\n'),
				usage: { inputTokens: 44_120, outputTokens: 1_880 },
			},
		],
	},
	{
		id: 'ws-webhooks',
		projectId: 'acme-api',
		name: 'Retry failed webhooks',
		branch: 'malini/retry-failed-webhooks',
		activeAt: at('09:20'),
		files: [{ path: 'internal/webhooks/deliver.go', additions: 31, deletions: 8 }],
		tree: API_TREE,
		ship: { phase: 'draft', step: null, pullRequestNumber: 409 },
		runs: [
			{
				id: 'run-webhooks-1',
				prompt: 'Retry failed webhook deliveries with exponential backoff, five tries at most.',
				startedAt: at('09:05'),
				tools: [
					{ name: 'Read', input: { file_path: 'internal/webhooks/deliver.go' } },
					{ name: 'Edit', input: { file_path: 'internal/webhooks/deliver.go' } },
					{
						name: 'Bash',
						input: {
							command: 'go test ./internal/webhooks/...',
							description: 'Run the webhook tests',
						},
						output: 'ok  \tacme/api/internal/webhooks\t1.204s',
					},
				],
				report: [
					'- Changed: a failed delivery retries after 1, 2, 4 and 8 minutes, then gives up',
					'- Verified: `go test ./internal/webhooks/...` passes',
					'',
					'Outcome: Failed webhooks retry five times with backoff',
					'Needs: nothing',
					'Commit: feat(webhooks): retry failed deliveries with backoff',
					'Pull request: feat(webhooks): retry failed deliveries with backoff',
				].join('\n'),
				usage: { inputTokens: 22_640, outputTokens: 1_310 },
			},
		],
	},
];

const TOOL_MS = [420, 2_150, 180, 140, 3_900, 260];

export const WORKSTREAM_PATH = (id: string): string => `/Users/you/Malini/workstreams/${id}`;

export function workstreamDtos(): WorkstreamDto[] {
	return WORKSTREAMS.map((workstream) => ({
		id: workstream.id,
		projectId: workstream.projectId,
		name: workstream.name,
		path: WORKSTREAM_PATH(workstream.id),
		branch: workstream.branch,
		baseBranch: 'main',
		status: 'active',
		createdAt: workstream.runs[0]?.startedAt ?? workstream.activeAt,
		scope: null,
		startedBy: null,
		activeAt: workstream.activeAt,
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: WORKSTREAM_PATH(workstream.id),
	}));
}

export const sessionId = (workstreamId: string): string => `session-${workstreamId}`;

export function workstreamOf(id: string): DemoWorkstream | undefined {
	return WORKSTREAMS.find((workstream) => workstream.id === id);
}

export function sessionSummaries(workstreamId: string): AgentSessionSummary[] {
	const workstream = workstreamOf(workstreamId);
	if (!workstream) return [];
	return [
		{
			id: sessionId(workstreamId),
			workstreamId,
			displayName: workstream.name,
			model: 'claude-opus-5-5',
			status: 'completed',
			startedAt: workstream.runs[0]?.startedAt ?? workstream.activeAt,
			origin: 'user',
		},
	];
}

export function runEvents(workstreamId: string, run: DemoRun): AgentEvent[] {
	const absolute = (path: unknown): unknown =>
		typeof path === 'string' && !path.startsWith('/')
			? `${WORKSTREAM_PATH(workstreamId)}/${path}`
			: path;
	const started = Date.parse(run.startedAt);
	const events: AgentEvent[] = [
		{ type: 'run.started', runId: run.id, sessionId: sessionId(workstreamId) },
		{ type: 'user.message', runId: run.id, text: run.prompt },
	];
	run.tools.forEach((tool, index) => {
		const toolCallId = `${run.id}-tool-${index}`;
		const input = { ...tool.input, file_path: absolute(tool.input['file_path']) };
		if (input.file_path === undefined) delete input.file_path;
		const ts = started + (index + 1) * 9_000;
		events.push(
			{ type: 'tool.started', runId: run.id, name: tool.name, input, toolCallId, ts },
			{
				type: 'tool.completed',
				runId: run.id,
				name: tool.name,
				output: tool.output ?? 'ok',
				toolCallId,
				ts: ts + (TOOL_MS[index % TOOL_MS.length] ?? 0),
			},
		);
	});
	events.push(
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
	);
	return events;
}

export function sessionEnvelopes(id: string): AgentEventEnvelope[] {
	const workstream = WORKSTREAMS.find((candidate) => sessionId(candidate.id) === id);
	if (!workstream) return [];
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

export function workstreamFiles(id: string): WorkstreamFileEntry[] {
	return (workstreamOf(id)?.tree ?? []).map((path) => ({ path }));
}
