<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { updateInitiativeCommand } from '$lib/initiatives/application/commands/update-initiative.command';
	import {
		dependenciesFinished,
		initiativeProgress,
		type Initiative,
		type StandingOf,
	} from '$lib/initiatives/domain/initiative';
	import ProgressRing from './ProgressRing.svelte';

	interface Props {
		initiative: Initiative;
		standingOf: StandingOf;
		size: number;
		class?: ClassValue;
	}

	let { initiative, standingOf, size, class: className = '' }: Props = $props();

	const progress = $derived(initiativeProgress(initiative, standingOf));
	const byDependencies = $derived(dependenciesFinished(initiative, standingOf));
</script>

{#if byDependencies}
	<Tooltip content="Every dependency is done" placement="top" class="flex shrink-0">
		<span role="img" aria-label="Done" class={['flex', className]}>
			<ProgressRing done={progress.done} total={progress.total} finished {size} />
		</span>
	</Tooltip>
{:else}
	<Tooltip
		content={initiative.done ? 'Done. Click to undo' : 'Mark done'}
		placement="top"
		class="flex shrink-0"
	>
		<IconButton
			variant="ghost"
			size="xs"
			role="checkbox"
			ariaChecked={initiative.done}
			ariaLabel={initiative.title}
			class={className}
			onclick={(event) => {
				event.stopPropagation();
				updateInitiativeCommand(initiative.id, { done: !initiative.done });
			}}
		>
			<ProgressRing done={progress.done} total={progress.total} finished={initiative.done} {size} />
		</IconButton>
	</Tooltip>
{/if}
