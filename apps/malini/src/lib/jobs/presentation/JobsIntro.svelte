<script lang="ts">
	import { onMount } from 'svelte';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { JOBS_HREF, NEW_JOB_HREF, jobHref } from '$shared/router/routes-hrefs';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { builtinJobDefinitionsQuery } from '$lib/jobs/application/queries/builtin-job-definitions.query.svelte';
	import { customJobDefinitionsQuery } from '$lib/jobs/application/queries/custom-job-definitions.query.svelte';
	import { jobWhen } from './job-definition-copy';

	const definitions = $derived([
		...builtinJobDefinitionsQuery.data,
		...customJobDefinitionsQuery.data,
	]);

	onMount(() => {
		loadJobsCommand();
		return watchJobsHook();
	});
</script>

<div data-testid="jobs-intro">
	<ul class="flex flex-col gap-px" aria-label="Jobs">
		{#each definitions as definition (definition.id)}
			<li>
				<a
					href={jobHref(definition.id)}
					class="sidebar-row text-fg-secondary -mx-2 gap-3 px-2"
					data-testid="jobs-intro-job"
				>
					<Icon name="checklist" size={14} class="text-fg-tertiary shrink-0" />
					<span class="text-fg-default shrink-0 text-xs font-medium">{definition.name}</span>
					<span class="text-fg-tertiary min-w-0 flex-1 truncate text-xs">
						{jobWhen(definition)}
					</span>
					<Badge class="shrink-0">{definition.builtin === null ? 'Custom' : 'Built-in'}</Badge>
				</a>
			</li>
		{/each}
	</ul>
	<div class="mt-3 flex items-center gap-2">
		<Button href={NEW_JOB_HREF} variant="secondary" size="sm">
			{#snippet leading()}
				<Icon name="plus" size={14} />
			{/snippet}
			Make your own
		</Button>
		<Button href={JOBS_HREF} variant="ghost" size="sm">See all jobs</Button>
	</div>
</div>
