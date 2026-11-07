<script lang="ts">
	import { Loop } from './loop.svelte';

	const RULE = '- No stacked PRs';

	const FILES = [
		{ name: 'CLAUDE.md', last: '- Tabs, not spaces', edited: 'Oct 2' },
		{ name: 'AGENTS.md', last: '- Tabs, not spaces', edited: 'Oct 2' },
		{ name: 'GEMINI.md', last: '- Tabs, not spaces', edited: 'Oct 2' },
	] as const;

	const STALE = { name: '.cursorrules', last: '- npm is fine', edited: 'Aug 14' };

	const loop = new Loop([900, 1100, 1100, 1100, 4400]);
	const pasted = $derived(Math.min(loop.step, FILES.length));
	const caught = $derived(loop.step === loop.last);
</script>

<div class="rules" {@attach loop.play}>
	<div class="clip">
		<span class="keys">
			<kbd>⌘</kbd>
			<kbd>V</kbd>
		</span>
		<span class="rule">{RULE}</span>
		<span class="count">{pasted} of {FILES.length + 1} files</span>
	</div>
	<ul class="tree">
		{#each FILES as file, index (file.name)}
			{@const done = index < pasted}
			<li class={['branch', { done }]}>
				<span class="file">
					<span class="name">{file.name}</span>
					<span class="last">
						{#if done}
							<span class="typed">{RULE}</span>
						{:else}
							{file.last}
						{/if}
					</span>
					<span class="edited">{done ? 'just now' : file.edited}</span>
				</span>
			</li>
		{/each}
		<li class={['branch', { stale: caught }]}>
			<span class="file">
				<span class="name">{STALE.name}</span>
				<span class="last">{STALE.last}</span>
				<span class="edited">{STALE.edited}</span>
			</span>
		</li>
	</ul>
</div>

<style>
	.rules {
		display: flex;
		flex: 1;
		flex-direction: column;
		justify-content: center;
		gap: 10px;
		padding: 20px;
		background: radial-gradient(120% 90% at 0% 0%, var(--term-card), var(--term) 60%);
	}

	.clip {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 20px;
		white-space: nowrap;
	}

	.keys {
		display: flex;
		gap: 3px;
	}

	kbd {
		display: grid;
		place-items: center;
		min-width: 20px;
		height: 20px;
		border-radius: 5px;
		background: var(--term-raised);
		box-shadow:
			inset 0 -1px 0 rgb(0 0 0 / 0.45),
			0 0 0 1px var(--term-edge);
		color: var(--term-fg);
		font: inherit;
		font-size: 10.5px;
	}

	.rule {
		min-width: 0;
		overflow: hidden;
		color: var(--term-ok);
		text-overflow: ellipsis;
	}

	.count {
		flex: none;
		margin-left: auto;
		color: var(--term-faint);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.tree {
		display: grid;
		gap: 8px;
		margin-left: 10px;
		list-style: none;
	}

	.branch {
		--wire: var(--term-edge);
		position: relative;
		padding-left: 18px;
	}

	.branch::before,
	.branch::after {
		position: absolute;
		left: 0;
		border: 0 solid var(--wire);
		content: '';
		transition: border-color 400ms var(--ease);
	}

	.branch::before {
		top: -8px;
		bottom: 0;
		border-left-width: 1px;
	}

	.branch:first-child::before {
		top: -10px;
	}

	.branch::after {
		top: 50%;
		width: 12px;
		border-top-width: 1px;
	}

	.branch:last-child::before {
		bottom: 50%;
		width: 12px;
		border-bottom-width: 1px;
		border-bottom-left-radius: 7px;
	}

	.branch:last-child::after {
		content: none;
	}

	.done {
		--wire: color-mix(in srgb, var(--term-ok) 65%, transparent);
	}

	.stale {
		--wire: color-mix(in srgb, var(--term-wait) 65%, transparent);
	}

	.stale::before {
		border-style: dashed;
	}

	.file {
		display: flex;
		align-items: center;
		gap: 14px;
		height: 38px;
		padding: 0 12px;
		border-radius: 8px;
		background: var(--term-card);
		box-shadow: 0 0 0 1px var(--term-line);
		white-space: nowrap;
		transition: box-shadow 400ms var(--ease);
	}

	.done .file {
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--term-ok) 30%, transparent);
	}

	.stale .file {
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--term-wait) 55%, transparent),
			0 0 24px -6px color-mix(in srgb, var(--term-wait) 45%, transparent);
	}

	.name {
		flex: none;
		width: 12ch;
		color: var(--term-fg);
	}

	.last {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--term-dim);
		text-overflow: ellipsis;
	}

	.typed {
		color: var(--term-ok);
		animation: type 700ms steps(16) both;
	}

	@keyframes type {
		from {
			clip-path: inset(0 100% 0 0);
		}
	}

	.edited {
		flex: none;
		color: var(--term-faint);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		transition: color 400ms var(--ease);
	}

	.done .edited {
		color: var(--term-ok);
	}

	.stale .last,
	.stale .edited {
		color: var(--term-wait);
	}

	@media (max-width: 559px) {
		.rules {
			padding: 16px;
		}

		.file {
			gap: 10px;
			padding: 0 10px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.typed {
			animation: none;
		}
	}
</style>
