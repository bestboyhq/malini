<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { mediaKind } from '$lib/chat/domain/turn-report';
	import { variantLabel, type VariantPick } from '$lib/chat/domain/variant-pick';
	import VariantMedia from './VariantMedia.svelte';
	import { galleryImageId, galleryImageLabel } from './workstream-images';

	interface Props {
		pick: VariantPick;
		workstreamId: string;
		imagesrc?: ((path: string) => string | null) | undefined;
		onopenimage?: ((id: string) => void) | undefined;
	}

	let { pick, workstreamId, imagesrc, onopenimage }: Props = $props();

	const others = $derived(pick.options.filter((option) => option.id !== pick.picked.id));
</script>

<li class="turn-step relative" data-testid="turn-pick-step">
	<details class="group/pick">
		<summary
			class="text-fg-tertiary hover:text-fg-secondary flex cursor-pointer list-none items-start gap-2 py-[5px] text-xs leading-5 transition-[color]"
		>
			<span class="text-brand-foreground grid h-5 shrink-0 place-items-center">
				<Icon name="arrow-right" size={14} ariaLabel="You picked" />
			</span>
			<span class="min-w-0 flex-1">
				You picked
				<span class="text-fg-secondary font-medium">{variantLabel(pick.picked)}</span>
				{#if others.length > 0}over {others
						.map((option) => option.id)
						.join(', ')}{/if}{#if pick.reason}<span class="italic">
						{` - “${pick.reason}”`}
					</span>{/if}
			</span>
			<span class="flex shrink-0 gap-1 pt-[3px] group-open/pick:invisible" aria-hidden="true">
				{#each pick.options as option (option.id)}
					<span
						class={[
							'mini bg-surface-root block h-4 w-7 overflow-hidden rounded-[3px]',
							option.id === pick.picked.id
								? 'ring-brand-foreground/70 ring-offset-surface-50 ring-1 ring-offset-1'
								: 'opacity-40',
						]}
					>
						<VariantMedia variant={option} {workstreamId} size="mini" {imagesrc} />
					</span>
				{/each}
			</span>
		</summary>
		<div class="grid grid-cols-3 gap-1.5 pt-1 pb-2 pl-[22px]">
			{#each pick.options as option (option.id)}
				{@const tile = [
					'bg-surface-root outline-border-subtle relative block h-16 overflow-hidden rounded-[4px] outline-[0.5px] -outline-offset-[0.5px]',
					option.id === pick.picked.id &&
						'ring-brand-foreground/70 ring-offset-surface-50 ring-[1.5px] ring-offset-2',
				]}
				{@const kind = mediaKind(option.src)}
				<figure class={['flex flex-col gap-1', option.id !== pick.picked.id && 'opacity-50']}>
					{#if kind === 'page'}
						<span class={tile}>
							<VariantMedia variant={option} {workstreamId} size="tile" {imagesrc} />
						</span>
					{:else}
						<Button
							bare
							class={[tile, 'cursor-zoom-in']}
							ariaLabel={galleryImageLabel(`Variant ${variantLabel(option)}`, kind)}
							onclick={() => onopenimage?.(galleryImageId(option.src))}
						>
							<VariantMedia variant={option} {workstreamId} size="tile" {imagesrc} />
						</Button>
					{/if}
					<figcaption class="text-2xs text-fg-tertiary">
						<span class="text-fg-secondary font-medium">{option.id}</span>
						{option.name}
					</figcaption>
				</figure>
			{/each}
		</div>
	</details>
</li>

<style>
	.mini {
		outline: 0.5px solid var(--color-border-subtle);
		outline-offset: -0.5px;
	}

	.turn-step::after {
		position: absolute;
		top: 25px;
		bottom: -5px;
		left: 6.25px;
		width: 1.5px;
		border-radius: 9999px;
		background: var(--color-surface-150-border);
		content: '';
	}
</style>
