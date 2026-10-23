<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { JOBS_HREF } from '$shared/router/routes-hrefs';
	import { page } from '$shared/router/state';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { waitingForYouJobCountQuery } from '$lib/jobs/application/queries/waiting-for-you-job-count.query.svelte';

	const needsYou = $derived(waitingForYouJobCountQuery.data);
	const current = $derived(page.url.pathname.startsWith(JOBS_HREF));
	const needsYouText = $derived(`${needsYou} ${needsYou === 1 ? 'job needs' : 'jobs need'} you`);

	onMount(() => {
		loadJobsCommand();
		return watchJobsHook();
	});
</script>

<Tooltip content={needsYou > 0 ? `Jobs · ${needsYouText}` : 'Jobs'} placement="right">
	<Button
		iconOnly
		variant="ghost"
		size="sm"
		href={JOBS_HREF}
		ariaLabel="Jobs"
		active={current}
		{...current ? { ariaCurrent: 'page' as const } : {}}
		{...needsYou > 0 ? { ariaDescribedby: 'sidebar-jobs-needs-you' } : {}}
		data-testid="sidebar-open-jobs"
	>
		<span class="relative grid place-items-center">
			<Icon name="checklist" size={15} />
			{#if needsYou > 0}
				<span
					class="bg-warning text-warning-content ring-border-default absolute -right-1.5 -bottom-1 grid min-h-3 min-w-3 place-items-center rounded-full px-0.5 text-[8px] leading-3 font-medium tabular-nums ring-1"
					aria-hidden="true"
					data-testid="sidebar-jobs-needs-you-count"
				>
					{needsYou}
				</span>
				<span id="sidebar-jobs-needs-you" class="sr-only">{needsYouText}</span>
			{/if}
		</span>
	</Button>
</Tooltip>
