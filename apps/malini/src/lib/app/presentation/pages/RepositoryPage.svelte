<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { GitHubIcon, Icon } from '$hyper-ui/icons';
	import { startWorkstreamFromNoteCommand } from '$lib/app/application/commands/start-workstream-from-note.command';
	import { Scratchpad } from '$lib/scratchpad/scratchpad.api';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import {
		RepositoryAvatar,
		connectedRepositoriesQuery,
		repositoriesScopeLoadedQuery,
		repositoryName,
		repositoryOwner,
		repositoryWebUrl,
	} from '$shared/repositories/repositories.api';
	import { page } from '$shared/router/state';

	const repositoryId = $derived(page.params.repositoryId ?? '');
	const repositories = $derived(connectedRepositoriesQuery.data);
	const scopeLoaded = $derived(repositoriesScopeLoadedQuery.data);
	const repository = $derived(repositories.find(({ id }) => id === repositoryId) ?? null);
	const title = $derived(repository ? repositoryName(repository.fullName) : 'Repository');
</script>

<svelte:head>
	<title>Malini · {title}</title>
</svelte:head>

<ScrollableDiv
	class="h-full w-full flex-1"
	ariaLabel={`${title} scratchpad`}
	testId="repository-page"
>
	<main class="mx-auto w-full max-w-[760px] px-16 pt-20">
		{#if repository}
			{@const repo = repository}
			{@const owner = repositoryOwner(repo.fullName)}
			{@const webUrl = repositoryWebUrl(repo.remoteUrl)}
			<header class="mb-8 flex items-center gap-3">
				<RepositoryAvatar fullName={repo.fullName} size={28} />
				<h1 class="text-fg-default min-w-0 truncate text-2xl font-medium tracking-tight">
					{#if owner}<span class="text-fg-tertiary font-normal">{owner} /</span>{/if}
					{repositoryName(repo.fullName)}
				</h1>
				{#if webUrl}
					<Button variant="ghost" size="sm" href={webUrl} class="ml-auto shrink-0">
						{#snippet leading()}<GitHubIcon size={14} />{/snippet}
						Open on GitHub
					</Button>
				{/if}
			</header>
			{#key repo.fullName}
				<Scratchpad
					repositoryFullName={repo.fullName}
					onstartworkstream={(start) => startWorkstreamFromNoteCommand(repo, start)}
				/>
			{/key}
		{:else if scopeLoaded}
			<StateBlock
				heading="Repository not found"
				detail="It was removed from Malini, or this link points somewhere else."
				remedy="Pick a repository in the sidebar."
				testId="repository-page-missing"
			>
				{#snippet icon()}
					<Icon name="folder-search" size={20} />
				{/snippet}
			</StateBlock>
		{/if}
	</main>
</ScrollableDiv>
