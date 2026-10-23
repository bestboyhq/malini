<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AgentActionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import AgentActionRow from './AgentActionRow.svelte';

	interface Props {
		calls: readonly AgentActionRecord[];
		nowMs: number;
		subject: string;
		row: Snippet<[Snippet | undefined]>;
	}

	let { calls, nowMs, subject, row }: Props = $props();

	let open = $state(false);

	const callsId = $props.id();
	const count = $derived(`${calls.length} ${calls.length === 1 ? 'call' : 'calls'}`);
</script>

{#snippet toggle()}
	<Button
		bare
		ariaExpanded={open}
		ariaControls={callsId}
		ariaLabel={`${open ? 'Hide' : 'Show'} ${count} in ${subject}`}
		class="text-fg-tertiary hover:text-fg-default hover:bg-surface-50-hover focus-visible:ring-border-default/50 flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-1.5 text-xs outline-none focus-visible:ring-2"
		onclick={() => (open = !open)}
	>
		{count}
		<Icon
			name="chevron-down"
			size={12}
			class={[
				'transition-transform duration-150 motion-reduce:transition-none',
				open && 'rotate-180',
			]}
		/>
	</Button>
{/snippet}

{@render row(calls.length > 0 ? toggle : undefined)}
{#if open}
	<ul id={callsId} aria-label={`Calls in ${subject}`} class="flex flex-col pl-6">
		{#each calls as action (action.id)}
			<li><AgentActionRow {action} {nowMs} nested /></li>
		{/each}
	</ul>
{/if}
