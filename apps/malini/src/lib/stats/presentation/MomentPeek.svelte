<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { sensitiveMasking } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { dismissMomentCommand } from '$lib/stats/application/commands/dismiss-moment.command';
	import { watchMomentHook } from '$lib/stats/application/hooks/watch-moment.hook';
	import { momentQuery } from '$lib/stats/application/queries/moment.query.svelte';
	import MomentSheet from './MomentSheet.svelte';
	import { momentLabel } from './moment-copy';
	import { shareCardPng } from './share-cards';

	const shown = $derived(sensitiveMasking.on ? null : momentQuery.data);
	const label = $derived(shown ? momentLabel(shown.moment) : '');
	const png = $derived(
		shown?.card.stats ? shareCardPng('heatmap', shown.card, shown.card.stats) : null,
	);
	let sharing = $state(false);

	onMount(() => watchMomentHook());
</script>

{#if shown}
	<section
		class="moment-peek shrink-0 px-3.5 pt-2"
		aria-label="Milestone"
		data-testid="moment-peek"
	>
		<div class="flex items-center justify-between gap-2">
			<span
				class="bg-brand/10 text-brand-foreground inline-flex min-w-0 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-2 text-xs font-medium"
			>
				<span class="bg-brand-icon size-1.5 shrink-0 rounded-full"></span>
				<span class="truncate">{label}</span>
			</span>
			<IconButton
				variant="ghost"
				size="xs"
				ariaLabel="Dismiss milestone"
				onclick={() => dismissMomentCommand(shown.moment.id)}
			>
				<Icon name="close" size={12} />
			</IconButton>
		</div>
		<div class="moment-peek__stage">
			<Button
				bare
				class="moment-peek__card block w-full cursor-pointer"
				ariaLabel={`Share your card: ${label}`}
				onclick={() => (sharing = true)}
			>
				{#await png then source}
					{#if source}
						<img
							src={source}
							alt=""
							draggable="false"
							class="block aspect-[40/21] w-full rounded-lg shadow-xl"
						/>
					{/if}
				{/await}
			</Button>
		</div>
	</section>
	{#if sharing}
		<MomentSheet {shown} onclose={() => (sharing = false)} />
	{/if}
{/if}

<style>
	.moment-peek__stage {
		aspect-ratio: 40 / 14;
		margin-top: 0.625rem;
		clip-path: inset(-100vh -100vw 0 -100vw);
	}

	.moment-peek :global(.moment-peek__card) {
		transform: translateY(0.5rem) rotate(-3deg);
		transform-origin: bottom left;
		transition: transform 260ms cubic-bezier(0.23, 1, 0.32, 1);
		animation: moment-peek-rise 520ms cubic-bezier(0.23, 1, 0.32, 1) 400ms backwards;
	}

	.moment-peek :global(.moment-peek__card:hover),
	.moment-peek :global(.moment-peek__card:focus-visible) {
		transform: translateY(-0.25rem) rotate(0deg);
	}

	@keyframes moment-peek-rise {
		from {
			transform: translateY(100%) rotate(-6deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.moment-peek :global(.moment-peek__card) {
			transition: none;
			animation: none;
		}
	}
</style>
