<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';

	interface Props {
		title: string;
		description: string;
		actions?: Snippet;
		children: Snippet;
	}

	let { title, description, actions, children }: Props = $props();
	const headingId = $props.id();
</script>

<section class="flex min-h-0 flex-1 flex-col pt-4" aria-labelledby={headingId}>
	<header class="mr-12.5 mb-3 ml-4.5 flex shrink-0 items-end justify-between gap-6">
		<div class="min-w-0">
			<h2 id={headingId} class="text-fg-default text-xl font-semibold tracking-tight">{title}</h2>
			<p class="text-fg-tertiary mt-0.5 text-xs">{description}</p>
		</div>
		{@render actions?.()}
	</header>
	<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Settings section">
		<div class="@container flex flex-col gap-1.5 px-1.5 pb-1.5">
			{@render children()}
		</div>
	</ScrollableDiv>
</section>
