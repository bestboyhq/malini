<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { JobsSection } from '$lib/jobs/jobs.api';
	import { RoutinesSection } from '$lib/routines/routines.api';
</script>

<svelte:head>
	<title>malini · Jobs</title>
</svelte:head>

<main class="native-band-row-reserve h-full min-h-0 overflow-y-auto" data-testid="jobs-page">
	<div class="mx-auto w-full max-w-[640px] space-y-10 px-6 pt-6 pb-16">
		<header>
			<Button
				href="/"
				variant="ghost"
				size="sm"
				class="-ml-2"
				ariaLabel="Back to workstreams"
				data-testid="jobs-back"
			>
				{#snippet leading()}
					<Icon name="chevron-left" size={14} />
				{/snippet}
				Back
			</Button>
			<div class="mt-8">
				<h1 class="text-fg-default text-xl font-semibold tracking-tight">Jobs</h1>
				<p class="text-fg-tertiary mt-1 text-xs">
					A job is one piece of agent work that runs in its own chat. Run it yourself, let the merge
					queue start it, or chain jobs in a routine.
				</p>
			</div>
		</header>

		<JobsSection />

		<RoutinesSection />
	</div>
</main>
