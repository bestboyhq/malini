<script lang="ts">
	import { Loop } from './loop.svelte';

	const TABS = [
		{
			agent: 'claude',
			path: '~/acme/web',
			words: 431,
			glyph: '⏺',
			say: 'Done! The login button works again. Here’s a full summary.',
			lines: [
				'# Summary',
				'The button sent two sign-in requests per click.',
				'# Root cause',
				'- The click handler calls signIn()',
				'- The form’s submit event calls it again',
				'# What I changed',
				'- Added type="button" to the button',
			],
		},
		{
			agent: 'claude',
			path: '~/acme/api',
			words: 1240,
			glyph: '⏺',
			say: 'Done! Invoices now use the new tax API. Here’s what changed.',
			lines: [
				'# Summary',
				'- invoice.ts reads totals from TaxClient',
				'- tax-client.ts is new, with retries and a timeout',
				'- 14 tests updated, 6 added, all passing',
				'# Why this approach',
				'I weighed five options. Here they are, in detail:',
				'- Option 1: keep the old client behind a flag',
			],
		},
		{
			agent: 'codex',
			path: '~/acme/web',
			words: 968,
			glyph: '•',
			say: 'Upgraded vitest to v4. Summary of the work below.',
			lines: [
				'# Changes',
				'- Bumped vitest and @vitest/ui to 4.0.2',
				'- Migrated 41 test files to the new config',
				'- Replaced 3 deprecated matchers',
				'# Notes',
				'- The snapshot format changed, so 212 snapshots',
				'  were regenerated. I reviewed each one and',
			],
		},
		{
			agent: 'claude',
			path: '~/acme/docs',
			words: 880,
			glyph: '⏺',
			say: 'Done! I rewrote the Stripe webhooks guide. Highlights below.',
			lines: [
				'# Summary',
				'The guide now covers signing, retries and replays.',
				'# Structure',
				'- Overview, now with a diagram',
				'- Verifying signatures, with three examples',
				'- Handling retries, with a decision table',
				'- Replaying events, with a warning box',
			],
		},
		{
			agent: 'gemini',
			path: '~/acme/api',
			words: 2016,
			glyph: '✦',
			say: 'I have completed the migration. Here is a detailed breakdown.',
			lines: [
				'# Overview',
				'This report covers the move off the legacy ORM.',
				'# Phase 1: Analysis',
				'- Scanned 312 files for legacy ORM calls',
				'- Grouped 1,108 call sites into 14 patterns',
				'# Phase 2: Planning',
				'- Ranked the 14 patterns by risk, then by size',
			],
		},
		{
			agent: 'claude',
			path: '~/acme/ios',
			words: 1102,
			glyph: '⏺',
			say: 'Done! All 312 tests pass on iOS 19. Here’s the full report.',
			lines: [
				'# Summary',
				'- Fixed 9 failing UI tests',
				'- Replaced 2 deprecated APIs',
				'- Bumped the deployment target to iOS 17',
				'# Test results',
				'- Unit: 268 passed, 0 failed',
				'- UI: 44 passed, 0 failed, 3 a little slow',
			],
		},
	] as const;

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

	const loop = new Loop(SCRIPT.map(() => 2600));
	const now = $derived(SCRIPT[loop.step] ?? START);
	const tab = $derived(TABS[now.on] ?? TABS[0]);
	const unread = $derived(now.done.reduce((sum, index) => sum + (TABS[index]?.words ?? 0), 0));
	const thumb = $derived(Math.max(6, 7000 / tab.words));
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
	<div class="pane">
		<div class="where">
			<span>{tab.path}</span>
			<span>{tab.words.toLocaleString('en-US')} words</span>
		</div>
		{#key now.on}
			<div class="essay">
				<div class="line">
					<span class={['glyph', tab.agent]}>{tab.glyph}</span>
					<span class="text">{tab.say}</span>
				</div>
				{#each tab.lines as line, index (index)}
					<div class={['line', 'body', { heading: line.startsWith('# ') }]}>
						{line.replace(/^# /, '')}
					</div>
				{/each}
				<span class="thumb" style:height="{thumb}%"></span>
			</div>
		{/key}
	</div>
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
		margin-top: 8px;
		overflow: hidden;
		padding-right: 14px;
		mask-image: linear-gradient(#000 60%, transparent);
		animation: swap 400ms var(--ease) backwards;
	}

	@keyframes swap {
		from {
			opacity: 0;
		}
	}

	.line {
		display: flex;
		height: 18px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: pre;
	}

	.glyph {
		flex: none;
		margin-right: 1ch;
		color: var(--term-fg);
	}

	.glyph.gemini {
		color: var(--term-pick);
	}

	.text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.body {
		display: block;
		padding-left: 2ch;
		color: var(--term-dim);
	}

	.heading {
		margin-top: 4px;
		color: var(--term-fg);
		font-weight: 600;
	}

	.thumb {
		position: absolute;
		top: 2px;
		right: 0;
		width: 4px;
		border-radius: 2px;
		background: var(--term-edge);
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
		.essay {
			animation: none;
		}
	}
</style>
