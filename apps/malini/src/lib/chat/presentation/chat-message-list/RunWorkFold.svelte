<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { leadActionKind, type WorkFold } from '../activity-group';
	import ExpandMark from '../ExpandMark.svelte';
	import ActionKindIcon from '../ActionKindIcon.svelte';
	import ActivityKindIcons from './ActivityKindIcons.svelte';
	import { transcriptContext } from './transcript-context';

	interface Props {
		fold: WorkFold;
		children: Snippet;
	}

	let { fold, children }: Props = $props();

	const { expandedActivityGroups } = transcriptContext();
	let everOpened = $state(false);
	const open = $derived(expandedActivityGroups[fold.key] === true);
	const childrenMounted = $derived(everOpened || open);
	const lead = $derived(leadActionKind(fold.actionKinds));
</script>

<details
	class="w-full text-sm"
	bind:open={expandedActivityGroups[fold.key]}
	ontoggle={(event) => (everOpened ||= event.currentTarget.open)}
	data-message-kind="work-fold"
>
	<summary
		class="group/expand text-fg-tertiary hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
		aria-label={`${fold.verb} ${fold.detail}`}
		aria-expanded={open}
		data-testid="chat-work-fold-summary"
	>
		<ExpandMark>
			<ActionKindIcon kind={lead} size={14} />
		</ExpandMark>
		<span class="text-fg-secondary shrink-0">{fold.verb}</span>
		<span class="min-w-0 truncate"><SensitiveText text={fold.detail} /></span>
		<ActivityKindIcons actionKinds={fold.actionKinds.filter((kind) => kind !== lead)} />
	</summary>
	{#if childrenMounted}
		<div class="border-surface-100-border mt-1 ml-1.5 flex flex-col gap-2 border-l pl-3.5">
			{@render children()}
		</div>
	{/if}
</details>
