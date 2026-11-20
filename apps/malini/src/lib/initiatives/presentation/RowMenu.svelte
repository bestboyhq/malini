<script lang="ts">
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		name: string;
		confirmsDelete: boolean;
		onrename: () => void;
		onremovedate: (() => void) | null;
		ondelete: () => void;
	}

	let { name, confirmsDelete, onrename, onremovedate, ondelete }: Props = $props();

	let open: boolean = $state(false);
	let armed: boolean = $state(false);

	function onDelete(): void {
		if (confirmsDelete && !armed) {
			armed = true;
			return;
		}
		open = false;
		ondelete();
	}
</script>

<Dropdown bind:open side="bottom" align="end" onOpenChange={() => (armed = false)}>
	{#snippet trigger()}
		<IconButton
			variant="ghost"
			size="sm"
			ariaLabel={`Options for ${name}`}
			ariaHasPopup="menu"
			ariaExpanded={open}
			class={[
				'text-fg-tertiary',
				!open && 'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100',
			]}
		>
			<Icon name="more" size={14} />
		</IconButton>
	{/snippet}
	{#snippet content()}
		<div class="w-44">
			<DropdownItem role="menuitem" onSelect={onrename}>
				<Icon name="pencil" size={14} />
				Rename
			</DropdownItem>
			{#if onremovedate}
				<DropdownItem role="menuitem" onSelect={onremovedate}>
					<Icon name="calendar" size={14} />
					Remove date
				</DropdownItem>
			{/if}
			<DropdownItem
				role="menuitem"
				variant="danger"
				focusOnHover={false}
				closeOnSelect={false}
				onSelect={onDelete}
			>
				<Icon name="trash" size={14} />
				{armed ? 'Click again to delete' : 'Delete'}
			</DropdownItem>
		</div>
	{/snippet}
</Dropdown>
