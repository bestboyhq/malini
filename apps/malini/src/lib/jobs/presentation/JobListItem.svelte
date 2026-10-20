<script lang="ts">
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Icon } from '$hyper-ui/icons';
	import { jobHref } from '$shared/router/routes-hrefs';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { jobWhen } from './job-definition-copy';

	interface Props {
		definition: JobDefinitionRecord;
		selected: boolean;
	}

	let { definition, selected }: Props = $props();

	const runs = $derived(jobRunsForDefinitionQuery.data(definition.id));
	const needsYou = $derived(runs.some((run) => run.status === 'needs-you'));
	const running = $derived(runs.some((run) => run.status === 'running'));
</script>

<li>
	<a
		href={jobHref(definition.id)}
		aria-current={selected ? 'page' : undefined}
		class={[
			'sidebar-row items-start gap-2 px-2',
			selected ? 'sidebar-row-active' : 'text-fg-secondary',
		]}
		data-testid="job-list-item"
		data-job-definition-id={definition.id}
	>
		<span class="min-w-0 flex-1">
			<span class="text-fg-default block truncate text-sm">{definition.name}</span>
			<span class="text-fg-tertiary block truncate text-xs">{jobWhen(definition)}</span>
		</span>
		{#if needsYou}
			<span class="text-warning-content mt-0.5 grid size-4 shrink-0 place-items-center">
				<Icon name="alert" size={13} />
				<span class="sr-only">Needs you</span>
			</span>
		{:else if running}
			<span class="text-fg-secondary mt-0.5 grid size-4 shrink-0 place-items-center">
				<LoadingCircle size={12} />
				<span class="sr-only">Running</span>
			</span>
		{/if}
	</a>
</li>
