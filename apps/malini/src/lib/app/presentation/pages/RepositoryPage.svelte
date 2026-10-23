<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { GitHubIcon, Icon } from '$hyper-ui/icons';
	import { startWorkstreamFromNoteCommand } from '$lib/app/application/commands/start-workstream-from-note.command';
	import { Scratchpad } from '$lib/scratchpad/scratchpad.api';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import {
		RemoveRepositoryButton,
		RepositoryAvatar,
		activeWorkstreamsQuery,
		connectedRepositoriesQuery,
		prepareRepositoryCommand,
		removeRepositoryCommand,
		repositoriesScopeLoadedQuery,
		repositoryName,
		repositoryOwner,
		repositoryPreparationQuery,
		repositoryWebUrl,
		workstreamsForRepository,
	} from '$shared/repositories/repositories.api';
	import { page } from '$shared/router/state';

	const repositoryId = $derived(page.params.repositoryId ?? '');
	const repositories = $derived(connectedRepositoriesQuery.data);
	const scopeLoaded = $derived(repositoriesScopeLoadedQuery.data);
	const repository = $derived(repositories.find(({ id }) => id === repositoryId) ?? null);
	const title = $derived(repository ? repositoryName(repository.fullName) : 'Repository');
	const preparation = $derived(repository ? repositoryPreparationQuery.data(repository) : null);
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
			{#if preparation?.kind === 'failed'}
				<div
					class="border-surface-50-border bg-surface-50 -mx-4 mb-8 rounded-2xl border-[0.5px] px-2"
					data-testid="repository-preparation-error"
				>
					<StateBlock
						layout="inline"
						live="alert"
						tone="critical"
						heading="Could not clone this repository"
						detail={preparation.failure.detail}
						remedy={preparation.failure.remedy ?? 'Workstreams start once it clones.'}
						technical={preparation.failure.technical}
					>
						{#snippet icon()}
							<Icon name="alert" size={14} />
						{/snippet}
						{#snippet action()}
							<Button variant="secondary" size="sm" onclick={() => prepareRepositoryCommand(repo)}>
								{#snippet leading()}<Icon name="refresh" size={14} />{/snippet}
								Retry
							</Button>
							<RemoveRepositoryButton
								repository={repo}
								workstreams={workstreamsForRepository(repo, activeWorkstreamsQuery.data)}
								onremove={removeRepositoryCommand}
								placement="top"
								testId="repository-preparation-remove"
							/>
						{/snippet}
					</StateBlock>
				</div>
			{/if}
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
