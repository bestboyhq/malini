<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { GitHubIcon, Icon } from '$hyper-ui/icons';
	import { startDependencyWorkstreamCommand } from '$lib/app/application/commands/start-dependency-workstream.command';
	import { startWorkstreamFromNoteCommand } from '$lib/app/application/commands/start-workstream-from-note.command';
	import { workstreamStandingQuery } from '$lib/app/application/queries/workstream-standing.query.svelte';
	import { Initiatives } from '$lib/initiatives/initiatives.api';
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
	import OwnPullRequests from '../OwnPullRequests.svelte';
	import SavedForLater from '../SavedForLater.svelte';

	const SCRATCHPAD_ID = 'repository-scratchpad';

	const repositoryId = $derived(page.params.repositoryId ?? '');
	const repositories = $derived(connectedRepositoriesQuery.data);
	const scopeLoaded = $derived(repositoriesScopeLoadedQuery.data);
	const repository = $derived(repositories.find(({ id }) => id === repositoryId) ?? null);
	const title = $derived(repository ? repositoryName(repository.fullName) : 'Repository');
	const preparation = $derived(repository ? repositoryPreparationQuery.data(repository) : null);

	let scratchpadOpen: boolean = $state(false);
	let scratchpadButton: HTMLAnchorElement | HTMLButtonElement | null = $state(null);

	function closeScratchpadOnEscape(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		scratchpadOpen = false;
		scratchpadButton?.focus();
	}
</script>

<svelte:head>
	<title>Malini · {title}</title>
</svelte:head>

<div class="flex h-full w-full">
	<ScrollableDiv class="h-full min-w-0 flex-1" ariaLabel={title} testId="repository-page">
		<main class={['mx-auto w-full max-w-[760px] pt-20', scratchpadOpen ? 'px-10' : 'px-16']}>
			{#if repository}
				{@const repo = repository}
				{@const owner = repositoryOwner(repo.fullName)}
				{@const webUrl = repositoryWebUrl(repo.remoteUrl)}
				<header class="mb-8 flex flex-wrap items-center gap-3">
					<RepositoryAvatar fullName={repo.fullName} size={28} />
					<h1 class="text-fg-default min-w-0 truncate text-2xl font-medium tracking-tight">
						{#if owner}<span class="text-fg-tertiary font-normal">{owner} /</span>{/if}
						{repositoryName(repo.fullName)}
					</h1>
					<div class="ml-auto flex shrink-0 items-center gap-1">
						<Button
							variant="ghost"
							size="sm"
							ariaExpanded={scratchpadOpen}
							ariaControls={SCRATCHPAD_ID}
							active={scratchpadOpen}
							bind:element={scratchpadButton}
							onclick={() => (scratchpadOpen = !scratchpadOpen)}
						>
							{#snippet leading()}<Icon name="note" size={14} />{/snippet}
							Scratchpad
						</Button>
						{#if owner && preparation?.kind === 'ready'}
							<OwnPullRequests repositoryId={repo.id} />
						{/if}
						{#if webUrl}
							<Button variant="ghost" size="sm" href={webUrl}>
								{#snippet leading()}<GitHubIcon size={14} />{/snippet}
								Open on GitHub
							</Button>
						{/if}
					</div>
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
								<Button
									variant="secondary"
									size="sm"
									onclick={() => prepareRepositoryCommand(repo)}
								>
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
				<SavedForLater repositoryId={repo.id} />
				<Initiatives
					repository={repo}
					standingOf={workstreamStandingQuery.of}
					onstart={(initiative, dependency) =>
						startDependencyWorkstreamCommand(initiative, dependency, repo)}
				/>
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
	{#if repository && scratchpadOpen}
		{@const repo = repository}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<aside
			id={SCRATCHPAD_ID}
			aria-label="Scratchpad"
			class="border-surface-50-border flex w-96 shrink-0 flex-col border-l-[0.5px]"
			onkeydown={closeScratchpadOnEscape}
		>
			<ScrollableDiv class="min-h-0 flex-1">
				<div class="pt-20 pr-6 pb-6 pl-12">
					{#key repo.fullName}
						<Scratchpad
							repositoryFullName={repo.fullName}
							onstartworkstream={(start) => startWorkstreamFromNoteCommand(repo, start)}
						/>
					{/key}
				</div>
			</ScrollableDiv>
		</aside>
	{/if}
</div>
