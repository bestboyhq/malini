<script lang="ts">
	import { GitHubUserAvatar } from '$shared/repositories/repositories.api';
	import type { Snippet } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import type { WidgetDefinition, WidgetReading, WidgetSize } from '$contract/widgets';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { motionOff } from '$hyper-ui/motion/motion-off';
	import WidgetTile from './WidgetTile.svelte';

	interface Props {
		suggestions: readonly WidgetDefinition[];
		readingOf: (widgetId: string) => WidgetReading | null;
		me: string | null;
		lifted: string | null;
		plan?: Snippet<[WidgetSize]> | undefined;
		onadd: (widget: WidgetDefinition) => void;
		onhide: (widget: WidgetDefinition) => void;
		onpress: (event: PointerEvent, widget: WidgetDefinition, card: HTMLElement) => void;
	}

	let { suggestions, readingOf, me, lifted, plan, onadd, onhide, onpress }: Props = $props();

	const FLIP_PAUSE_MS = 380;

	let at = $state(0);
	let direction = $state(1);
	let card: HTMLDivElement | null = $state(null);
	let flippedAt = 0;

	const count = $derived(suggestions.length);
	const shown = $derived(count === 0 ? 0 : at % count);
	const top = $derived(suggestions[shown] ?? null);

	function flip(by: number): void {
		if (count < 2) return;
		flippedAt = Date.now();
		direction = by;
		at = (shown + by + count) % count;
	}

	function flipByKey(event: KeyboardEvent): void {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		flip(event.key === 'ArrowDown' ? 1 : -1);
	}

	function flipOnWheel(node: HTMLElement): () => void {
		const wheel = (event: WheelEvent): void => {
			if (count < 2) return;
			event.preventDefault();
			if (Date.now() - flippedAt > FLIP_PAUSE_MS && Math.abs(event.deltaY) > 4) {
				flip(Math.sign(event.deltaY));
			}
		};
		node.addEventListener('wheel', wheel, { passive: false });
		return () => node.removeEventListener('wheel', wheel);
	}

	function press(event: PointerEvent, widget: WidgetDefinition): void {
		if (card) onpress(event, widget, card);
	}
</script>

{#if top}
	{@const widget = top}
	{@const madeBy = widget.author}
	<div
		class="relative col-span-2"
		role="group"
		aria-label={count === 1 ? '1 suggested widget' : `${count} suggested widgets`}
		data-testid="widget-suggestions"
		{@attach flipOnWheel}
	>
		{#if count > 2}
			<span
				class="bg-surface-50 border-surface-50-border absolute inset-x-5 top-5 bottom-0 rounded-2xl border-[0.5px] opacity-60"
				aria-hidden="true"
			></span>
		{/if}
		{#if count > 1}
			<span
				class="bg-surface-50 border-surface-50-border absolute inset-x-2.5 top-2.5 bottom-[5px] rounded-2xl border-[0.5px]"
				aria-hidden="true"
			></span>
		{/if}
		{#key widget.id}
			<div
				bind:this={card}
				class={[
					'group absolute inset-x-0 top-0',
					count > 1 ? 'bottom-2.5' : 'bottom-0',
					lifted === widget.id && 'opacity-20',
				]}
				in:fly={{
					y: direction * 14,
					duration: motionOff() ? 0 : 260,
					easing: cubicOut,
				}}
				data-widget-suggestion={widget.id}
			>
				<WidgetTile {widget} reading={readingOf(widget.id)} size="medium" faded {plan}>
					{#snippet author()}
						{#if madeBy !== null}
							<span
								class="text-fg-quaternary flex items-center gap-1.5 pr-[34px] transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0"
							>
								<GitHubUserAvatar login={madeBy} label="Made by {madeBy}" size={16} />
								<span class="max-w-24 truncate text-xs">{madeBy === me ? 'You' : madeBy}</span>
							</span>
						{:else}
							<span class="w-[34px]" aria-hidden="true"></span>
						{/if}
					{/snippet}
				</WidgetTile>
				<Button
					bare
					class="focus-visible:ring-border-default/50 absolute inset-0 cursor-pointer rounded-2xl outline-0 focus-visible:ring-2"
					ariaLabel="Add {widget.title}"
					onclick={() => onadd(widget)}
					onkeydown={flipByKey}
					onpointerdown={(event) => press(event, widget)}
				/>
				<span
					class="bg-surface-100 group-hover:bg-surface-150 text-fg-default pointer-events-none absolute top-[7px] right-2 inline-flex h-6 items-center gap-1 rounded-lg pr-[9px] pl-1.5 text-xs font-medium"
					aria-hidden="true"
				>
					<Icon name="plus" size={11} />Add
				</span>
				<span
					class="absolute top-[7px] right-16 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
				>
					<Tooltip content="Not now" placement="top">
						<IconButton
							ariaLabel="Hide {widget.title}"
							variant="ghost"
							size="sm"
							class="size-6"
							onclick={() => onhide(widget)}
						>
							<Icon name="close" size={12} />
						</IconButton>
					</Tooltip>
				</span>
				{#if count > 1}
					<Button
						bare
						class="hover:bg-surface-100 absolute top-1/2 right-[3px] flex -translate-y-1/2 cursor-pointer flex-col gap-1 rounded-md px-[3px] py-1.5"
						ariaLabel="Next suggestion, {shown + 1} of {count}"
						onclick={() => flip(1)}
					>
						{#each suggestions as suggestion, index (suggestion.id)}
							<span
								class={[
									'block w-1 rounded-sm bg-current',
									index === shown ? 'text-fg-secondary h-2.5' : 'text-fg-quaternary h-1',
								]}
							></span>
						{/each}
					</Button>
				{/if}
			</div>
		{/key}
	</div>
{/if}
