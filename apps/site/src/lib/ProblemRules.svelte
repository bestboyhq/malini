<script lang="ts">
	import { Loop } from './loop.svelte';

	const RULE = '- No stacked PRs';
	const LINES = ['## Rules', '- pnpm, never npm', '- Tabs, not spaces'];

	const FILES = [
		{ name: 'CLAUDE.md', first: 12 },
		{ name: 'AGENTS.md', first: 31 },
		{ name: 'GEMINI.md', first: 7 },
	] as const;

	const STALE = {
		name: '.cursorrules',
		first: 2,
		lines: ['## Rules', '- npm is fine', '- Tabs, not spaces'],
	} as const;

	const loop = new Loop([900, 1100, 1100, 1100, 4400]);
	const pasted = $derived(Math.min(loop.step, FILES.length));
	const caught = $derived(loop.step === loop.last);
</script>

<div class="rules" {@attach loop.play}>
	{#each FILES as file, index (file.name)}
		{@const done = index < pasted}
		<div class={['pane', { done }]}>
			<div class="bar">
				<i></i>
				<span class="name">{file.name}</span>
				<span class="when">{done ? 'just now' : 'Oct 2'}</span>
			</div>
			<div class="code">
				{#each LINES as line, offset (offset)}
					<span class="line">
						<span class="number">{file.first + offset}</span>
						<span class="text">{line}</span>
					</span>
				{/each}
				<span class="line added">
					<span class="number">{file.first + LINES.length}</span>
					{#if done}
						<span class="text typed">{RULE}</span>
					{/if}
				</span>
			</div>
		</div>
	{/each}
	<div class={['pane', { stale: caught }]}>
		<div class="bar">
			<i></i>
			<span class="name">{STALE.name}</span>
			<span class="when">Aug 14</span>
		</div>
		<div class="code">
			{#each STALE.lines as line, offset (offset)}
				<span class="line">
					<span class="number">{STALE.first + offset}</span>
					<span class="text">
						<span class={{ squiggle: offset === 1 }}>{line}</span>
					</span>
				</span>
			{/each}
			<span class="line">
				<span class="number">{STALE.first + STALE.lines.length}</span>
			</span>
		</div>
	</div>
</div>

<style>
	.rules {
		display: grid;
		flex: 1;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		grid-template-rows: repeat(2, minmax(0, 1fr));
		gap: 10px;
		padding: 14px;
		background: radial-gradient(120% 90% at 0% 0%, var(--term-card), var(--term) 60%);
	}

	.pane {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: 8px;
		background: var(--term-2);
		box-shadow: 0 0 0 1px var(--term-line);
	}

	.bar {
		display: flex;
		flex: none;
		align-items: center;
		gap: 8px;
		height: 28px;
		padding: 0 10px;
		border-bottom: 1px solid var(--term-line);
		background: rgb(255 255 255 / 0.02);
		font-size: 11px;
		white-space: nowrap;
	}

	.bar i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		color: var(--term-raised);
		transition:
			color 300ms var(--ease),
			box-shadow 300ms var(--ease);
	}

	.done .bar i {
		color: var(--term-pick);
		box-shadow: 0 0 8px color-mix(in srgb, var(--term-pick) 70%, transparent);
	}

	.stale .bar i {
		color: var(--term-clay);
		box-shadow: 0 0 8px color-mix(in srgb, var(--term-clay) 60%, transparent);
	}

	.name {
		color: var(--term-fg);
		font-weight: 500;
	}

	.when {
		margin-left: auto;
		color: var(--term-faint);
		font-variant-numeric: tabular-nums;
		transition: color 300ms var(--ease);
	}

	.done .when {
		color: var(--term-pick);
	}

	.stale .when {
		color: var(--term-clay);
	}

	.code {
		display: flex;
		flex-direction: column;
		padding: 6px 0;
	}

	.line {
		position: relative;
		display: flex;
		height: 18px;
		white-space: nowrap;
	}

	.number {
		flex: none;
		width: 4ch;
		padding-right: 1ch;
		color: var(--term-faint);
		text-align: right;
		opacity: 0.7;
	}

	.text {
		min-width: 0;
		overflow: hidden;
		padding-left: 2ch;
		color: var(--term-dim);
		text-overflow: ellipsis;
	}

	.added::before {
		position: absolute;
		top: 2px;
		bottom: 2px;
		left: calc(4ch + 0.75ch);
		width: 2px;
		border-radius: 1px;
		background: var(--term-pick);
		content: '';
		opacity: 0;
		transition: opacity 300ms var(--ease);
	}

	.done .added {
		background: color-mix(in srgb, var(--term-pick) 9%, transparent);
	}

	.done .added::before {
		opacity: 1;
	}

	.typed {
		color: var(--term-fg);
		animation: type 650ms steps(16) both;
	}

	@keyframes type {
		from {
			clip-path: inset(0 100% 0 0);
		}
	}

	.squiggle {
		position: relative;
	}

	.squiggle::after {
		position: absolute;
		right: 0;
		bottom: -1px;
		left: 0;
		height: 4px;
		background: var(--term-clay);
		content: '';
		opacity: 0;
		mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='4'%3E%3Cpath d='M0 3 Q1.5 0.5 3 2 T6 1' fill='none' stroke='black' stroke-width='1.1'/%3E%3C/svg%3E")
			repeat-x 0 0 / 6px 4px;
		transition: opacity 400ms var(--ease);
	}

	.stale .squiggle::after {
		opacity: 1;
	}

	@media (max-width: 559px) {
		.rules {
			gap: 8px;
			padding: 10px;
		}

		.number {
			width: 3ch;
			padding-right: 0.5ch;
		}

		.text {
			padding-left: 1.5ch;
		}

		.added::before {
			left: 3.4ch;
		}

		.when {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.typed {
			animation: none;
		}
	}
</style>
