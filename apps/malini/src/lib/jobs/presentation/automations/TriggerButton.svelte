<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { triggerFor } from './triggers';
	import TriggerPicker from './TriggerPicker.svelte';

	interface Props {
		when: string | null;
		jobName: string;
		disabled?: boolean;
		schedulable?: boolean;
		onpick: (when: string | null) => void;
	}

	let { when, jobName, disabled = false, schedulable = true, onpick }: Props = $props();

	let open = $state(false);
	let opened = $state(0);
	let element: HTMLAnchorElement | HTMLButtonElement | null = $state(null);

	const trigger = $derived(triggerFor(when));

	function onToggle(): void {
		if (!open) opened += 1;
		open = !open;
	}

	function onPick(next: string | null): void {
		open = false;
		if (next !== when) onpick(next);
	}
</script>

<Button
	bind:element
	variant="secondary"
	size="sm"
	ariaLabel={`When ${jobName} runs: ${trigger.label}`}
	ariaHasPopup="dialog"
	ariaExpanded={open}
	{disabled}
	class="max-w-full min-w-0"
	onclick={onToggle}
>
	{#snippet leading()}
		<Icon name={trigger.icon} size={14} />
	{/snippet}
	<span class="min-w-0 truncate">{trigger.label}</span>
	{#snippet trailing()}
		<Icon name="chevron-down" size={12} class="text-fg-tertiary" />
	{/snippet}
</Button>

{#if open}
	{#key opened}
		<TriggerPicker
			anchor={element instanceof HTMLElement ? element : null}
			{when}
			{schedulable}
			onpick={onPick}
			onclose={() => (open = false)}
		/>
	{/key}
{/if}
