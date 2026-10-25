<script lang="ts" generics="Value extends string">
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { Icon } from '$hyper-ui/icons';

	let {
		label,
		value,
		choices,
		onchoose,
	}: {
		label: string;
		value: Value;
		choices: readonly Readonly<{ value: Value; label: string }>[];
		onchoose: (value: Value) => void;
	} = $props();

	let open = $state(false);

	const current = $derived(choices.find((choice) => choice.value === value)?.label ?? value);
</script>

<div class="flex h-9 items-center justify-between gap-3 px-1.5">
	<span class="text-fg-secondary text-sm" aria-hidden="true">{label}</span>
	<Dropdown bind:open nested side="bottom" align="end" sideOffset={4} role={null} panelClass="w-36">
		{#snippet trigger()}
			<Button
				variant="secondary"
				bordered
				ariaLabel={`${label}: ${current}`}
				ariaHasPopup="menu"
				ariaExpanded={open}
				class="w-36"
			>
				<span class="min-w-0 flex-1 truncate text-left">{current}</span>
				{#snippet trailing()}
					<Icon name="chevron-down" size={13} class="text-fg-tertiary" />
				{/snippet}
			</Button>
		{/snippet}
		{#snippet content()}
			<div role="menu" aria-label={label}>
				{#each choices as choice (choice.value)}
					<DropdownItem
						role="menuitemradio"
						aria-checked={choice.value === value}
						class="gap-2.5"
						onSelect={() => onchoose(choice.value)}
					>
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
