<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import {
		isVideoPath,
		mediaKind,
		type TurnComparison,
		type TurnReport,
		type TurnReportImage,
		type TurnVariant,
	} from '$lib/chat/domain/turn-report';
	import { variantLabel, type VariantPick } from '$lib/chat/domain/variant-pick';
	import ImageCompare from './ImageCompare.svelte';
	import ReportMedia from './ReportMedia.svelte';
	import VideoCompare from './VideoCompare.svelte';
	import { galleryImageId, galleryImageLabel } from './workstream-images';

	type Shot = Readonly<
		{ key: string; label: string; thumb: string } & (
			| { kind: 'variant'; variant: TurnVariant }
			| { kind: 'comparison'; comparison: TurnComparison }
			| { kind: 'image'; image: TurnReportImage }
		)
	>;

	interface Props {
		report: TurnReport;
		pick: VariantPick | null;
		chosenId: string;
		workstreamId: string;
		imagesrc?: ((path: string) => string | null) | undefined;
		onopenimage?: ((id: string) => void) | undefined;
	}

	let {
		report,
		pick,
		chosenId = $bindable(),
		workstreamId,
		imagesrc,
		onopenimage,
	}: Props = $props();

	const stageId = $props.id();
	const variantShots = $derived<Shot[]>(
		report.variants.map((variant) => ({
			kind: 'variant',
			key: `variant:${variant.id}`,
			label: `Variant ${variantLabel(variant)}`,
			thumb: variant.src,
			variant,
		})),
	);
	const evidenceShots = $derived<Shot[]>([
		...(report.comparison
			? [
					{
						kind: 'comparison' as const,
						key: 'comparison',
						label: 'Before and after',
						thumb: report.comparison.after.src,
						comparison: report.comparison,
					},
				]
			: []),
		...report.images.map((image) => ({
			kind: 'image' as const,
			key: `image:${image.src}`,
			label: imageName(image),
			thumb: image.src,
			image,
		})),
	]);
	const shots = $derived([...variantShots, ...evidenceShots]);
	const grouped = $derived(variantShots.length > 0 && evidenceShots.length > 0);
	let selectedKey = $state<string | null>(null);
	const shown = $derived(
		shots.find((shot) => shot.key === selectedKey) ??
			variantShots.find((shot) => shot.kind === 'variant' && shot.variant.id === chosenId) ??
			shots[0] ??
			null,
	);

	function imageName(image: TurnReportImage): string {
		return image.alt || image.src.split('/').filter(Boolean).pop() || image.src;
	}

	function panelId(shot: Shot): string {
		return `${stageId}-panel-${shots.indexOf(shot)}`;
	}

	function tabId(shot: Shot): string {
		return `${stageId}-tab-${shots.indexOf(shot)}`;
	}

	function show(shot: Shot): void {
		selectedKey = shot.key;
		if (shot.kind === 'variant') chosenId = shot.variant.id;
	}

	function moveAlongTabs(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
		const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
		if (step === undefined || shown === null) return;
		const index = (shots.indexOf(shown) + step + shots.length) % shots.length;
		const next = shots[index];
		if (!next) return;
		event.preventDefault();
		show(next);
		event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
	}
</script>

