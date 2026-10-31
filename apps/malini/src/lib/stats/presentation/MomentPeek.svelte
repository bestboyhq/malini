<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Icon } from '$hyper-ui/icons';
	import { publishedProfileUrl } from '$lib/stats/domain/published-profile';
	import { dismissMomentCommand } from '$lib/stats/application/commands/dismiss-moment.command';
	import { loadProfileCommand } from '$lib/stats/application/commands/load-profile.command';
	import { watchMomentHook } from '$lib/stats/application/hooks/watch-moment.hook';
	import { watchProfileHook } from '$lib/stats/application/hooks/watch-profile.hook';
	import { momentQuery } from '$lib/stats/application/queries/moment.query.svelte';
	import { profileStateQuery } from '$lib/stats/application/queries/profile-state.query.svelte';
	import MomentSheet from './MomentSheet.svelte';
	import { momentBadge, momentLabel } from './moment-copy';
	import { shareCardPng } from './share-cards';

	const shown = $derived(momentQuery.data);
	const profileState = $derived(profileStateQuery.data);
	const claimed = $derived(publishedProfileUrl(profileState) !== null);
	const label = $derived(shown ? momentLabel(shown.moment) : '');
	const badge = $derived(shown ? momentBadge(shown.moment) : null);
	const png = $derived(
		shown?.card.stats && !claimed ? shareCardPng('heatmap', shown.card, shown.card.stats) : null,
	);
	let sharing = $state(false);

	onMount(() => {
		loadProfileCommand();
		const stopProfile = watchProfileHook();
		const stopMoment = watchMomentHook();
		return () => {
			stopProfile();
			stopMoment();
		};
	});
</script>

{#if shown && profileState}
	<section
		class={[
			'moment-peek border-surface-50-border shrink-0 border-t px-3.5 pt-2',
			claimed && 'pb-2',
		]}
		aria-label="Milestone"
		data-testid="moment-peek"
	>
		<div class="flex items-center justify-between gap-2">
			{#if badge}
				<p class="flex min-w-0 items-center gap-1.5 text-xs">
					<Icon
						name={badge.icon}
						size={14}
						class={['shrink-0', badge.tone, badge.icon === 'flame' && 'moment-peek__flame']}
					/>
					<span class={['flex min-w-0 gap-x-1.5', claimed && 'flex-wrap']}>
						<span class="text-fg-default shrink-0 font-medium">{badge.cheer}</span>
						<span class={['text-fg-tertiary', claimed ? 'shrink-0' : 'truncate']}>
							{badge.fact}
						</span>
					</span>
				</p>
			{/if}
			<div class="flex shrink-0 items-center gap-1">
				{#if claimed}
					<Button
						variant="secondary"
						size="xs"
						ariaLabel={`Share your card: ${label}`}
						onclick={() => (sharing = true)}
					>
						Share
					</Button>
				{/if}
				<IconButton
					variant="ghost"
					size="xs"
					ariaLabel="Dismiss milestone"
					onclick={() => dismissMomentCommand(shown.moment.id)}
				>
					<Icon name="close" size={12} />
				</IconButton>
			</div>
		</div>
		{#if !claimed}
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
		{/if}
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

	.moment-peek :global(.moment-peek__flame) {
		transform-origin: 50% 85%;
		animation: moment-peek-flicker 1.6s ease-in-out infinite;
	}

	@keyframes moment-peek-flicker {
		30% {
			transform: scale(0.96, 1.05);
		}
		60% {
			transform: scale(1.03, 0.97);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.moment-peek :global(.moment-peek__flame) {
			animation: none;
		}

		.moment-peek :global(.moment-peek__card) {
			transition: none;
			animation: none;
		}
	}
</style>
