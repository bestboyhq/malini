<script module lang="ts">
	export type WorkstreamContextMenuTarget = Readonly<{
		workstreamId: string;
		x: number;
		y: number;
	}>;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon } from '$hyper-ui/icons';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { deleteWorkstreamCommand } from '$shared/repositories/application/commands/delete-workstream.command';
	import { openWorkstreamInEditorCommand } from '$shared/repositories/application/commands/open-workstream-in-editor.command';
	import { revealWorkstreamInFinderCommand } from '$shared/repositories/application/commands/reveal-workstream-in-finder.command';
	import { workstreamBusyActionQuery } from '$shared/repositories/application/queries/workstream-busy-action.query.svelte';

	interface Props {
		target: WorkstreamContextMenuTarget | null;
		onclose: () => void;
		onRemoved: (workstreamId: string) => void;
		removedNavigationTarget: (workstreamId: string) => string | undefined;
		actions?: Snippet<[{ workstreamId: string; close: () => void }]>;
	}

	let { target, onclose, onRemoved, removedNavigationTarget, actions }: Props = $props();

	let anchor = $state<HTMLDivElement | null>(null);
	let confirmingDeleteOf = $state<string | null>(null);
	const busyActionFor = $derived(workstreamBusyActionQuery.data);
	const workstreamId = $derived(target?.workstreamId ?? null);
	const busyAction = $derived(workstreamId ? busyActionFor(workstreamId) : null);
	const busy = $derived(busyAction !== null);
	const confirmingDelete = $derived(workstreamId !== null && confirmingDeleteOf === workstreamId);
	const exitTarget = $derived(
		confirmingDelete && workstreamId ? removedNavigationTarget(workstreamId) : undefined,
	);

	function close(): void {
		confirmingDeleteOf = null;
		onclose();
	}

	function onOpenEditor(): void {
		if (!workstreamId) return;
		close();
		openWorkstreamInEditorCommand(workstreamId);
	}

	function onReveal(): void {
		if (!workstreamId) return;
		close();
		revealWorkstreamInFinderCommand(workstreamId);
	}

	function onDelete(): void {
		if (!workstreamId || busy) return;
		if (!confirmingDelete) {
			confirmingDeleteOf = workstreamId;
			return;
		}
		const deleted = workstreamId;
		deleteWorkstreamCommand(deleted, () => {
			close();
			onRemoved(deleted);
		});
	}

	function bodyAnchor(node: HTMLDivElement): () => void {
		document.body.append(node);
		anchor = node;
		return () => {
			node.remove();
			if (anchor === node) anchor = null;
		};
	}

	const deleteLabel = $derived(
		busyAction === 'delete'
			? 'Deleting workstream'
			: busyAction !== null
				? 'Another workstream action is running'
				: confirmingDelete
					? 'Confirm delete workstream'
					: 'Delete workstream',
	);
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
	onclose={close}
	offset={2}
	restoreFocusToAnchor={false}
	panelClass="w-max min-w-44 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	testId="workstream-context-menu"
>
	<div role="menu" aria-label="Workstream actions" class="space-y-0.5">
		{#if actions && workstreamId}
			{@render actions({ workstreamId, close })}
		{/if}
		<DropdownItem
			role="menuitem"
			focusOnHover={false}
			class="gap-2.5"
			aria-label="Open workstream in editor"
			onclick={onOpenEditor}
		>
			<Icon name="external-link" class="shrink-0" size={15} />
			Open in editor
		</DropdownItem>
		<DropdownItem
			role="menuitem"
			focusOnHover={false}
			class="gap-2.5"
			aria-label="Reveal workstream in Finder"
			onclick={onReveal}
		>
			<Icon name="folder-open" class="shrink-0" size={15} />
			Reveal in Finder
		</DropdownItem>

		<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>

		<DropdownItem
			role="menuitem"
			variant="danger"
			focusOnHover={false}
			class="gap-2.5 disabled:cursor-not-allowed disabled:opacity-40"
			disabled={busy}
			aria-label={deleteLabel}
			aria-busy={busy}
			data-navigation-target={exitTarget}
			data-navigation-path-id={exitTarget
				? 'expected-path:workstream-lifecycle.exit-active'
				: undefined}
			data-navigation-outcome-key={exitTarget ? 'deleted' : undefined}
			onclick={onDelete}
		>
			<Icon name="trash" class="shrink-0" size={15} />
			{busy ? 'Deleting…' : confirmingDelete ? 'Click again to delete' : 'Delete workstream'}
		</DropdownItem>
	</div>
</DropdownLayer>
