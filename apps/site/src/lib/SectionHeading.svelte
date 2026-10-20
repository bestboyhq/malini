<script lang="ts">
	import type { Snippet } from 'svelte';
	import Section from './Section.svelte';

	type Props = {
		id: string;
		title: string;
		quiet?: string;
		description?: string;
		children?: Snippet;
	};

	let { id, title, quiet, description, children }: Props = $props();
</script>

<Section label={id}>
	<header class="heading">
		<h2 {id}>
			<span>{title}</span>
			{#if quiet}<span class="quiet">{quiet}</span>{/if}
		</h2>
		{#if description}
			<p>{description}</p>
		{/if}
		{@render children?.()}
	</header>
</Section>

<style>
	.heading {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 112px var(--pad);
		text-align: center;
	}

	h2 {
		max-width: 1040px;
		font-size: clamp(34px, 4.6vw, 52px);
		font-weight: 550;
		line-height: 1.06;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}

	h2 span {
		display: block;
	}

	.quiet {
		color: var(--fg-faint);
	}

	p {
		max-width: 620px;
		margin-top: 20px;
		color: var(--fg-muted);
		font-size: 18px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	@media (max-width: 1023px) {
		.heading {
			padding: 80px var(--pad);
		}
	}
</style>
