<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { compareImagesCommand } from '$lib/chat/application/commands/compare-images.command';
	import { imageComparisonQuery } from '$lib/chat/application/queries/image-comparison.query.svelte';
	import { workstreamImagePath, type TurnComparison } from '$lib/chat/domain/turn-report';
	import MediaToolbarButton from './MediaToolbarButton.svelte';
	import { galleryImageId, reportMediaSource } from './workstream-images';

	type Mode = 'wipe' | 'flip' | 'diff';

	interface Props {
		workstreamId: string;
		comparison: TurnComparison;
		imagesrc?: ((path: string) => string | null) | undefined;
		onopenimage?: ((id: string) => void) | undefined;
	}

	let { workstreamId, comparison, imagesrc, onopenimage }: Props = $props();

	const MODES: readonly Readonly<{ value: Mode; label: string; icon: IconName; tip: string }>[] = [
		{ value: 'wipe', label: 'Wipe', icon: 'contrast', tip: 'Wipe · drag across the picture' },
		{ value: 'flip', label: 'Flip', icon: 'swap', tip: 'Flip · click the picture to switch' },
		{ value: 'diff', label: 'Diff', icon: 'diff', tip: 'Diff · every changed pixel in pink' },
	];
	const HINTS: Readonly<Record<Mode, string>> = {
		wipe: 'Drag, or ← →',
		flip: 'Click to flip',
		diff: 'Changed pixels in pink',
	};
	const MAX_ZOOM = 4;
	const ZOOM_FILL = 0.8;

	const beforePath = $derived(workstreamImagePath(comparison.before.src));
	const afterPath = $derived(workstreamImagePath(comparison.after.src));
	const request = $derived(
		beforePath !== null && afterPath !== null
			? { workstreamId, before: beforePath, after: afterPath }
			: null,
	);
	const analysis = $derived(
		request ? imageComparisonQuery.data(request) : ({ status: 'unavailable' } as const),
	);
	const beforeSrc = $derived(reportMediaSource(comparison.before.src, imagesrc));
	const afterSrc = $derived(reportMediaSource(comparison.after.src, imagesrc));

	let mode = $state<Mode>('wipe');
	let position = $state(50);
	let flipped = $state(false);
	let selected = $state<number | null>(null);

	const areas = $derived(analysis.status === 'ready' ? analysis.areas : []);
	const focus = $derived(selected === null ? null : (areas[selected] ?? null));
	const scale = $derived(
		focus ? Math.min(MAX_ZOOM, Math.max(1, Math.min(ZOOM_FILL / focus.w, ZOOM_FILL / focus.h))) : 1,
	);
	const offset = $derived.by((): Readonly<{ x: string; y: string }> => {
		if (!focus) return { x: '0%', y: '0%' };
		const clamp = (value: number): number => Math.min(0, Math.max(1 - scale, value));
		return {
			x: `${clamp(0.5 - (focus.x + focus.w / 2) * scale) * 100}%`,
			y: `${clamp(0.5 - (focus.y + focus.h / 2) * scale) * 100}%`,
		};
	});
	const showsBefore = $derived(mode === 'flip' && flipped);
	const shownSrc = $derived(showsBefore ? beforeSrc : afterSrc);

	onMount(() => {
		if (request) compareImagesCommand(request);
	});

	function choose(next: Mode): void {
		mode = next;
		flipped = false;
	}

	function zoomOut(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || selected === null) return;
		selected = null;
	}
</script>

<svelte:window onkeydown={zoomOut} />

