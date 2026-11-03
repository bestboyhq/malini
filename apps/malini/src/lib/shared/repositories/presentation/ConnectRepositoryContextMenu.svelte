<script module lang="ts">
	export type ConnectRepositoryContextMenuTarget = Readonly<{ x: number; y: number }>;
</script>

<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { requestRepositoryFolderCommand } from '$shared/repositories/application/commands/request-repository-folder.command';

	interface Props {
		target: ConnectRepositoryContextMenuTarget | null;
		onclose: () => void;
		onclone: () => void;
	}

	let { target, onclose, onclone }: Props = $props();

	let anchor = $state<HTMLDivElement | null>(null);

	function onOpenFolder(): void {
		onclose();
		requestRepositoryFolderCommand();
	}

	function onClone(): void {
		onclose();
		onclone();
	}

	function bodyAnchor(node: HTMLDivElement): () => void {
		document.body.append(node);
		anchor = node;
		return () => {
			node.remove();
			if (anchor === node) anchor = null;
		};
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
	role={null}
	open={target !== null && anchor !== null}
	{anchor}
	{onclose}
	offset={2}
	restoreFocusToAnchor={false}
	panelClass="w-max min-w-44 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	testId="connect-repository-context-menu"
>
	<div role="menu" aria-label="Add a repository" class="space-y-0.5">
		<DropdownItem role="menuitem" focusOnHover={false} class="gap-2.5" onclick={onOpenFolder}>
			<Icon name="folder-open" class="shrink-0" size={15} />
			Open folder…
		</DropdownItem>
		<DropdownItem role="menuitem" focusOnHover={false} class="gap-2.5" onclick={onClone}>
			<Icon name="cloud-download" class="shrink-0" size={15} />
			Clone repository…
		</DropdownItem>
	</div>
</DropdownLayer>
