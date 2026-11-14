<script lang="ts" module>
	export type DocDemo = Readonly<{
		workstream: string;
		height: number;
		title: string;
		lead: string;
		tries: readonly string[];
		more: string;
		words: number;
	}>;
</script>

<script lang="ts">
	import { Icon } from '@malini/hyper-ui/icons';
	import { StageLight } from './stage/stage.api';
	import { demoHref } from './urls';

	let { demo }: { demo: DocDemo } = $props();

	const NARROWEST_APP = 600;

	let width = $state(0);
	let ready = $state(false);
	let lit = $state(false);
	let panel = $state<HTMLElement>();

	const appWidth = $derived(Math.max(width, NARROWEST_APP));
	const scale = $derived(width > 0 ? width / appWidth : 1);
</script>

<p class="lead">{@html demo.lead}</p>

<figure class="demo">
	<div class="stage">
		<StageLight preset="bottom-left" caster={panel} bind:lit />
		<div
			class={['panel', { lit, ready }]}
			bind:this={panel}
			bind:clientWidth={width}
			style:height="{Math.round(demo.height * scale)}px"
		>
			<div class="lights" aria-hidden="true" data-for="darwin">
				<i></i>
				<i></i>
				<i></i>
			</div>
			<iframe
				src={demoHref('app', `/workstreams/${demo.workstream}`, 'docs')}
				title="Malini on demo data: {demo.title}"
				width={appWidth}
				height={demo.height}
				loading="lazy"
				style:scale={String(scale)}
				onload={() => (ready = true)}
			></iframe>
		</div>
	</div>
	{#if demo.tries.length > 0}
		<figcaption class="tries">
			<span class="label">Try</span>
			{#each demo.tries as line (line)}
				<span class="try">{@html line}</span>
			{/each}
		</figcaption>
	{/if}
</figure>

<details class="more">
	<summary>
		<Icon name="chevron-right" size={14} />
		The long version
		<span class="words">{demo.words} words</span>
	</summary>
	<div class="text">{@html demo.more}</div>
</details>

<style>
	.lead {
		margin-top: 8px;
		color: var(--fg-secondary);
		font-size: 18px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.lead :global(kbd),
	.try :global(kbd) {
		display: inline-grid;
		place-items: center;
		min-width: 1.6em;
		height: 1.5em;
		padding: 0 0.35em;
		border-radius: 5px;
		background: var(--surface-root);
		box-shadow:
			inset 0 0 0 1px var(--border-default),
			inset 0 -1px 0 var(--border-default);
		color: var(--fg-default);
		font: 500 0.8em/1 var(--sans);
		vertical-align: 0.08em;
	}

	.demo {
		margin: 24px -40px 0;
	}

	.stage {
		position: relative;
		isolation: isolate;
		padding: 24px;
		overflow: hidden;
		border-radius: 18px;
		box-shadow: inset 0 0 0 1px var(--border-subtle);
	}

	.panel {
		position: relative;
		overflow: hidden;
		border-radius: 12px;
		background: var(--app-root);
		box-shadow:
			var(--app-shadow),
			0 0 0 1px var(--app-line);
	}

	.panel.lit {
		box-shadow: 0 0 0 1px var(--app-line);
	}

	.lights {
		position: absolute;
		top: 13px;
		left: 12px;
		display: flex;
		gap: 8px;
	}

	.lights i {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--app-line-strong);
	}

	iframe {
		position: relative;
		display: block;
		border: 0;
		opacity: 0;
		transform-origin: 0 0;
		transition: opacity 500ms var(--enter-ease);
	}

	.ready iframe {
		opacity: 1;
	}

	.tries {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 14px;
		padding: 0 40px;
	}

	.label {
		margin-right: 2px;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.try {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		color: var(--fg-secondary);
		font-size: 13.5px;
		line-height: 1;
	}

	.try :global(strong) {
		color: var(--fg-default);
		font-weight: 550;
	}

	.more {
		margin-top: 20px;
	}

	summary {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--fg-muted);
		font-size: 15px;
		font-weight: 500;
		cursor: pointer;
		list-style: none;
		user-select: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary :global(svg) {
		transition: rotate 200ms var(--ease);
	}

	.more[open] summary :global(svg) {
		rotate: 90deg;
	}

	.words {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 400;
	}

	.text {
		padding-left: 22px;
	}

	@media (hover: hover) and (pointer: fine) {
		summary:hover {
			color: var(--fg-default);
		}
	}

	@media (max-width: 1023px) {
		.demo {
			margin-inline: calc(-1 * var(--pad));
		}

		.stage {
			padding: 20px var(--pad);
			border-radius: 0;
			box-shadow:
				inset 0 1px 0 var(--border-subtle),
				inset 0 -1px 0 var(--border-subtle);
		}

		.tries {
			padding: 0 var(--pad);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		iframe,
		summary :global(svg) {
			transition: none;
		}
	}
</style>