{#snippet statePill(state: 'Before' | 'After', side: 'left' | 'right')}
	<span
		class={[
			'outline-border-subtle pointer-events-none absolute bottom-2 rounded-full px-1.5 text-[11px] leading-[18px] font-medium shadow-sm outline-[0.5px]',
			side === 'left' ? 'left-2' : 'right-2',
			state === 'Before' ? 'bg-surface-invert text-fg-invert' : 'bg-brand text-brand-content',
		]}
	>
		{state}
	</span>
{/snippet}

{#snippet layer(src: string | null, dimmed: boolean)}
	<div
		class="zoom absolute inset-0"
		style:--zoom-x={offset.x}
		style:--zoom-y={offset.y}
		style:--zoom={scale}
	>
		{#if src}
			<img
				{src}
				alt=""
				draggable="false"
				class={['block size-full object-contain', dimmed && 'opacity-35 grayscale']}
			/>
		{/if}
		{#if dimmed && analysis.status === 'ready'}
			<img
				src={analysis.maskUrl}
				alt=""
				draggable="false"
				class="absolute inset-0 size-full object-contain"
			/>
		{/if}
	</div>
{/snippet}

<div class="flex flex-col gap-1.5" data-testid="report-image-compare">
	<div
		class="media bg-surface-root relative mx-auto w-fit max-w-full overflow-hidden rounded-md select-none"
		role="group"
		aria-label="Before and after"
	>
		{#if afterSrc}
			<img
				src={afterSrc}
				alt=""
				aria-hidden="true"
				draggable="false"
				class="invisible block max-h-[70vh] max-w-full"
			/>
		{:else}
			<div class="aspect-[16/10] max-h-[70vh] w-screen max-w-full"></div>
		{/if}

		{@render layer(mode === 'wipe' ? beforeSrc : shownSrc, mode === 'diff')}
		{#if mode === 'wipe'}
			<div class="absolute inset-0" style:clip-path="inset(0 0 0 {position}%)">
				{@render layer(afterSrc, false)}
			</div>
			<!-- eslint-disable-next-line @malini/desktop/no-raw-form-control -- the wipe is a range slider across the picture; hyper-ui has no slider primitive, and TextInput, Checkbox and Switch cannot drag a divider. -->
			<input
				type="range"
				class="wipe absolute inset-0 size-full cursor-ew-resize opacity-0"
				min="0"
				max="100"
				step="0.1"
				bind:value={position}
				aria-label="Wipe between before and after"
			/>
		{:else if mode === 'flip'}
			<Button
				bare
				class="absolute inset-0 size-full cursor-pointer"
				ariaLabel={flipped
					? 'Showing before, click to show after'
					: 'Showing after, click to show before'}
				ariaPressed={flipped}
				onclick={() => (flipped = !flipped)}
			></Button>
		{/if}

		<div
			class="zoom pointer-events-none absolute inset-0"
			style:--zoom-x={offset.x}
			style:--zoom-y={offset.y}
			style:--zoom={scale}
		>
			{#each areas as area, index (index)}
				<span
					class={['area absolute rounded-[3px]', selected === index && 'chosen']}
					style:left="{area.x * 100}%"
					style:top="{area.y * 100}%"
					style:width="{area.w * 100}%"
					style:height="{area.h * 100}%"
					style:--stroke="{1.5 / scale}px"
				></span>
			{/each}
			{#each areas as area, index (index)}
				<span
					class="pin pointer-events-auto absolute"
					style:--area-x="{area.x * 100}%"
					style:--area-y="{area.y * 100}%"
				>
					<Tooltip
						content={selected === index ? 'Zoom back out' : `Change ${index + 1} · zoom in`}
						placement="top"
					>
						<Button
							bare
							class="bg-brand text-brand-content outline-surface-elevated-border grid size-4 cursor-pointer place-items-center rounded-full text-[10px] leading-none font-semibold shadow-sm outline-[1.5px]"
							ariaLabel={`Change ${index + 1}`}
							ariaPressed={selected === index}
							onclick={() => (selected = selected === index ? null : index)}
						>
							{index + 1}
						</Button>
					</Tooltip>
				</span>
			{/each}
		</div>

		{#if mode === 'wipe'}
			<div class="handle pointer-events-none absolute inset-y-0" style:left="{position}%">
				<span
					class="bg-surface-elevated text-fg-secondary absolute top-1/2 left-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-sm"
				>
					<Icon name="chevron-left" size={10} />
					<Icon name="chevron-right" size={10} />
				</span>
			</div>
			{@render statePill('Before', 'left')}
			{@render statePill('After', 'right')}
		{:else if mode === 'flip'}
			{@render statePill(flipped ? 'Before' : 'After', 'left')}
		{:else}
			<span
				class="bg-surface-50/85 text-fg-secondary outline-border-subtle pointer-events-none absolute bottom-2 left-2 rounded-full px-1.5 text-[11px] leading-[18px] font-medium outline-[0.5px] backdrop-blur-sm"
			>
				{areas.length === 1 ? '1 changed area' : `${areas.length} changed areas`}
			</span>
		{/if}

		{#if selected !== null}
			<Button
				variant="secondary"
				size="2xs"
				class="absolute top-2 right-2"
				onclick={() => (selected = null)}
			>
				Show all
			</Button>
		{/if}
	</div>

	<div class="flex items-center justify-between gap-2">
		<div class="flex items-center gap-0.5" role="group" aria-label="Compare mode">
			{#each MODES as option (option.value)}
				{#if option.value !== 'diff' || analysis.status !== 'unavailable'}
					<MediaToolbarButton
						tooltip={option.tip}
						active={mode === option.value}
						pressed={mode === option.value}
						disabled={option.value === 'diff' && analysis.status !== 'ready'}
						onclick={() => choose(option.value)}
					>
						<Icon name={option.icon} size={14} />
						{option.label}
					</MediaToolbarButton>
				{/if}
			{/each}
		</div>
		<div class="flex items-center gap-2">
			<span class="text-2xs text-fg-tertiary">{HINTS[mode]}</span>
			<MediaToolbarButton
				tooltip="Open in gallery"
				label="Open in gallery"
				square
				onclick={() =>
					onopenimage?.(galleryImageId((showsBefore ? comparison.before : comparison.after).src))}
			>
				<Icon name="maximize" size={14} />
			</MediaToolbarButton>
		</div>
	</div>
</div>

<style>
	.media {
		outline: 0.5px solid var(--color-border-subtle);
		outline-offset: -0.5px;
	}

	.zoom {
		transform: translate(var(--zoom-x), var(--zoom-y)) scale(var(--zoom));
		transform-origin: 0 0;
		transition: transform 380ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.pin {
		top: max(calc(0.5rem / var(--zoom)), var(--area-y));
		left: max(calc(0.5rem / var(--zoom)), var(--area-x));
		transform: translate(-50%, -50%) scale(calc(1 / var(--zoom)));
	}

	.wipe {
		margin: 0;
		appearance: none;
	}

	.area {
		outline: var(--stroke) dashed var(--color-brand-foreground);
	}

	.area.chosen {
		outline-style: solid;
		background: color-mix(in oklab, var(--color-brand-foreground) 10%, transparent);
	}

	.handle {
		width: 1.5px;
		margin-left: -0.75px;
		background: var(--color-surface-elevated);
		box-shadow: 0 0 0 0.5px var(--color-border-default);
	}

	@media (prefers-reduced-motion: reduce) {
		.zoom {
			transition: none;
		}
	}
</style>
