<script lang="ts">
	import { Loop } from './loop.svelte';
	import TerminalLines, { type TerminalLine } from './TerminalLines.svelte';

	type Tab = Readonly<{
		agent: string;
		path: string;
		words: number;
		essay: readonly TerminalLine[];
	}>;

	const TABS: readonly Tab[] = [
		{
			agent: 'claude',
			path: '~/acme/web',
			words: 1480,
			essay: [
				{
					kind: 'say',
					text: 'Done! The checkout test is no longer flaky. I ran it 200 times to be sure. Here’s a detailed write-up.',
				},
				{ kind: 'heading', text: 'Summary' },
				{
					kind: 'para',
					text: '`checkout.spec.ts` failed about one run in twelve. The cause was a race between the cart refresh and the payment form, which only showed up when the CI machine was busy.',
				},
				{ kind: 'heading', text: 'Root cause' },
				{
					kind: 'item',
					text: 'The cart store refreshes on mount, and the refresh resolves after the form reads the total.',
				},
				{ kind: 'item', text: 'On a busy runner, the form renders a stale total of `$0.00`.' },
				{
					kind: 'item',
					text: 'The test clicks Pay before the total updates, and Stripe’s test mode rejects a zero amount.',
				},
				{ kind: 'heading', text: 'What I changed' },
				{ kind: 'item', text: 'Awaited the cart refresh before rendering the total.' },
				{ kind: 'item', text: 'Replaced `waitForTimeout(500)` with a wait on the total itself.' },
				{
					kind: 'item',
					text: 'Removed two retries from `playwright.config.ts`. They hid the bug.',
				},
				{ kind: 'heading', text: 'Verification' },
				{
					kind: 'table',
					rows: [
						['Runs', 'Before', 'After'],
						['Local, 200×', '17 ✗', '0 ✗'],
						['CI, 50×', '4 ✗', '0 ✗'],
					],
				},
				{ kind: 'heading', text: 'Why not just add a retry?' },
				{
					kind: 'para',
					text: 'Retries make the suite green without making checkout correct. People on slow connections could hit the same stale total, so I fixed the race itself.',
				},
			],
		},
		{
			agent: 'claude',
			path: '~/acme/api',
			words: 1240,
			essay: [
				{
					kind: 'say',
					text: 'Done! Invoices now use the new tax API. Here’s a full summary of the changes, the reasoning behind them, and a few things to watch.',
				},
				{ kind: 'heading', text: 'Summary' },
				{
					kind: 'para',
					text: 'I moved invoice totals from the legacy `TaxCalc` module to the new `TaxClient`, kept the old path behind a flag, and added tests for every region we bill in.',
				},
				{ kind: 'heading', text: 'Changes' },
				{
					kind: 'item',
					text: '`invoice.ts` reads totals from `TaxClient` instead of computing them locally.',
				},
				{
					kind: 'item',
					text: '`tax-client.ts` is new. It wraps the API with retries, a 5 second timeout and a small cache.',
				},
				{
					kind: 'item',
					text: '`flags.ts` gains `useNewTax`, off by default, for a per-account rollout.',
				},
				{ kind: 'item', text: '14 tests updated, 6 added, all passing.' },
				{ kind: 'heading', text: 'Why this approach' },
				{
					kind: 'para',
					text: 'I weighed five options before settling on this one. Here they are in detail, with the tradeoffs of each:',
				},
				{
					kind: 'item',
					text: 'Calling the API from `invoice.ts`. Simplest, but every render would wait on the network.',
				},
				{
					kind: 'item',
					text: 'Precomputing tax nightly. Fast, but wrong for invoices created during the day.',
				},
				{
					kind: 'item',
					text: 'A queue and a worker. Robust, but a lot of moving parts for one number.',
				},
			],
		},
		{
			agent: 'codex',
			path: '~/acme/web',
			words: 968,
			essay: [
				{
					kind: 'say',
					glyph: '•',
					text: 'Upgraded vitest to v4. Below is a summary of the work, the decisions I made along the way, and some follow-ups you may want to consider.',
				},
				{ kind: 'heading', text: 'Changes' },
				{
					kind: 'item',
					text: 'Bumped `vitest` and `@vitest/ui` to 4.0.2, and the coverage plugin to match.',
				},
				{
					kind: 'item',
					text: 'Migrated 41 test files from `mockImplementation` chains to the new `vi.fn(impl)` form.',
				},
				{
					kind: 'item',
					text: 'Replaced 3 deprecated matchers: `toBeCalledWith`, `toBeCalledTimes` and `lastCalledWith`.',
				},
				{ kind: 'item', text: 'Moved the workspace file into `vitest.config.ts` as projects.' },
				{ kind: 'heading', text: 'Snapshots' },
				{
					kind: 'para',
					text: 'The serializer changed, so 212 snapshots were regenerated. I reviewed each one. 209 differ only in whitespace. The other 3 are listed below, with an explanation of each difference.',
				},
				{ kind: 'item', text: '`Button.test.ts`: the class order changed. Cosmetic.' },
				{ kind: 'item', text: '`Table.test.ts`: an empty `<tbody>` now renders. Also cosmetic.' },
				{ kind: 'item', text: '`Toast.test.ts`: the timestamp format changed. Cosmetic, mostly.' },
				{ kind: 'heading', text: 'Follow-ups' },
				{
					kind: 'item',
					text: "Consider `pool: 'threads'`. It cut local runs from 48s to 31s on my machine.",
				},
				{
					kind: 'item',
					text: 'The coverage thresholds could go from 70% to 80%. We are at 83% today.',
				},
				{
					kind: 'item',
					text: 'Three suites use fake timers in a way that v5 is expected to deprecate.',
				},
				{ kind: 'item', text: 'A CI job on Node 24 would catch the next upgrade earlier.' },
				{ kind: 'para', text: 'Happy to take on any of these if you’d like.' },
			],
		},
		{
			agent: 'claude',
			path: '~/acme/docs',
			words: 880,
			essay: [
				{
					kind: 'say',
					text: 'Done! I rewrote the Stripe webhooks guide. It’s now about twice as long, which I think is the right length for a topic this important.',
				},
				{ kind: 'heading', text: 'Summary' },
				{
					kind: 'para',
					text: 'The old guide covered setup in four steps. The new one covers signing, retries, replays, idempotency, local testing and monitoring, with examples in TypeScript, Python and Go.',
				},
				{ kind: 'heading', text: 'Structure' },
				{ kind: 'item', text: 'Overview, now with a sequence diagram of one delivery.' },
				{ kind: 'item', text: 'Verifying signatures, with three examples and a table of errors.' },
				{ kind: 'item', text: 'Handling retries, with a decision table for each status code.' },
				{ kind: 'item', text: 'Replaying events, with a warning box about duplicate charges.' },
				{ kind: 'item', text: 'Idempotency keys, with a note on how long Stripe keeps them.' },
				{ kind: 'item', text: 'Testing locally with the Stripe CLI, plus troubleshooting.' },
				{ kind: 'heading', text: 'Style notes' },
				{
					kind: 'para',
					text: 'I kept the tone consistent with the rest of the docs, used second person throughout, and added a short summary at the top of each section for readers in a hurry.',
				},
				{ kind: 'heading', text: 'Open questions' },
				{
					kind: 'item',
					text: 'Should the Go examples use the official SDK or plain `net/http`? I used both.',
				},
				{ kind: 'item', text: 'The monitoring section links a dashboard that may be internal.' },
				{
					kind: 'item',
					text: 'Do we want a separate page for Connect webhooks? I wrote one, just in case.',
				},
				{ kind: 'heading', text: 'Next steps' },
				{
					kind: 'para',
					text: 'If this looks good, I can give the other 11 guides in `docs/payments/` the same structure.',
				},
			],
		},
		{
			agent: 'gemini',
			path: '~/acme/api',
			words: 2016,
			essay: [
				{
					kind: 'say',
					glyph: '✦',
					text: 'I have completed the migration off the legacy ORM. Here is a detailed breakdown of each phase, the decisions made, and the current state of the codebase.',
				},
				{ kind: 'heading', text: 'Overview' },
				{
					kind: 'para',
					text: 'This report covers the move from `LegacyORM` to `Drizzle` across the `api` package. The work was done in five phases, described below in order.',
				},
				{ kind: 'heading', text: 'Phase 1: Analysis' },
				{ kind: 'item', text: 'Scanned 312 files for legacy ORM calls.' },
				{ kind: 'item', text: 'Grouped 1,108 call sites into 14 patterns.' },
				{ kind: 'item', text: 'Found 3 patterns with no direct equivalent.' },
				{ kind: 'heading', text: 'Phase 2: Planning' },
				{ kind: 'item', text: 'Ranked the 14 patterns by risk, then by size.' },
				{ kind: 'item', text: 'Wrote a codemod for the 9 simplest patterns.' },
				{ kind: 'item', text: 'Planned manual changes for the other 5.' },
				{ kind: 'heading', text: 'Phase 3: Codemod' },
				{
					kind: 'para',
					text: 'The codemod converted 912 call sites. I reviewed a sample of 120 by hand and found no errors. The remaining 196 were converted by hand in Phase 4.',
				},
				{ kind: 'heading', text: 'Phase 4: Manual changes' },
				{ kind: 'item', text: 'Rewrote 3 raw SQL helpers as typed queries.' },
				{ kind: 'item', text: 'Replaced 41 lazy relations with explicit joins.' },
				{ kind: 'item', text: 'Converted 152 transactions to the callback form.' },
				{ kind: 'heading', text: 'Phase 5: Verification' },
				{
					kind: 'para',
					text: 'All 1,840 tests pass. Queries per request dropped by 22% on average. A table of the numbers for each of the 64 endpoints follows.',
				},
			],
		},
		{
			agent: 'claude',
			path: '~/acme/ios',
			words: 1102,
			essay: [
				{
					kind: 'say',
					text: 'Done! All 312 tests pass on iOS 19. Here’s the full report, including what broke, why, and what I did about each failure.',
				},
				{ kind: 'heading', text: 'Summary' },
				{ kind: 'item', text: 'Fixed 9 failing UI tests.' },
				{ kind: 'item', text: 'Replaced 2 deprecated APIs.' },
				{ kind: 'item', text: 'Raised the deployment target to iOS 17.' },
				{ kind: 'heading', text: 'Test results' },
				{
					kind: 'table',
					rows: [
						['Suite', 'Passed', 'Failed'],
						['Unit', '268', '0'],
						['UI', '44', '0'],
					],
				},
				{ kind: 'heading', text: 'Failures, one by one' },
				{
					kind: 'para',
					text: '1. `LoginFlowTests.testRememberMe`: the keychain prompt is now a sheet, not an alert, so the test tapped a button that no longer existed. I updated the query to find the sheet.',
				},
				{
					kind: 'para',
					text: '2. `FeedTests.testPullToRefresh`: the refresh control needs a longer drag now. I raised the drag distance from 120 to 160 points.',
				},
				{
					kind: 'para',
					text: '3. `CheckoutTests.testApplePay`: the payment sheet animates in now, so the test tapped before it arrived. I wait for the sheet first.',
				},
				{
					kind: 'para',
					text: '4. `SettingsTests.testDarkMode`: the toggle moved into a submenu. I updated the path to it.',
				},
				{
					kind: 'para',
					text: '5. `ProfileTests.testAvatarUpload`: the photo picker runs out of process now. I switched to the new picker API, which also clears a deprecation warning.',
				},
			],
		},
	];

	type Moment = Readonly<{ on: number; done: readonly number[] }>;

	const START: Moment = { on: 0, done: [0, 2, 3] };

	const SCRIPT: readonly Moment[] = [
		START,
		{ on: 2, done: [0, 1, 2, 3] },
		{ on: 3, done: [0, 1, 2, 3, 5] },
		{ on: 1, done: [0, 1, 2, 3, 5] },
		{ on: 5, done: [0, 1, 2, 3, 4, 5] },
		{ on: 4, done: [0, 1, 2, 3, 4, 5] },
	];

	const PANE = 170;
	const SKIM = 220;
	const WORDS_PER_LINE = 9;
	const LINE = 18;

	const loop = new Loop(SCRIPT.map(() => 3600));
	const now = $derived(SCRIPT[loop.step] ?? START);
	const tab = $derived(TABS[now.on] ?? TABS[0]);
	const unread = $derived(now.done.reduce((sum, index) => sum + (TABS[index]?.words ?? 0), 0));
	const essayHeight = $derived(((tab?.words ?? 0) / WORDS_PER_LINE) * LINE);
	const thumb = $derived(Math.max(6, (PANE / essayHeight) * 100));
	const travel = $derived((SKIM / essayHeight) * PANE);
