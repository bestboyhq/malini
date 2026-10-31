<script lang="ts">
	import { onMount } from 'svelte';
	import type { MomentCard } from '$contract/stats';
	import { Button } from '$hyper-ui/components/button';
	import { Modal } from '$hyper-ui/components/modal';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { goto } from '$shared/router/navigation';
	import { PROFILE_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import { publishedProfileUrl } from '$lib/stats/domain/published-profile';
	import { copyProfileLinkCommand } from '$lib/stats/application/commands/copy-profile-link.command';
	import { copyShareCardCommand } from '$lib/stats/application/commands/copy-share-card.command';
	import { dismissMomentCommand } from '$lib/stats/application/commands/dismiss-moment.command';
	import { loadProfileCommand } from '$lib/stats/application/commands/load-profile.command';
	import { turnOnPublishingCommand } from '$lib/stats/application/commands/turn-on-publishing.command';
	import { watchProfileHook } from '$lib/stats/application/hooks/watch-profile.hook';
	import { profileStateQuery } from '$lib/stats/application/queries/profile-state.query.svelte';
	import { momentTitle } from './moment-copy';
	import { shareCardPng, type ShareCardKind } from './share-cards';

	interface Props {
		shown: MomentCard;
		onclose: () => void;
	}

	let { shown, onclose }: Props = $props();

	const KINDS: readonly Readonly<{ kind: ShareCardKind; label: string }>[] = [
		{ kind: 'heatmap', label: 'Heatmap' },
		{ kind: 'readout', label: 'Readout' },
	];

	let kind: ShareCardKind = $state('heatmap');
	const profileState = $derived(profileStateQuery.data);
	const profileUrl = $derived(publishedProfileUrl(profileState));
	const handle = $derived(profileState?.suggestedHandle ?? null);
	const png = $derived(shown.card.stats ? shareCardPng(kind, shown.card, shown.card.stats) : null);

	onMount(() => {
		loadProfileCommand();
		return watchProfileHook();
	});

	function onCopyCard(): void {
		if (!png) return;
		copyShareCardCommand(png);
		dismissMomentCommand(shown.moment.id);
	}

	function onClaim(): void {
		onclose();
		turnOnPublishingCommand();
		void goto(PROFILE_SETTINGS_HREF);
	}
</script>

<Modal open size="lg" title={momentTitle(shown.moment)} {onclose}>
	<div class="flex flex-col gap-3" data-testid="moment-sheet">
		{#await png}
			<Skeleton class="aspect-[40/21] w-full" ariaLabel="Drawing your card" />
		{:then source}
			{#if source}
				<img src={source} alt="" class="block aspect-[40/21] w-full rounded-xl" />
			{/if}
		{/await}

		<div class="flex gap-1" role="group" aria-label="Card">
			{#each KINDS as option (option.kind)}
				<Button
					variant="ghost"
					size="sm"
					active={kind === option.kind}
					ariaPressed={kind === option.kind}
					onclick={() => (kind = option.kind)}
				>
					{option.label}
				</Button>
			{/each}
		</div>

		{#if profileUrl}
			<div class="flex justify-end gap-1.5">
				<Button variant="secondary" size="sm" onclick={() => copyProfileLinkCommand(profileUrl)}>
					Copy link
				</Button>
				<Button variant="primary" size="sm" onclick={onCopyCard}>Copy card</Button>
			</div>
		{:else}
			<div
				class="border-surface-elevated-border flex items-center gap-3 rounded-xl border-[0.5px] px-3.5 py-3"
			>
				<div class="min-w-0 flex-1">
					<p class="text-fg-default text-sm font-medium">
						Brag at <span class="font-mono">bestboy.dev/@{handle ?? 'you'}</span>
					</p>
					<p class="text-fg-tertiary text-xs">
						Numbers only, never your code. Your agents won't tell.
					</p>
				</div>
				<Button variant="primary" size="sm" class="shrink-0" onclick={onClaim}>
					{handle ? `Claim @${handle}` : 'Claim your profile'}
				</Button>
			</div>
		{/if}
	</div>
</Modal>