{#snippet tab(shot: Shot)}
	{@const selected = shot === shown}
	{@const variant = shot.kind === 'variant' ? shot.variant : null}
	{@const isPicked = variant !== null && pick?.picked.id === variant.id}
	<Button
		bare
		id={tabId(shot)}
		role="tab"
		ariaSelected={selected}
		ariaControls={panelId(shot)}
		ariaLabel={variant?.note ? `${shot.label}, ${variant.note}` : shot.label}
		tabindex={selected ? 0 : -1}
		class={[
			'flex h-[26px] max-w-48 min-w-0 cursor-pointer items-center gap-1.5 rounded-md pr-2 pl-[3px] text-xs transition-[color]',
			selected
				? 'bg-surface-elevated text-fg-agent-message-strong outline-surface-elevated-border outline-[0.5px] -outline-offset-[0.5px]'
				: 'text-fg-secondary hover:bg-surface-50-hover',
			pick && variant && !isPicked && 'opacity-45',
		]}
		onclick={() => show(shot)}
	>
		<span
			class={[
				'thumb bg-surface-root relative block h-[19px] w-[30px] shrink-0 overflow-hidden rounded-[3px]',
				variant?.id === chosenId && 'ring-button-primary/60 ring-[1.5px]',
			]}
		>
			<ReportMedia src={shot.thumb} label={shot.label} {workstreamId} size="mini" {imagesrc} />
		</span>
		{#if variant}
			<span class="text-fg-default font-medium">{variant.id}</span>
			<span class="truncate">{variant.name}</span>
		{:else}
			<span class="truncate">{shot.label}</span>
		{/if}
		{#if isPicked}
			<span class="text-brand-foreground grid place-items-center">
				<Icon name="check" size={12} ariaLabel="Picked" />
			</span>
		{/if}
	</Button>
{/snippet}

{#snippet framed(src: string, label: string, playing: boolean)}
	{@const kind = mediaKind(src)}
	<div
		class="bg-surface-root outline-border-subtle relative h-full overflow-hidden rounded-md outline-[0.5px] -outline-offset-[0.5px]"
	>
		<span class="block aspect-[16/10] max-h-[20rem] w-full" aria-hidden="true"></span>
		<div class="absolute inset-0 grid place-items-center">
			<ReportMedia {src} {label} {workstreamId} size="hero" {playing} {imagesrc} />
		</div>
		{#if kind !== 'page'}
			<Button
				bare
				class="absolute inset-0 cursor-zoom-in"
				ariaLabel={galleryImageLabel(label, kind)}
				onclick={() => onopenimage?.(galleryImageId(src))}
			/>
		{/if}
	</div>
{/snippet}

{#if shown}
	<div class="flex flex-col gap-1.5" data-testid="report-stage">
		<div class="grid">
			{#each shots as shot (shot.key)}
				<div
					id={panelId(shot)}
					role={shots.length > 1 ? 'tabpanel' : undefined}
					aria-labelledby={shots.length > 1 ? tabId(shot) : undefined}
					class={['col-start-1 row-start-1 min-w-0', shot !== shown && 'invisible']}
				>
					{#if shot.kind === 'variant'}
						<div class="relative h-full">
							{@render framed(shot.variant.src, shot.label, shot === shown)}
							<span
								class="bg-surface-50/85 text-fg-secondary outline-border-subtle pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full px-1.5 text-[11px] leading-[18px] font-medium outline-[0.5px] backdrop-blur-sm"
							>
								{variantLabel(shot.variant)}{#if shot.variant.note}<span
										class="text-fg-tertiary font-normal"
									>
										{` · ${shot.variant.note}`}
									</span>{/if}
							</span>
						</div>
					{:else if shot.kind === 'comparison'}
						{#if isVideoPath(shot.comparison.after.src)}
							<VideoCompare comparison={shot.comparison} {imagesrc} />
						{:else}
							<ImageCompare {workstreamId} comparison={shot.comparison} {imagesrc} {onopenimage} />
						{/if}
					{:else}
						{@render framed(shot.image.src, shot.label, shot === shown)}
					{/if}
				</div>
			{/each}
		</div>
		{#if shots.length > 1}
			<div
				class="flex flex-wrap items-center gap-1"
				role="tablist"
				aria-label="Report media"
				tabindex="-1"
				onkeydown={moveAlongTabs}
			>
				{#each variantShots as shot (shot.key)}
					{@render tab(shot)}
				{/each}
				{#if grouped}
					<span class="bg-surface-150-border mx-1 h-4 w-px" aria-hidden="true"></span>
				{/if}
				{#each evidenceShots as shot (shot.key)}
					{@render tab(shot)}
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.thumb {
		outline: 0.5px solid var(--color-border-subtle);
		outline-offset: -0.5px;
	}
</style>
