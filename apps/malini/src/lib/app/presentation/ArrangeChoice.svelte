<script lang="ts" generics="Value extends string">
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { Icon, type IconName } from '$hyper-ui/icons';

	let {
		icon,
		label,
		value,
		choices,
		icons,
		onchoose,
	}: {
		icon: IconName;
		label: string;
		value: Value;
		choices: readonly Readonly<{ value: Value; label: string }>[];
		icons: Readonly<Record<Value, IconName>>;
		onchoose: (value: Value) => void;
	} = $props();

	let open = $state(false);

	const current = $derived(choices.find((choice) => choice.value === value)?.label ?? value);
</script>

<div class="flex h-8 items-center gap-2 pr-1 pl-2">
	<Icon name={icon} size={14} class="text-fg-tertiary shrink-0" />
	<span class="text-fg-secondary min-w-0 flex-1 truncate text-xs" aria-hidden="true">{label}</span>
	<Dropdown
		bind:open
		nested
		side="bottom"
		align="end"
		sideOffset={4}
		role={null}
		panelClass="w-40"
		contentClass="p-1"
	>
		{#snippet trigger()}
			<Button
				variant="secondary"
				bordered
				size="sm"
				ariaLabel={`${label}: ${current}`}
				ariaHasPopup="menu"
				ariaExpanded={open}
				class="w-36 font-normal"
			>
				{#snippet leading()}
					<Icon name={icons[value]} size={13} class="text-fg-tertiary" />
				{/snippet}
				<span class="text-fg-default min-w-0 flex-1 truncate text-left">{current}</span>
				{#snippet trailing()}
					<Icon name="chevron-down" size={12} class="text-fg-tertiary" />
				{/snippet}
			</Button>
		{/snippet}
		{#snippet content()}
			<div role="menu" aria-label={label}>
				{#each choices as choice (choice.value)}
					<DropdownItem
						role="menuitemradio"
						aria-checked={choice.value === value}
						class="min-h-7 gap-2 px-2 py-1 text-xs"
						onSelect={() => onchoose(choice.value)}
					>
						<Icon name={icons[choice.value]} size={14} class="text-fg-tertiary shrink-0" />
						<span class="min-w-0 flex-1 truncate text-left">{choice.label}</span>
						{#if choice.value === value}
							<Icon name="check" size={13} class="text-fg-secondary shrink-0" />
						{/if}
					</DropdownItem>
				{/each}
			</div>
		{/snippet}
	</Dropdown>
</div>
