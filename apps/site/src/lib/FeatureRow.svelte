<script lang="ts">
	import { Icon } from '@malini/hyper-ui/icons';
	import type { Snippet } from 'svelte';
	import Section from './Section.svelte';
	import { StageLight } from './stage/stage.api';

	type Props = {
		id: string;
		title: string;
		body: string;
		href: string;
		linkLabel: string;
		checks: string[];
		mirrored?: boolean;
		header?: Snippet;
		panel: Snippet;
	};

	let {
		id,
		title,
		body,
		href,
		linkLabel,
		checks,
		mirrored = false,
		header,
		panel,
	}: Props = $props();

	let panelElement = $state<HTMLElement>();
	let lit = $state(false);
</script>

<Section label={id}>
	<div class="row" class:mirrored>
		<div class="copy">
			<h3 {id}>{title}</h3>
			<p>{body}</p>
			<a class="arrow-link" {href}>
				{linkLabel}
				<Icon name="arrow-right" size={14} />
			</a>
			<ul>
				{#each checks as check (check)}
					<li>
						<Icon name="check" size={14} />
						<span>{check}</span>
					</li>
				{/each}
			</ul>
		</div>
		<div class="stage">
			<StageLight
				preset={mirrored ? 'bottom-right' : 'bottom-left'}
				caster={panelElement}
				bind:lit
			/>
			<div class={['panel', { lit }]} bind:this={panelElement}>
				{#if header}
					<div class="panel-header">{@render header()}</div>
				{/if}
				<div class="panel-body">{@render panel()}</div>
			</div>
		</div>
	</div>
</Section>

<style>
	.row {
		display: grid;
		grid-template-columns: 5fr 7fr;
	}

	.row.mirrored {
		grid-template-columns: 7fr 5fr;
	}

	.copy {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 56px var(--pad);
		border-right: 1px solid var(--line);
	}

	.mirrored .copy {
		order: 2;
		border-right: 0;
		border-left: 1px solid var(--line);
	}

	h3 {
		font-size: 24px;
		font-weight: 550;
		line-height: 1.25;
		letter-spacing: -0.02em;
	}

	p {
		max-width: 440px;
		margin: 12px 0 20px;
		color: var(--fg-muted);
		font-size: 16px;
		line-height: 1.65;
		text-wrap: pretty;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 440px;
		margin-top: 32px;
		padding-top: 24px;
		border-top: 1px solid var(--line);
		list-style: none;
	}

	li {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		color: var(--fg-secondary);
		font-size: 14px;
	}

	li :global(svg) {
		flex: none;
		margin-top: 3px;
		color: var(--fg-muted);
	}

	.stage {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 56px 48px;
	}

	.panel {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 620px;
		height: 480px;
		overflow: hidden;
		border-radius: 14px;
		background: var(--app-panel);
		box-shadow:
			var(--app-shadow),
			0 0 0 1px var(--app-line);
		color: var(--app-fg);
	}

	.panel.lit {
		box-shadow: 0 0 0 1px var(--app-line);
	}

	.panel-header {
		display: flex;
		flex: none;
		align-items: center;
		gap: 10px;
		height: 44px;
		padding: 0 16px;
		border-bottom: 1px solid var(--app-line);
		font-size: 13px;
	}

	.panel-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}

	@media (max-width: 1023px) {
		.row,
		.row.mirrored {
			grid-template-columns: minmax(0, 1fr);
		}

		.copy,
		.mirrored .copy {
			order: 0;
			padding: 48px var(--pad);
			border: 0;
		}

		.stage {
			padding: 40px var(--pad);
			border-top: 1px solid var(--line);
		}
	}

	@media (max-width: 560px) {
		.stage {
			padding: 32px 12px;
		}

		.panel {
			height: 500px;
		}
	}
</style>
