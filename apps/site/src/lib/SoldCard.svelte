<script lang="ts">
	let { word }: { word: string } = $props();

	const SALES = [
		{
			name: 'Cursor',
			source: 'CNBC',
			line: 'To SpaceX, June 2026',
			href: 'https://www.cnbc.com/2026/06/16/spacex-spcx-cursor-acquisition-ipo.html',
		},
		{
			name: 'Conductor',
			source: 'TechCrunch',
			line: 'To Meta, November 2026. Its cloud shuts down November 20',
			href: 'https://techcrunch.com/2026/11/04/meta-acquires-ai-coding-startup-conductor/',
		},
	] as const;

	const id = $props.id();
	let card = $state<HTMLElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	function hover(event: PointerEvent): void {
		if (event.pointerType !== 'mouse' || !card) return;
		clearTimeout(timer);
		if (!card.matches(':popover-open')) card.showPopover();
	}

	function leave(event: PointerEvent): void {
		if (event.pointerType !== 'mouse') return;
		clearTimeout(timer);
		timer = setTimeout(() => card?.matches(':popover-open') && card.hidePopover(), 250);
	}
</script>

<span class="word">
	<button
		class="sold"
		type="button"
		popovertarget={id}
		popovertargetaction="show"
		onpointerenter={hover}
		onpointerleave={leave}
	>
		{word}
	</button>
	<span
		{id}
		class="card"
		role="group"
		aria-labelledby="{id}-label"
		popover="auto"
		bind:this={card}
		onpointerenter={hover}
		onpointerleave={leave}
	>
		<span class="inner">
			<span class="label" id="{id}-label">Sold this year</span>
			{#each SALES as sale (sale.name)}
				<a class="item" href={sale.href} target="_blank" rel="noreferrer">
					<span class="title">
						{sale.name}
						<span class="source">{sale.source}</span>
					</span>
					<span class="line">{sale.line}</span>
				</a>
			{/each}
		</span>
	</span>
</span>

<style>
	.word {
		display: inline-flex;
	}

	.sold {
		all: unset;
		text-decoration: underline dotted;
		text-decoration-color: var(--border-strong);
		text-decoration-thickness: 1.5px;
		text-underline-offset: 3px;
		cursor: help;
		anchor-name: --sold;
	}

	.sold:focus-visible {
		border-radius: 4px;
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.card {
		width: 300px;
		max-width: calc(100vw - 32px);
		padding: 6px;
		border: 0;
		border-radius: 16px;
		background: var(--surface-root);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 1px 1px rgb(0 0 0 / 0.12),
			0 16px 40px -8px rgb(0 0 0 / 0.32);
		color: var(--fg-default);
		transition:
			opacity 180ms var(--ease),
			translate 180ms var(--ease),
			display 180ms allow-discrete,
			overlay 180ms allow-discrete;
	}

	@supports (position-area: bottom) {
		.card {
			position-anchor: --sold;
			position-area: bottom span-left;
			position-try-fallbacks:
				flip-inline,
				flip-block,
				flip-block flip-inline;
			inset: auto;
			margin: 8px 0 0;
		}
	}

	.card:not(:popover-open) {
		opacity: 0;
		translate: 0 -4px;
	}

	@starting-style {
		.card:popover-open {
			opacity: 0;
			translate: 0 -4px;
		}
	}

	.inner {
		display: block;
		padding: 6px;
		border-radius: 10px;
		background: var(--surface-elevated);
		box-shadow: 0 0 0 1px var(--ring-faint);
	}

	.label {
		display: block;
		padding: 6px 10px 4px;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px;
		border-radius: 8px;
		color: inherit;
		text-decoration: none;
	}

	.item:hover,
	.item:focus-visible {
		background: var(--surface-hover);
	}

	.title {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 14px;
		font-weight: 500;
		line-height: 20px;
	}

	.source {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 11px;
	}

	.line {
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 18px;
	}

	@media (prefers-reduced-motion: reduce) {
		.card,
		.card:not(:popover-open) {
			translate: none;
			transition: none;
		}
	}
</style>
