<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';

	interface Props {
		title: string;
		description: string;
		testId?: string;
		eyebrow?: Snippet;
		actions?: Snippet;
		children: Snippet;
		wide?: boolean;
	}

	let { title, description, testId, eyebrow, actions, children, wide = false }: Props = $props();
	const headingId = $props.id();
</script>

<ScrollableDiv class="min-h-0 flex-1" ariaLabel={title} fadeEdges>
	<section
		class={[
			'@container mx-auto flex w-full flex-col gap-1.5 px-1.5 pt-1 pb-1.5',
			wide ? 'max-w-[1480px]' : 'max-w-[880px]',
		]}
		aria-labelledby={headingId}
		data-testid={testId}
	>
		<header class="mx-3 mb-1.5 flex items-end justify-between gap-6">
			<div class="min-w-0">
				{@render eyebrow?.()}
				<h1 id={headingId} class="text-fg-default text-xl font-semibold tracking-tight">{title}</h1>
				<p class="text-fg-tertiary mt-0.5 text-xs">{description}</p>
			</div>
			{@render actions?.()}
		</header>
		{@render children()}
	</section>
</ScrollableDiv>
