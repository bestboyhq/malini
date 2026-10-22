<script lang="ts" generics="T extends string">
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { Icon, type IconName } from '$hyper-ui/icons';

	let {
		value,
		options,
		ariaLabel,
		icon,
		size = 'sm',
		onchange,
	}: {
		value: T;
		options: readonly Readonly<{ value: T; label: string }>[];
		ariaLabel: string;
		icon?: IconName;
		size?: 'xs' | 'sm';
		onchange: (value: T) => void;
	} = $props();

	let open = $state(false);

	const current = $derived(options.find((option) => option.value === value)?.label ?? value);
</script>

<Dropdown bind:open side="bottom" align="start" role={null}>
	{#snippet trigger()}
		<Button
			variant="secondary"
			{size}
			ariaLabel={`${ariaLabel}: ${current}`}
			ariaHasPopup="menu"
			ariaExpanded={open}
		>
			{#snippet leading()}
				{#if icon}
					<Icon name={icon} size={14} />
				{/if}
			{/snippet}
			{current}
			{#snippet trailing()}
				<Icon name="chevron-down" size={12} class="text-fg-tertiary" />
			{/snippet}
		</Button>
	{/snippet}
	{#snippet content()}
		<div class="w-60 p-1" role="menu" aria-label={ariaLabel}>
			{#each options as option (option.value)}
				<DropdownItem
					role="menuitemradio"
					aria-checked={option.value === value}
					selected={option.value === value}
					class="gap-2"
					onSelect={() => {
						open = false;
						onchange(option.value);
					}}
				>
					<span class="min-w-0 flex-1 truncate text-left">{option.label}</span>
					{#if option.value === value}
						<Icon name="check" size={13} class="text-fg-secondary shrink-0" />
					{/if}
				</DropdownItem>
			{/each}
		</div>
	{/snippet}
</Dropdown>
