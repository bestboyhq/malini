<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Icon } from '$hyper-ui/icons';
	import { NEW_JOB_HREF } from '$shared/router/routes-hrefs';
	import { builtinJobDefinitionsQuery } from '$lib/jobs/application/queries/builtin-job-definitions.query.svelte';
	import { customJobDefinitionsQuery } from '$lib/jobs/application/queries/custom-job-definitions.query.svelte';
	import { jobsLoadQuery } from '$lib/jobs/application/queries/jobs-load.query.svelte';
	import JobListItem from './JobListItem.svelte';

	interface Props {
		selectedId: string | null;
		creating: boolean;
	}

	let { selectedId, creating }: Props = $props();

	const builtins = $derived(builtinJobDefinitionsQuery.data);
	const custom = $derived(customJobDefinitionsQuery.data);
	const load = $derived(jobsLoadQuery.data);
</script>

<nav class="flex w-64 shrink-0 flex-col" aria-label="Jobs" data-testid="job-list">
	<div class="px-3 pt-1 pb-3">
		<Button
			href={NEW_JOB_HREF}
			variant="secondary"
			size="sm"
			class="w-full"
			active={creating}
			{...creating ? { ariaCurrent: 'page' as const } : {}}
			data-testid="job-list-new"
		>
			{#snippet leading()}
				<Icon name="plus" size={14} />
			{/snippet}
			New job
		</Button>
	</div>
	<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Job list">
		<div class="flex flex-col gap-5 px-3 pb-6">
			<section aria-labelledby="job-list-builtin">
				<h2 id="job-list-builtin" class="text-fg-tertiary px-2 pb-1.5 text-xs font-medium">
					Built in
				</h2>
				<ul class="flex flex-col gap-px">
					{#each builtins as definition (definition.id)}
						<JobListItem {definition} selected={definition.id === selectedId} />
					{/each}
				</ul>
			</section>
			<section aria-labelledby="job-list-yours">
				<h2 id="job-list-yours" class="text-fg-tertiary px-2 pb-1.5 text-xs font-medium">Yours</h2>
				{#if custom.length > 0}
					<ul class="flex flex-col gap-px">
						{#each custom as definition (definition.id)}
							<JobListItem {definition} selected={definition.id === selectedId} />
						{/each}
					</ul>
				{:else if load.state === 'ready'}
					<p class="text-fg-tertiary px-2 text-xs leading-5">
						Jobs you make show up here. Give one a name and the work, then run it from any chat.
					</p>
				{/if}
			</section>
		</div>
	</ScrollableDiv>
</nav>
