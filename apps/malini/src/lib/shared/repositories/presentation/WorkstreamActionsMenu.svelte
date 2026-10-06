<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { commitWorkstreamCheckpointCommand } from '$shared/repositories/application/commands/commit-workstream-checkpoint.command';
	import { deleteWorkstreamCommand } from '$shared/repositories/application/commands/delete-workstream.command';
	import { openWorkstreamInEditorCommand } from '$shared/repositories/application/commands/open-workstream-in-editor.command';
	import { revealWorkstreamInFinderCommand } from '$shared/repositories/application/commands/reveal-workstream-in-finder.command';
	import { workstreamBusyActionQuery } from '$shared/repositories/application/queries/workstream-busy-action.query.svelte';

	interface Props {
		workstreamId: string;
		hasChanges: boolean;
		onRemoved: () => void;
		removedNavigationTarget?: string;
	}

	let { workstreamId, hasChanges, onRemoved, removedNavigationTarget }: Props = $props();

	let open = $state(false);
	let triggerEl: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let confirmingDelete = $state(false);
	const busyActionFor = $derived(workstreamBusyActionQuery.data);
	const busyAction = $derived(busyActionFor(workstreamId));
	const busy = $derived(busyAction !== null);

	function close(): void {
		open = false;
		confirmingDelete = false;
		queueMicrotask(() => triggerEl?.focus({ preventScroll: true }));
	}

	function toggle(): void {
		open = !open;
		if (!open) confirmingDelete = false;
	}

	function onCommit(): void {
		if (busy) return;
		commitWorkstreamCheckpointCommand(workstreamId, close);
	}

	function onReveal(): void {
		close();
		revealWorkstreamInFinderCommand(workstreamId);
	}

	function onOpenEditor(): void {
		close();
		openWorkstreamInEditorCommand(workstreamId);
	}

	function onDelete(): void {
		if (!confirmingDelete) {
			confirmingDelete = true;
			return;
		}
		if (busy) return;
		deleteWorkstreamCommand(workstreamId, () => {
			close();
			onRemoved();
		});
	}

	const ITEM =
		'w-full gap-2.5 px-3 py-2 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-40';
	const commitTitle = $derived(
		busyAction === 'commit'
			? 'Committing changes'
			: busyAction !== null
				? 'Another workstream action is running'
				: hasChanges
					? 'Commit changes'
					: 'No changes to commit',
	);
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

<div class="relative shrink-0">
	<Tooltip content="Workstream actions" placement="top" suppressed={open}>
		<IconButton
			bind:element={triggerEl}
			variant="ghost"
			size="md"
			onclick={toggle}
			ariaLabel="Workstream actions"
			ariaHasPopup="menu"
			ariaExpanded={open}
			active={open}
			data-testid="workstream-actions-trigger"
			class="text-fg-tertiary"
		>
			<Icon name="more" size={16} class="rotate-90" />
		</IconButton>
	</Tooltip>

	<DropdownLayer
		{open}
		anchor={triggerEl}
		onclose={close}
		side="bottom"
		align="end"
		panelClass="w-56 overflow-hidden rounded-lg border-[0.5px] border-surface-elevated-border bg-surface-elevated py-1"
		testId="workstream-actions-menu"
		backdropTestId="workstream-actions-backdrop"
	>
		<div role="menu">
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class={ITEM}
				disabled={!hasChanges || busy}
				aria-label={commitTitle}
				aria-busy={busy}
				onclick={onCommit}
			>
				<Icon name="commit" size={16} class="text-fg-tertiary shrink-0" />
				<span class="flex-1">{busy ? 'Committing…' : 'Commit changes'}</span>
			</DropdownItem>
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class={ITEM}
				aria-label="Open workstream in editor"
				onclick={onOpenEditor}
			>
				<Icon name="external-link" size={16} class="text-fg-tertiary shrink-0" />
				<span class="flex-1">Open in editor</span>
			</DropdownItem>
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class={ITEM}
				aria-label="Reveal workstream in Finder"
				onclick={onReveal}
			>
				<Icon name="folder-open" size={16} class="text-fg-tertiary shrink-0" />
				<span class="flex-1">Reveal in Finder</span>
			</DropdownItem>

			<div class="border-surface-elevated-border my-1 border-t" aria-hidden="true"></div>

			<DropdownItem
				role="menuitem"
				variant="danger"
				focusOnHover={false}
				class={ITEM}
				disabled={busy}
				aria-label={deleteLabel}
				aria-busy={busy}
				data-navigation-target={confirmingDelete ? removedNavigationTarget : undefined}
				data-navigation-path-id={confirmingDelete
					? 'expected-path:workstream-lifecycle.exit-active'
					: undefined}
				data-navigation-outcome-key={confirmingDelete ? 'deleted' : undefined}
				onclick={onDelete}
			>
				<Icon name="trash" size={16} class="shrink-0" />
				<span class="flex-1">
					{busy ? 'Deleting…' : confirmingDelete ? 'Click again to delete' : 'Delete workstream'}
				</span>
			</DropdownItem>
		</div>
	</DropdownLayer>
</div>
