<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { mediaKind, type TurnVariant } from '$lib/chat/domain/turn-report';
	import { variantLabel, type VariantPick } from '$lib/chat/domain/variant-pick';
	import VariantMedia from './VariantMedia.svelte';
	import { galleryImageId, galleryImageLabel } from './workstream-images';

	interface Props {
		variants: readonly TurnVariant[];
		pick: VariantPick | null;
		chosenId: string;
		workstreamId: string;
		imagesrc?: ((path: string) => string | null) | undefined;
		onopenimage?: ((id: string) => void) | undefined;
	}

	let {
		variants,
		pick,
		chosenId = $bindable(),
		workstreamId,
		imagesrc,
		onopenimage,
	}: Props = $props();

	const MAX_COLUMNS = 4;

	const chosen = $derived(variants.find((variant) => variant.id === chosenId) ?? variants[0]);
	const chosenKind = $derived(chosen ? mediaKind(chosen.src) : 'image');
</script>

{#if chosen}
	<div class="flex flex-col gap-1.5" data-testid="report-variants">
		<div
			class="bg-surface-root outline-border-subtle relative grid overflow-hidden rounded-md outline-[0.5px] -outline-offset-[0.5px]"
		>
			{#each variants as variant (variant.id)}
				<span class={['col-start-1 row-start-1 block', variant !== chosen && 'invisible']}>
					<VariantMedia
						{variant}
						{workstreamId}
						size="hero"
						playing={variant === chosen}
						{imagesrc}
					/>
				</span>
			{/each}
			{#if chosenKind !== 'page'}
				<Button
					bare
					class="absolute inset-0 cursor-zoom-in"
					ariaLabel={galleryImageLabel(`Variant ${variantLabel(chosen)}`, chosenKind)}
					onclick={() => onopenimage?.(galleryImageId(chosen.src))}
				/>
			{/if}
			<span
				class="bg-surface-50/85 text-fg-secondary outline-border-subtle pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full px-1.5 text-[11px] leading-[18px] font-medium outline-[0.5px] backdrop-blur-sm"
			>
				{variantLabel(chosen)}{#if chosen.note}<span class="text-fg-tertiary font-normal">
						{` · ${chosen.note}`}
					</span>{/if}
			</span>
		</div>
		<div
			class="grid gap-1.5"
			style:grid-template-columns="repeat({Math.min(variants.length, MAX_COLUMNS)}, minmax(0, 1fr))"
			role="radiogroup"
			aria-label="Variants"
		>
			{#each variants as variant (variant.id)}
				{@const isPicked = pick?.picked.id === variant.id}
				<Button
					bare
					role="radio"
					ariaChecked={variant === chosen}
					ariaLabel={`Variant ${variantLabel(variant)}${variant.note ? `, ${variant.note}` : ''}`}
					class={[
						'flex min-w-0 cursor-pointer flex-col gap-1 text-left',
						pick && !isPicked && 'opacity-45',
					]}
					onclick={() => (chosenId = variant.id)}
				>
					<span
						class={[
							'tile bg-surface-root ring-offset-surface-50 relative block h-20 w-full overflow-hidden rounded-[5px] ring-offset-2',
							variant === chosen && 'ring-button-primary/60 ring-[1.5px]',
						]}
					>
						<VariantMedia {variant} {workstreamId} size="tile" {imagesrc} />
						{#if isPicked}
							<span
								class="bg-brand text-brand-content absolute top-1 right-1 grid size-4 place-items-center rounded-full shadow-sm"
							>
								<Icon name="check" size={10} ariaLabel="Picked" />
							</span>
						{/if}
					</span>
					<span class="text-2xs flex min-w-0 items-baseline gap-1.5 leading-4">
						<span class="text-fg-default font-medium">{variant.id}</span>
						<span class="text-fg-secondary truncate">{variant.name}</span>
					</span>
				</Button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.tile {
		outline: 0.5px solid var(--color-border-subtle);
		outline-offset: -0.5px;
	}
</style>
