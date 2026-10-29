import { DEMO_DAY, type DemoRun, type StartedWorkstream } from './demo-data';

const at = (time: string): string => `${DEMO_DAY}T${time}:00.000Z`;

export const TOUR_PROMPT = 'Every site we ship should link its changelog from the footer.';

export const TOUR_PAGE_URL = 'http://localhost:5173/';

export const TOUR_FEEDBACK =
	'Too loud next to Privacy and Terms. Use the same muted gray, underline it only on hover, and keep it on their baseline on a phone.';

export const TOUR_THREAD_REPORT = [
	'- Changed: the Changelog link uses the footer’s muted gray and underlines on hover',
	'- Verified: it sits on the Privacy and Terms baseline at 375px and at 1280px',
	'',
	'Outcome: The Changelog link reads like its neighbors in the footer',
	'Needs: nothing',
	'Commit: fix(site): quiet the changelog link in the footer',
	'Pull request: feat(site): link the changelog from the footer',
].join('\n');

const PROMPT =
	'Add a Changelog link to the footer, beside Privacy and Terms, that opens /changelog. Open the site so I can see it.';

const footerRun = (id: string, product: string, footer: string, opens: boolean): DemoRun => ({
	id: `run-${id}-1`,
	prompt: PROMPT,
	startedAt: at('11:02'),
	tools: [
		{ name: 'Read', input: { file_path: footer } },
		{
			name: 'Edit',
			input: {
				file_path: footer,
				old_string: '<a href="/terms">Terms</a>',
				new_string:
					'<a href="/terms">Terms</a>\n\t\t<a class="changelog" href="/changelog">Changelog</a>',
			},
		},
		{
			name: 'Bash',
			input: { command: 'pnpm test', description: 'Run the site tests' },
			output: '✓ tests/site.test.ts (14 tests) 1.2s',
		},
		...(opens
			? [{ name: 'mcp__malini__browser_open', input: { url: 'http://localhost:5173' } }]
			: []),
	],
	report: [
		'- Changed: the footer links to /changelog beside Privacy and Terms',
		'- Verified: `pnpm test` passes, and the link opens /changelog',
		'',
		`Outcome: ${product}’s footer links its changelog`,
		'Needs: nothing',
		'Commit: feat(site): link the changelog from the footer',
		'Pull request: feat(site): link the changelog from the footer',
	].join('\n'),
	usage: { inputTokens: 18_200, outputTokens: 940 },
});

const footer = (
	id: string,
	product: string,
	path: string,
	workMs: number,
	opens: string | undefined,
): StartedWorkstream => {
	const repository = product.toLowerCase();
	return {
		id,
		projectId: repository,
		name: 'Changelog link in the footer',
		branch: `malini/changelog-link-in-the-footer-${repository}`,
		activeAt: at('11:02'),
		files: [{ path, additions: 3, deletions: 0 }],
		tree: [path],
		ship: null,
		workMs,
		thought: `A Changelog link in ${product}’s footer, styled like Privacy and Terms. I will read the footer first.`,
		...(opens ? { opens } : {}),
		runs: [footerRun(id, product, path, opens !== undefined)],
	};
};

export const TOUR_TONY_ID = 'ws-changelog-tony';

export const TOUR_STARTED: readonly StartedWorkstream[] = [
	footer('ws-changelog-malini', 'Malini', 'apps/site/src/lib/Footer.svelte', 8_600, undefined),
	footer('ws-changelog-grip', 'Grip', 'site/src/lib/Footer.svelte', 9_400, undefined),
	footer(TOUR_TONY_ID, 'Tony', 'site/src/lib/Footer.svelte', 5_200, TOUR_PAGE_URL),
];

export const TOUR_REPORT = [
	'- Changed: a Changelog link in the footer of malini, grip and tony',
	'- Verified: each site’s tests pass, and each link opens /changelog',
	'',
	'Outcome: Every Bestboy site links its changelog from the footer',
	'Needs: nothing',
].join('\n');

export const TOUR_LEAD = {
	prompt: TOUR_PROMPT,
	name: 'Changelog in every footer',
	plan: 'A changelog link in every footer we ship. First, what is already in flight.',
	inFlight: '[]',
	split: 'One workstream per site, each adding the same footer link.',
	started: TOUR_STARTED,
	compare: 'All three footers link their changelog now.',
	report: TOUR_REPORT,
} as const;
