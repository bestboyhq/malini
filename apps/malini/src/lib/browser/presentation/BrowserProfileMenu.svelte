<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { browserProfileName } from '$contract/browser';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import type { MenuAlign, MenuSide } from '$hyper-ui/overlay';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';

	import { loadBrowserProfilesCommand } from '../application/commands/load-browser-profiles.command';
	import { browserProfilesQuery } from '../application/queries/browser-profiles.query.svelte';

	interface Props {
		heading: string;
		ariaLabel: string;
		current?: string | null;
		triggerClass?: ClassValue | undefined;
		side?: MenuSide;
		align?: MenuAlign;
		onpick: (profile: string) => void;
		children: Snippet;
	}

	let {
		heading,
		ariaLabel,
		current = null,
		triggerClass,
		side = 'bottom',
		align = 'start',
		onpick,
		children,
	}: Props = $props();

	const profiles = $derived(browserProfilesQuery.data);

	let trigger: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let open = $state(false);
	let naming: string | null = $state(null);

	function onToggle(): void {
		if (!open) loadBrowserProfilesCommand();
		open = !open;
		naming = null;
	}

	function onClose(): void {
		open = false;
		naming = null;
	}

	function onPick(profile: string): void {
		onClose();
		onpick(profile);
	}

	function onNameInput(event: Event): void {
		if (event.currentTarget instanceof HTMLInputElement) naming = event.currentTarget.value;
	}

	function onNameKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		const profile = browserProfileName(naming ?? '');
		if (profile !== null) onPick(profile);
	}

	function focusName(field: HTMLInputElement): void {
		field.focus();
	}
</script>

<Button
	bare
	{ariaLabel}
	ariaHasPopup="menu"
	ariaExpanded={open}
	bind:element={trigger}
	class={triggerClass ?? ''}
	onclick={onToggle}
>
	{@render children()}
</Button>

<DropdownLayer
	role={null}
	{open}
	anchor={trigger}
	onclose={onClose}
	{side}
	{align}
	offset={4}
	panelClass="w-56 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
>
	<div role="menu" aria-label={heading} class="space-y-0.5">
		<p class="text-fg-tertiary px-2.5 pt-1 pb-0.5 text-xs">{heading}</p>
		{#each profiles as profile (profile)}
			<DropdownItem
				role="menuitemradio"
				aria-checked={profile === current}
				checked={profile === current}
				focusOnHover={false}
				onclick={() => onPick(profile)}
			>
				<Icon name="user" size={14} class="shrink-0" />
				<span class="min-w-0 flex-1 truncate">{profile}</span>
				{#if profile === current}
					<Icon name="check" size={14} class="shrink-0" />
				{/if}
			</DropdownItem>
		{/each}
		<div class="border-surface-elevated-border my-1 border-t-[0.5px]"></div>
		{#if naming === null}
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				closeOnSelect={false}
				onclick={() => (naming = '')}
			>
				<Icon name="plus" size={14} class="shrink-0" />
				New profile…
			</DropdownItem>
		{:else}
			<TextInput
				size="xs"
				value={naming}
				ariaLabel="New profile name"
				placeholder="Name it, like reddit-cats"
				autocomplete="off"
				class="px-1 py-0.5"
				inputClass="text-xs"
				oninput={onNameInput}
				onkeydown={onNameKeydown}
				{@attach focusName}
			/>
		{/if}
	</div>
</DropdownLayer>
