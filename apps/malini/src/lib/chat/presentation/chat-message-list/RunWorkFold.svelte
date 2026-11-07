<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import type { WorkFold } from '../activity-group';
	import ActivityKindIcons from './ActivityKindIcons.svelte';
	import { transcriptContext } from './transcript-context';

	interface Props {
		fold: WorkFold;
		children: Snippet;
	}

	let { fold, children }: Props = $props();

	const { expandedActivityGroups } = transcriptContext();
	let everOpened = $state(false);
	const childrenMounted = $derived(everOpened || expandedActivityGroups[fold.key] === true);
</script>

<details
	class="group/fold w-full text-sm"
	bind:open={expandedActivityGroups[fold.key]}
	ontoggle={(event) => (everOpened ||= event.currentTarget.open)}
	data-message-kind="work-fold"
>
	<summary
		class="text-fg-tertiary hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
		aria-label={`${fold.verb} ${fold.detail}`}
		data-testid="chat-work-fold-summary"
	>
		<span class="grid h-3.5 w-3.5 shrink-0 place-items-center" aria-hidden="true">
			<Icon
				name="chevron-right"
				size={10}
				class="transition-transform duration-150 group-open/fold:rotate-90"
			/>
		</span>
		<span class="text-fg-secondary shrink-0">{fold.verb}</span>
		<span class="min-w-0 truncate"><SensitiveText text={fold.detail} /></span>
		<ActivityKindIcons actionKinds={fold.actionKinds} />
	</summary>
	{#if childrenMounted}
		<div class="border-surface-100-border mt-1 flex flex-col gap-2 border-l pl-3.5">
			{@render children()}
		</div>
	{/if}
</details>
