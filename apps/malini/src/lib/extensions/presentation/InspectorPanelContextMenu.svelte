<script module lang="ts">
	export type InspectorPanelMenuTarget = Readonly<{
		panelId: string;
		label: string;
		open: boolean;
		x: number;
		y: number;
	}>;
</script>

<script lang="ts">
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		target: InspectorPanelMenuTarget | null;
		onclose: () => void;
		ontoggle: (target: InspectorPanelMenuTarget) => void;
	}

	let { target, onclose, ontoggle }: Props = $props();

	let anchor = $state<HTMLDivElement | null>(null);

	function bodyAnchor(node: HTMLDivElement): () => void {
		document.body.append(node);
		anchor = node;
		return () => {
			node.remove();
			if (anchor === node) anchor = null;
		};
	}

	function toggle(chosen: InspectorPanelMenuTarget): void {
		onclose();
		ontoggle(chosen);
	}
</script>

{#if target}
	{#key target}
		<div
			{@attach bodyAnchor}
			class="pointer-events-none fixed size-0"
			style:left="{target.x}px"
			style:top="{target.y}px"
			data-dropdown-anchor
		></div>
	{/key}
{/if}

<DropdownLayer
	open={target !== null && anchor !== null}
	{anchor}
	{onclose}
	offset={2}
	restoreFocusToAnchor={false}
	panelClass="w-max min-w-40 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	testId="inspector-panel-context-menu"
>
	{#if target}
		{@const chosen = target}
		<DropdownItem
			role="menuitem"
			focusOnHover={false}
			class="gap-2.5"
			onclick={() => toggle(chosen)}
		>
			<Icon name={chosen.open ? 'close' : 'plus'} size={14} class="text-fg-tertiary shrink-0" />
			{chosen.open ? `Close ${chosen.label}` : `Open ${chosen.label}`}
		</DropdownItem>
	{/if}
</DropdownLayer>
