<script lang="ts">
	import { onMount } from 'svelte';
	import { Icon } from '$hyper-ui/icons';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { builtinJobDefinitionsQuery } from '$lib/jobs/application/queries/builtin-job-definitions.query.svelte';
	import { jobWhen } from './job-definition-copy';

	onMount(() => {
		loadJobsCommand();
		return watchJobsHook();
	});
</script>

<ul class="flex flex-col gap-px" aria-label="Built-in jobs">
	{#each builtinJobDefinitionsQuery.data as definition (definition.id)}
		<li class="text-fg-tertiary flex items-center gap-3 py-1.5 text-xs">
			<Icon name="checklist" size={14} class="shrink-0" />
			<span class="text-fg-default shrink-0 font-medium">{definition.name}</span>
			<span class="min-w-0 flex-1 truncate">{jobWhen(definition)}</span>
		</li>
	{/each}
</ul>
