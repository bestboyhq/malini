<script lang="ts">
	import { parseAutomationTrigger } from '$contract/automation-trigger';
	import { EVENT_CATALOG } from '$contract/event-catalog';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { Select } from '$hyper-ui/components/select';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import {
		LAB_CUSTOM_TRIGGER_ID,
		LAB_TRIGGER_GROUPS,
		LAB_TRIGGERS,
		type LabJobSetup,
	} from './lab-triggers';

	interface Props {
		anchor: HTMLElement | null;
		current: LabJobSetup;
		onpick: (choice: Readonly<{ triggerId: string; phrase?: string }>) => void;
		onclose: () => void;
	}

	let { anchor, current, onpick, onclose }: Props = $props();

	const channels = Object.keys(EVENT_CATALOG) as (keyof typeof EVENT_CATALOG)[];

	let search = $state('');
	let searchEl: HTMLInputElement | null = $state(null);
	let advanced = $state(false);
	let channel = $state<string>('pull-requests:ship-changed');
	let where = $state('');

	const terms = $derived(search.trim().toLowerCase().split(/\s+/u).filter(Boolean));
	const matches = $derived(
		LAB_TRIGGERS.filter((trigger) =>
			terms.every((term) => `${trigger.label} ${trigger.detail}`.toLowerCase().includes(term)),
		),
	);
	const phrase = $derived(where.trim() ? `on ${channel} where ${where.trim()}` : `on ${channel}`);
	const validation = $derived.by(() => {
		try {
			parseAutomationTrigger(phrase);
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	});
	const channelDescription = $derived(
		channel in EVENT_CATALOG
			? EVENT_CATALOG[channel as keyof typeof EVENT_CATALOG].description
			: '',
	);

	$effect(() => {
		searchEl?.focus();
	});

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
			return;
		}
		const first = matches[0];
		if (event.key === 'Enter' && first) {
			event.preventDefault();
			onpick({ triggerId: first.id });
		}
	}
</script>

<DropdownLayer
	open
	{anchor}
	{onclose}
	side="bottom"
	align="start"
	panelClass="w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated"
	role={null}
	keyboardNavigation={false}
	testId="lab-trigger-picker"
>
	<div role="dialog" aria-label="When should it run">
		{#if advanced}
			<div class="flex flex-col gap-3 p-3">
				<div class="flex items-center gap-2">
					<Button variant="ghost" size="sm" onclick={() => (advanced = false)}>
						{#snippet leading()}
							<Icon name="chevron-left" size={14} />
						{/snippet}
						Triggers
					</Button>
					<span class="text-fg-default text-xs font-medium">Any Malini event</span>
				</div>
				<Select
					bind:value={channel}
					label="Event"
					options={channels.map((value) => ({ value, label: value }))}
				/>
				<p class="text-fg-tertiary -mt-1 text-xs leading-5">{channelDescription}</p>
				<TextInput
					bind:value={where}
					label="Only when"
					placeholder="merged is set"
					hint="A payload field: path is value, or path is set. Join with and."
				/>
				<div
					class="border-surface-100-border bg-surface-100 text-fg-secondary rounded-lg border-[0.5px] px-3 py-2 font-mono text-xs"
				>
					{phrase}
				</div>
				{#if validation}
					<p class="text-error-content text-xs" role="alert">{validation}</p>
				{/if}
				<div class="flex justify-end">
					<Button
						variant="primary"
						size="sm"
						disabled={validation !== null}
						onclick={() => onpick({ triggerId: LAB_CUSTOM_TRIGGER_ID, phrase })}
					>
						Use this event
					</Button>
				</div>
			</div>
		{:else}
			<div class="border-surface-elevated-border flex items-center gap-2 border-b px-3 py-2.5">
				<Icon name="search" class="text-fg-tertiary shrink-0" size={15} />
				<TextInput
					bind:element={searchEl}
					bind:value={search}
					bare
					type="search"
					placeholder="When should it run?"
					ariaLabel="Find a trigger"
					class="h-7 min-w-0 flex-1 text-sm"
					inputClass="[&::-webkit-search-cancel-button]:hidden"
					onkeydown={onKeydown}
				/>
				<kbd
					class="border-chip-border bg-chip text-2xs text-fg-tertiary rounded border px-1.5 py-0.5"
				>
					esc
				</kbd>
			</div>
			<div
				class="styled-scrollbar max-h-80 overflow-y-auto p-1.5"
				role="listbox"
				aria-label="Triggers"
			>
				{#each LAB_TRIGGER_GROUPS as group (group)}
					{@const items = matches.filter((trigger) => trigger.group === group)}
					{#if items.length > 0}
						<p class="text-fg-tertiary text-2xs px-2.5 pt-2 pb-1 font-medium">{group}</p>
						{#each items as trigger (trigger.id)}
							<DropdownItem
								role="option"
								aria-selected={trigger.id === current.triggerId}
								selected={trigger.id === current.triggerId}
								focusOnHover={false}
								class="w-full gap-2.5 px-2.5 py-1.5 text-left"
								onclick={() => onpick({ triggerId: trigger.id })}
							>
								<span
									class="border-chip-border bg-chip text-fg-secondary grid size-7 shrink-0 place-items-center rounded-md border-[0.5px]"
								>
									<Icon name={trigger.icon} size={14} />
								</span>
								<span class="min-w-0 flex-1">
									<span class="text-fg-default block truncate text-xs font-medium">
										{trigger.label}
									</span>
									<span class="text-2xs text-fg-tertiary block truncate">{trigger.detail}</span>
								</span>
								{#if trigger.id === current.triggerId}
									<Icon name="check" size={14} class="text-fg-secondary shrink-0" />
								{/if}
							</DropdownItem>
						{/each}
					{/if}
				{/each}
				{#if matches.length === 0}
					<p class="text-fg-tertiary px-2.5 py-3 text-xs">No trigger matches “{search.trim()}”</p>
				{/if}
			</div>
			<div class="border-surface-elevated-border flex items-center border-t px-1.5 py-1.5">
				<Button variant="ghost" size="sm" onclick={() => (advanced = true)}>
					{#snippet leading()}
						<Icon name="signal" size={14} />
					{/snippet}
					Any Malini event…
				</Button>
			</div>
		{/if}
	</div>
</DropdownLayer>
