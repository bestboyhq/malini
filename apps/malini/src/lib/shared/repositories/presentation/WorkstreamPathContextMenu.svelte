<script lang="ts">
	import { WORKSTREAM_PATH_ATTRIBUTE } from '@malini/extension-api';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { Icon } from '$hyper-ui/icons';
	import { copyWorkstreamPathCommand } from '$shared/repositories/application/commands/copy-workstream-path.command';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	type Target = Readonly<{ path: string; x: number; y: number }>;

	let target = $state.raw<Target | null>(null);
	let anchor = $state<HTMLDivElement | null>(null);

	function onContextMenu(event: MouseEvent): void {
		if (event.defaultPrevented || !(event.target instanceof Element)) return;
		const element = event.target.closest(`[${WORKSTREAM_PATH_ATTRIBUTE}]`);
		const path = element?.getAttribute(WORKSTREAM_PATH_ATTRIBUTE);
		if (!element || !path) return;
		event.preventDefault();
		const box = element.getBoundingClientRect();
		const fromKeyboard = event.clientX === 0 && event.clientY === 0;
		target = {
			path,
			x: fromKeyboard ? box.left : event.clientX,
			y: fromKeyboard ? box.bottom : event.clientY,
		};
	}

	function copy(absolute: boolean): void {
		const path = target?.path;
		target = null;
		if (path) copyWorkstreamPathCommand({ workstreamId, path, absolute });
	}
</script>

<svelte:document oncontextmenu={onContextMenu} />

{#if target}
	<div
		bind:this={anchor}
		class="pointer-events-none fixed size-0"
		style:left="{target.x}px"
		style:top="{target.y}px"
		data-dropdown-anchor
	></div>
{/if}

<DropdownLayer
	open={target !== null && anchor !== null}
	{anchor}
	onclose={() => (target = null)}
	offset={2}
	restoreFocusToAnchor={false}
	panelClass="min-w-44 overflow-hidden rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	testId="workstream-path-context-menu"
>
	<DropdownItem role="menuitem" onclick={() => copy(false)}>
		<Icon name="copy" size={14} class="text-fg-tertiary shrink-0" />
		Copy relative path
	</DropdownItem>
	<DropdownItem role="menuitem" onclick={() => copy(true)}>
		<Icon name="folder-open" size={14} class="text-fg-tertiary shrink-0" />
		Copy absolute path
	</DropdownItem>
</DropdownLayer>
