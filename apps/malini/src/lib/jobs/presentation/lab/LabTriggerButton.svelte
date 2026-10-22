<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { labTrigger, type LabJobSetup } from './lab-triggers';
	import LabTriggerPicker from './LabTriggerPicker.svelte';

	interface Props {
		setup: LabJobSetup;
		jobName: string;
		size?: 'xs' | 'sm';
		onchange: (setup: LabJobSetup) => void;
	}

	let { setup, jobName, size = 'sm', onchange }: Props = $props();

	let open = $state(false);
	let element: HTMLAnchorElement | HTMLButtonElement | null = $state(null);

	const trigger = $derived(labTrigger(setup));

	function onPick(choice: Readonly<{ triggerId: string; phrase?: string }>): void {
		const { phrase: _previous, ...rest } = setup;
		onchange({ ...rest, ...choice });
		open = false;
	}
</script>

<Button
	bind:element
	variant="secondary"
	{size}
	ariaLabel={`When ${jobName} runs: ${trigger.label}`}
	ariaHasPopup="dialog"
	ariaExpanded={open}
	class="max-w-full min-w-0"
	onclick={() => (open = !open)}
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
	<LabTriggerPicker
		anchor={element instanceof HTMLElement ? element : null}
		current={setup}
		onpick={onPick}
		onclose={() => (open = false)}
	/>
{/if}
