<script module lang="ts">
	import type { WidgetDefinition, WidgetReading, WidgetSize } from '$contract/widgets';

	export type WidgetMenuTarget = Readonly<{
		widget: WidgetDefinition;
		size: WidgetSize;
		reading: WidgetReading | null;
		approved: boolean;
		anchor: HTMLElement;
		point: Readonly<{ x: number; y: number }> | null;
		openedAt: Date;
	}>;
</script>

<script lang="ts">
	import { WIDGET_SIZES } from '$contract/widgets';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { Icon } from '$hyper-ui/icons';
	import { WIDGET_SPANS } from '$lib/widgets/domain/widget-grid';
	import { WIDGET_SIZE_NAMES, sourceLine, updatedLabel } from '$lib/widgets/domain/widget-text';

	interface Props {
		target: WidgetMenuTarget | null;
		onclose: () => void;
		onresize: (widget: WidgetDefinition, size: WidgetSize) => void;
		onrefresh: (widget: WidgetDefinition) => void;
		onask: (widget: WidgetDefinition, path: string) => void;
		onopenfile: (widget: WidgetDefinition, path: string) => void;
		onremove: (widget: WidgetDefinition) => void;
	}

	let { target, onclose, onresize, onrefresh, onask, onopenfile, onremove }: Props = $props();

	let pointAnchor = $state<HTMLDivElement | null>(null);

	function bodyAnchor(node: HTMLDivElement): () => void {
		document.body.append(node);
		pointAnchor = node;
		return () => {
			node.remove();
			if (pointAnchor === node) pointAnchor = null;
		};
	}

	function shapeWidth(units: number): string {
		return `${units * 8 + (units - 1) * 2}px`;
	}
</script>

{#if target?.point}
	{#key target}
		<div
			{@attach bodyAnchor}
			class="pointer-events-none fixed size-0"
			style:left="{target.point.x}px"
			style:top="{target.point.y}px"
			data-dropdown-anchor
		></div>
	{/key}
{/if}

<DropdownLayer
	open={target !== null && (target.point === null || pointAnchor !== null)}
	anchor={target?.anchor ?? null}
	positionAnchor={target?.point ? pointAnchor : null}
	{onclose}
	align={target?.point ? 'start' : 'end'}
	offset={target?.point ? 2 : 6}
	restoreFocusToAnchor={target?.point === null}
	panelClass="w-62 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	testId="widget-menu"
>
	{#if target}
		{@const { widget, size } = target}
		{@const plan = widget.source.kind === 'plan'}
		{@const path = widget.path}
		<div class="flex gap-[3px] p-1" role="group" aria-label="Size">
			{#each WIDGET_SIZES as each (each)}
				{@const span = WIDGET_SPANS[each]}
				<DropdownItem
					role="menuitemradio"
					aria-checked={each === size}
					selected={each === size}
					focusOnHover={false}
					class="h-16 flex-1 flex-col justify-center px-1"
					onclick={() => onresize(widget, each)}
				>
					<span class="grid h-7 items-end justify-items-center" aria-hidden="true">
						<span
							class="block rounded-[2px] border-[1.5px] border-current"
							style:width={shapeWidth(span.columns)}
							style:height={shapeWidth(span.rows)}
						></span>
					</span>
					<span class="text-2xs leading-4">{WIDGET_SIZE_NAMES[each]}</span>
				</DropdownItem>
			{/each}
		</div>
		<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
		<p class="text-fg-tertiary text-2xs line-clamp-4 px-2.5 pt-1.5 font-mono leading-4 break-all">
			{sourceLine(widget)}
		</p>
		{#if !plan}
			<p class="text-fg-quaternary text-2xs px-2.5 pb-1 leading-4">
				{updatedLabel(target.reading?.readAt ?? null, target.openedAt)}
			</p>
		{/if}
		<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
		{#if !plan && target.approved}
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class="gap-2.5"
				onclick={() => onrefresh(widget)}
			>
				<Icon name="refresh" size={14} class="text-fg-tertiary shrink-0" />
				Refresh now
			</DropdownItem>
		{/if}
		{#if path !== null}
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class="gap-2.5"
				onclick={() => onask(widget, path)}
			>
				<Icon name="sparkles" size={14} class="text-fg-tertiary shrink-0" />
				Ask to change it
			</DropdownItem>
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class="gap-2.5"
				onclick={() => onopenfile(widget, path)}
			>
				<Icon name="files" size={14} class="text-fg-tertiary shrink-0" />
				Open file
			</DropdownItem>
		{/if}
		<DropdownItem
			role="menuitem"
			focusOnHover={false}
			class="gap-2.5"
			onclick={() => onremove(widget)}
		>
			<Icon name="close" size={14} class="text-fg-tertiary shrink-0" />
			Remove
		</DropdownItem>
	{/if}
</DropdownLayer>
