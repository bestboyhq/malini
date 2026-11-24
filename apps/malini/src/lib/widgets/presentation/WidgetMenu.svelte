<script module lang="ts">
	import type { WidgetDefinition, WidgetReading } from '$contract/widgets';

	export type WidgetMenuTarget = Readonly<{
		widget: WidgetDefinition;
		reading: WidgetReading | null;
		anchor: HTMLElement;
		point: Readonly<{ x: number; y: number }> | null;
		openedAt: Date;
	}>;
</script>

<script lang="ts">
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { Icon } from '$hyper-ui/icons';
	import { sourceLine, updatedLabel } from '$lib/widgets/domain/widget-text';
	import { commandKeyHeld } from '$shared/shell/command-key.svelte';

	interface Props {
		target: WidgetMenuTarget | null;
		onclose: () => void;
		onshare?: ((widget: WidgetDefinition, inNewChat: boolean) => void) | undefined;
		onremove: (widget: WidgetDefinition) => void;
	}

	let { target, onclose, onshare, onremove }: Props = $props();

	const ORIGIN_LINES = {
		plan: 'Built in',
		shared: 'Default for this repository',
		mine: 'Only on your board',
	} as const;

	let pointAnchor = $state<HTMLDivElement | null>(null);

	function bodyAnchor(node: HTMLDivElement): () => void {
		document.body.append(node);
		pointAnchor = node;
		return () => {
			node.remove();
			if (pointAnchor === node) pointAnchor = null;
		};
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
		{@const { widget } = target}
		<p class="text-fg-secondary text-2xs px-2.5 pt-1.5 leading-4">
			{ORIGIN_LINES[widget.origin]}{widget.author ? ` · @${widget.author}` : ''}
		</p>
		{#if widget.origin !== 'plan'}
			<p class="text-fg-tertiary text-2xs line-clamp-4 px-2.5 pt-1 font-mono leading-4 break-all">
				{sourceLine(widget)}
			</p>
			<p class="text-fg-quaternary text-2xs px-2.5 pb-1 leading-4">
				{updatedLabel(target.reading?.readAt ?? null, target.openedAt)}
			</p>
		{/if}
		<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
		{#if widget.origin === 'mine' && onshare}
			{@const inNewChat = commandKeyHeld()}
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class="gap-2.5"
				onclick={(event) => onshare(widget, event.metaKey)}
			>
				<Icon name={inNewChat ? 'branch' : 'users'} size={14} class="text-fg-tertiary shrink-0" />
				{inNewChat ? 'Make default in a new chat' : 'Make default for this repository'}
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
