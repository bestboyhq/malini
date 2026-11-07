<script lang="ts">
	import { Loop } from './loop.svelte';

	const FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'] as const;
	const STALE = '.cursorrules';
	const RULE = '- No stacked PRs';

	const loop = new Loop([600, 1100, 1100, 1300, 4300]);
</script>

<div class="files" {@attach loop.play}>
	{#each FILES as name, index (name)}
		<div class={['file', { typed: loop.step > index }]}>
			<div class="name">
				<span>{name}</span>
				<span class="age">today</span>
			</div>
			<div class="lines">
				<div class="heading">## Rules</div>
				<div>- pnpm, never npm</div>
				<div>- Tabs, not spaces</div>
				<div class="added">{RULE}</div>
			</div>
		</div>
	{/each}
	<div class={['file', { stale: loop.step === loop.last }]}>
		<div class="name">
			<span>{STALE}</span>
			<span class="age">Aug 14</span>
		</div>
		<div class="lines">
			<div class="heading">## Rules</div>
			<div class="old">- npm is fine</div>
			<div>- Tabs, not spaces</div>
			<div>&nbsp;</div>
		</div>
	</div>
</div>

<style>
	.files {
		display: grid;
		flex: 1;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		align-content: center;
		gap: 10px;
		padding: 14px;
	}

	.file {
		min-width: 0;
		overflow: hidden;
		border-radius: 8px;
		background: var(--term-card);
		box-shadow: 0 0 0 1px var(--term-line);
		transition: box-shadow 400ms var(--ease);
	}

	.name {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding: 7px 10px;
		border-bottom: 1px solid var(--term-line);
		color: var(--term-fg);
		font-size: 11px;
		white-space: nowrap;
	}

	.age {
		overflow: hidden;
		color: var(--term-faint);
		text-overflow: ellipsis;
	}

	.lines {
		padding: 6px 10px 8px;
		color: var(--term-dim);
		font-size: 11px;
		line-height: 17px;
	}

	.lines div {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.heading {
		color: var(--term-fg);
	}

	.added {
		color: var(--term-ok);
		clip-path: inset(0 100% 0 0);
	}

	.typed .added {
		clip-path: inset(0);
		transition: clip-path 900ms steps(16);
	}

	.typed .age {
		color: var(--term-ok);
	}

	.old {
		color: var(--term-faint);
	}

	.stale {
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--term-wait) 55%, transparent),
			0 0 24px -6px color-mix(in srgb, var(--term-wait) 45%, transparent);
	}

	.stale .age {
		color: var(--term-wait);
	}

	@media (prefers-reduced-motion: reduce) {
		.typed .added {
			transition: none;
		}
	}
</style>
