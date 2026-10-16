<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { JOBS_HREF, ROUTINES_HREF } from '$shared/router/routes-hrefs';
	import { page } from '$shared/router/state';
	import { JobsBrowser } from '$lib/jobs/jobs.api';
	import { RoutinesSection } from '$lib/routines/routines.api';

	const routines = $derived(page.route.id === '/jobs/routines');
	const creating = $derived(page.route.id === '/jobs/new');
	const selectedJobId = $derived(page.params.jobId ?? null);
</script>

<svelte:head>
	<title>malini · {routines ? 'Routines' : 'Jobs'}</title>
</svelte:head>

<main class="flex h-full min-h-0 flex-col" data-testid="jobs-page">
	<header class="flex shrink-0 items-center gap-4 px-6 pt-3 pb-5">
		<h1 class="text-fg-default text-xl font-semibold tracking-tight">Jobs</h1>
		<nav
			class="bg-surface-50 border-surface-50-border inline-flex gap-0.5 rounded-[9px] border-[0.5px] p-0.5"
			aria-label="Jobs and routines"
		>
			<Button
				href={JOBS_HREF}
				size="sm"
				variant="ghost"
				active={!routines}
				{...routines ? {} : { ariaCurrent: 'page' as const }}
			>
				Jobs
			</Button>
			<Button
				href={ROUTINES_HREF}
				size="sm"
				variant="ghost"
				active={routines}
				{...routines ? { ariaCurrent: 'page' as const } : {}}
			>
				Routines
			</Button>
		</nav>
	</header>
	{#if routines}
		<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Routines">
			<div class="mx-auto w-full max-w-[720px] px-8 pb-16">
				<RoutinesSection />
			</div>
		</ScrollableDiv>
	{:else}
		<JobsBrowser {selectedJobId} {creating} />
	{/if}
</main>