</script>

<div class="tabs" {@attach loop.play}>
	<div class="strip">
		{#each TABS as { agent }, index (index)}
			<span class={['tab', { on: index === now.on, done: now.done.includes(index) }]}>
				<i></i>
				<span>{agent}</span>
			</span>
		{/each}
	</div>
	{#if tab}
		<div class="pane">
			<div class="where">
				<span>{tab.path}</span>
				<span>{tab.words.toLocaleString('en-US')} words</span>
			</div>
			{#key now.on}
				<div class="essay" style:--skim="-{SKIM}px" style:--travel="{travel}px">
					<div class="page">
						<TerminalLines lines={tab.essay} />
					</div>
					<span class="thumb" style:height="{thumb}%"></span>
				</div>
			{/key}
		</div>
	{/if}
	<div class="foot">
		<span>
			<b>{now.done.length}</b>
			of {TABS.length} done
		</span>
		<span>
			<b>{unread.toLocaleString('en-US')}</b>
			words unread
		</span>
	</div>
</div>

<style>
	.tabs {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}

	.strip {
		display: flex;
		flex: none;
		height: 34px;
		border-bottom: 1px solid var(--term-line);
		background: var(--term-2);
	}

	.tab {
		display: flex;
		flex: 1 1 0;
		align-items: center;
		gap: 7px;
		min-width: 0;
		padding: 0 10px;
		border-right: 1px solid var(--term-line);
		color: var(--term-faint);
		font-size: 11px;
		transition: color 300ms var(--ease);
	}

	.tab:last-child {
		border-right: 0;
	}

	.tab span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tab i {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--term-clay);
		animation: busy 1.2s ease-in-out infinite;
	}

	@keyframes busy {
		50% {
			opacity: 0.3;
		}
	}

	.tab.done i {
		background: var(--term-pick);
		box-shadow: 0 0 8px color-mix(in srgb, var(--term-pick) 70%, transparent);
		animation: none;
	}

	.tab.on {
		background: var(--term);
		color: var(--term-fg);
	}

	.pane {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		padding: 12px 16px 0;
	}

	.where {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		color: var(--term-faint);
		white-space: nowrap;
	}

	.essay {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		padding: 10px 14px 0 0;
		mask-image: linear-gradient(transparent, #000 10px, #000 70%, transparent);
		animation: swap 400ms var(--ease) backwards;
	}

	@keyframes swap {
		from {
			opacity: 0;
		}
	}

	.page,
	.thumb {
		animation: skim 2.6s 0.7s cubic-bezier(0.45, 0, 0.4, 1) both;
	}

	.page {
		display: flex;
		flex-direction: column;
		--skim-to: var(--skim);
	}

	.thumb {
		position: absolute;
		top: 12px;
		right: 0;
		width: 4px;
		border-radius: 2px;
		background: var(--term-edge);
		--skim-to: var(--travel);
	}

	@keyframes skim {
		to {
			translate: 0 var(--skim-to);
		}
	}

	.foot {
		display: flex;
		flex: none;
		justify-content: space-between;
		gap: 12px;
		margin-top: auto;
		padding: 10px 16px;
		border-top: 1px solid var(--term-line);
		color: var(--term-dim);
		font-size: 11px;
		white-space: nowrap;
	}

	.foot b {
		color: var(--term-pick);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 559px) {
		.tab {
			gap: 4px;
			padding: 0 5px;
			font-size: 10px;
		}

		.tab i {
			width: 5px;
			height: 5px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tab i,
		.essay,
		.page,
		.thumb {
			animation: none;
		}
	}
</style>
