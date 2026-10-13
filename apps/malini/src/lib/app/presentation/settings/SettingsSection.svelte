<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description: string;
		actions?: Snippet;
		children: Snippet;
	}

	let { title, description, actions, children }: Props = $props();
	const headingId = $props.id();
</script>

<section class="@container px-1.5 pt-1 pb-1.5" aria-labelledby={headingId}>
	<header class="mx-3 mb-3 flex items-end justify-between gap-6">
		<div class="min-w-0">
			<h2 id={headingId} class="text-fg-default text-xl font-semibold tracking-tight">{title}</h2>
			<p class="text-fg-tertiary mt-0.5 text-xs">{description}</p>
		</div>
		{@render actions?.()}
	</header>
	{@render children()}
</section>
