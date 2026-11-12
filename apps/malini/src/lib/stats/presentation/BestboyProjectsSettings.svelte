<script lang="ts">
	import { onMount } from 'svelte';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { Well } from '$hyper-ui/components/well';
	import { loadProjectsCommand } from '$lib/stats/application/commands/load-projects.command';
	import { watchProjectsHook } from '$lib/stats/application/hooks/watch-projects.hook';
	import { projectsQuery } from '$lib/stats/application/queries/projects.query.svelte';
	import BestboyProjectRow from './BestboyProjectRow.svelte';

	const listing = $derived(projectsQuery.data);
	const on = $derived(listing?.projects.filter((project) => project.on).length ?? 0);

	onMount(() => {
		loadProjectsCommand();
		return watchProjectsHook();
	});
</script>

<Well title="Projects on Bestboy" note={listing ? `${on} on` : undefined}>
	<p class="text-fg-tertiary px-3 pb-1.5 text-xs">
		Each project you turn on gets a preview page on bestboy.dev that only its makers see, with the
		runs Malini counted and the changelog from its CHANGELOG.md. Submit it from there, and we review
		each project by hand before it joins the board. A private repository keeps its name to itself.
	</p>
	{#if listing?.problem}
		<p class="text-error-content px-3 pb-1.5 text-xs" role="alert">{listing.problem}</p>
	{:else if listing && !listing.signedIn}
		<p class="text-fg-tertiary px-3 pb-1.5 text-xs">Sign in to Bestboy above to turn one on</p>
	{/if}
	{#if listing === null}
		<Skeleton height="52px" class="rounded-xl" />
	{:else if listing.projects.length === 0}
		<p class="text-fg-tertiary px-3 pb-1.5 text-xs">The repositories you run agents in show here</p>
	{:else}
		<ul
			class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
			aria-label="Your projects"
		>
			{#each listing.projects as project (project.repositoryId)}
				<BestboyProjectRow {project} signedIn={listing.signedIn} />
			{/each}
		</ul>
	{/if}
</Well>
