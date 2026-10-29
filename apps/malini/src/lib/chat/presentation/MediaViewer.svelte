<script lang="ts" module>
	export type ViewerItem = Readonly<{ workstreamId: string; src: string; label: string }>;

	export type ViewerPick = Readonly<{
		picked: number | null;
		recommended: number | null;
		onpick: (index: number, reason: string) => void;
	}>;
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { FullPageModal } from '$hyper-ui/components/full-page-modal';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { announceExclusiveOverlayOpen } from '$hyper-ui/overlay';
	import { mediaKind } from '$lib/chat/domain/turn-report';
	import WorkstreamMedia from './WorkstreamMedia.svelte';

	interface Props {
		items: readonly ViewerItem[];
		start: number;
		title: string;
		pick?: ViewerPick | undefined;
		onclose: () => void;
	}

	let { items, start, title, pick, onclose }: Props = $props();

	const ZOOMS = [1, 1.5, 2, 3, 4] as const;

	let index = $state(untrack(() => Math.max(0, Math.min(start, items.length - 1))));
	let zoomStep = $state(0);
	let reason = $state('');
	let modal: FullPageModal | undefined = $state();

	const item = $derived(items[index] ?? null);
	const zoomable = $derived(item !== null && mediaKind(item.src) === 'image');
	const scale = $derived(ZOOMS[zoomStep] ?? 1);
	const browsable = $derived(items.length > 1);
	const action = $derived(pickLabel(index));

	onMount(() => {
		announceExclusiveOverlayOpen();
	});

	function pickLabel(at: number): string {
		const label = items[at]?.label ?? '';
		if (!pick) return '';
		if (pick.picked === null) return `Go with ${label}`;
		return pick.picked === at ? `Keep ${label}` : `Switch to ${label}`;
	}

	function show(next: number): void {
		index = (next + items.length) % items.length;
		zoomStep = 0;
	}

	function zoomBy(step: number): void {
		if (!zoomable) return;
		zoomStep = Math.max(0, Math.min(ZOOMS.length - 1, zoomStep + step));
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		if (!pick) return;
		if (pick.picked !== index) pick.onpick(index, reason);
		modal?.close();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.target instanceof HTMLInputElement) return;
		if (event.key === 'ArrowRight' && browsable) show(index + 1);
		else if (event.key === 'ArrowLeft' && browsable) show(index - 1);
		else if ((event.key === '+' || event.key === '=') && zoomable) zoomBy(1);
		else if (event.key === '-' && zoomable) zoomBy(-1);
		else return;
		event.preventDefault();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet arrow(label: string, glyph: 'chevron-left' | 'chevron-right', towards: number)}
	<Tooltip content={label} placement={towards < 0 ? 'right' : 'left'}>
		<IconButton
			variant="secondary"
			radius="full"
			ariaLabel={label}
			class="pointer-events-auto size-10"
			onclick={() => show(index + towards)}
		>
			<Icon name={glyph} size={18} />
		</IconButton>
	</Tooltip>
{/snippet}

<FullPageModal bind:this={modal} open {onclose} ariaLabel={`${title}, full size`}>
	<div class="flex h-full w-full flex-col gap-3" data-testid="media-viewer">
		<div class="pointer-events-auto flex h-9 shrink-0 items-center gap-3 text-sm">
			<span class="text-fg-default font-medium">{title}</span>
			{#if browsable}
				<span class="text-fg-tertiary tabular-nums" role="status">
					{index + 1} of {items.length}
				</span>
			{/if}
			<span class="text-fg-secondary min-w-0 truncate">{item?.label ?? ''}</span>
			{#if pick?.recommended === index}
				<span
					class="bg-surface-elevated border-surface-elevated-border text-fg-secondary text-2xs shrink-0 rounded-md border-[0.5px] px-1.5 leading-5"
				>
					Recommended
				</span>
			{/if}
			<span class="flex-1"></span>
			{#if zoomable}
				<div
					class="border-surface-elevated-border bg-surface-elevated flex items-center rounded-full border-[0.5px] p-0.5"
					role="group"
					aria-label="Zoom"
				>
					<IconButton
						variant="ghost"
						size="xs"
						radius="full"
						ariaLabel="Zoom out"
						disabled={zoomStep === 0}
						onclick={() => zoomBy(-1)}
					>
						<Icon name="minus" size={12} />
					</IconButton>
					<span class="text-fg-secondary min-w-11 text-center text-xs tabular-nums">
						{scale > 1 ? `${scale * 100}%` : 'Fit'}
					</span>
					<IconButton
						variant="ghost"
						size="xs"
						radius="full"
						ariaLabel="Zoom in"
						disabled={zoomStep === ZOOMS.length - 1}
						onclick={() => zoomBy(1)}
					>
						<Icon name="plus" size={12} />
					</IconButton>
				</div>
			{/if}
			<IconButton variant="ghost" ariaLabel="Close" onclick={() => modal?.close()}>
				<Icon name="close" size={16} />
			</IconButton>
		</div>

		<div class="relative flex min-h-0 flex-1 items-center gap-4">
			{#if browsable}{@render arrow('Previous', 'chevron-left', -1)}{/if}
			<div
				class="pointer-events-auto relative h-full min-w-0 flex-1 overflow-auto rounded-lg"
				data-testid="media-viewer-stage"
			>
				{#key `${index}`}
					{#if item}
						<div class="relative" style:width="{scale * 100}%" style:height="{scale * 100}%">
							<WorkstreamMedia
								workstreamId={item.workstreamId}
								src={item.src}
								label={item.label}
								size="hero"
							/>
						</div>
					{/if}
				{/key}
			</div>
			{#if browsable}{@render arrow('Next', 'chevron-right', 1)}{/if}
		</div>

		<div class="pointer-events-auto flex shrink-0 items-end gap-4">
			{#if browsable}
				<div class="flex min-w-0 gap-2 overflow-x-auto p-0.5" role="group" aria-label="All options">
					{#each items as option, at (`${option.workstreamId}:${option.src}`)}
						<Button
							bare
							ariaLabel={`Show ${option.label}`}
							ariaCurrent={at === index ? 'true' : 'false'}
							class="group/option flex w-28 shrink-0 flex-col gap-1.5 text-left"
							onclick={() => show(at)}
						>
							<span
								class={[
									'bg-surface-root outline-border-subtle relative block h-16 w-28 overflow-hidden rounded-md outline-[0.5px] -outline-offset-[0.5px]',
									at === index ? 'ring-2 ring-white' : 'opacity-60 group-hover/option:opacity-100',
								]}
							>
								<WorkstreamMedia
									workstreamId={option.workstreamId}
									src={option.src}
									label={option.label}
									size="mini"
									playing={false}
								/>
								{#if pick?.picked === at}
									<span
										class="bg-surface-elevated/90 text-fg-default absolute bottom-1 left-1 rounded px-1 text-[10px] leading-4"
									>
										Picked
									</span>
								{/if}
							</span>
							<span
								class={['truncate text-xs', at === index ? 'text-fg-default' : 'text-fg-tertiary']}
							>
								{option.label}
							</span>
						</Button>
					{/each}
				</div>
			{/if}
			{#if pick}
				<form class="ml-auto flex shrink-0 items-center gap-2" onsubmit={submit}>
					<TextInput
						bind:value={reason}
						size="sm"
						class="w-72"
						placeholder="Why? Optional, the lead passes it on"
						ariaLabel="Why this option"
					/>
					<Button type="submit" variant="primary" size="sm">{action}</Button>
				</form>
			{/if}
		</div>
	</div>
</FullPageModal>
