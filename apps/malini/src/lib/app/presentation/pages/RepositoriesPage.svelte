<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { repositoryHref } from '$shared/router/routes-hrefs';
	import { onMount } from 'svelte';
	import { GitHubIcon, Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import {
		activeWorkstreamsQuery,
		answerRepositoryConnectionRequestCommand,
		clearRepositoryConnectErrorCommand,
		CloneRepositoryDialog,
		connectedRepositoriesQuery,
		GitHubSetup,
		githubAuthQuery,
		hiddenRepositoriesQuery,
		loadGithubAuthCommand,
		openRepositoryFolderCommand,
		RemoveRepositoryButton,
		removeRepositoryCommand,
		repositoriesScopeErrorQuery,
		repositoriesScopeReadyQuery,
		repositoriesScopeRetryingQuery,
		repositoryConnectErrorQuery,
		repositoryConnectingQuery,
		repositoryConnectionRequestedQuery,
		retryRepositoriesScopeCommand,
		setRepositoryHiddenCommand,
		workstreamsForRepository,
		RepositoryAvatar,
		RepositoryListSkeleton,
		repositoryWebUrl,
		type Repository,
		type Workstream,
	} from '$shared/repositories/repositories.api';
	import { ClaudeCodeSetup, claudeCodeStatusQuery } from '$shared/providers/providers.api';
	import { loadOnboardingCommand } from '$lib/app/application/commands/load-onboarding.command';
	import { onboardingQuery } from '$lib/app/application/queries/onboarding.query.svelte';
	import Onboarding from '../onboarding/Onboarding.svelte';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { describeFailure } from '$shared/errors/failure-copy';

	const REVEAL_ON_ROW_HOVER =
		'pointer-events-none opacity-0 transition-none group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-has-focus-visible/row:pointer-events-auto group-has-focus-visible/row:opacity-100';

	let query = $state('');
	let cloneDialogOpen = $state(false);
	let hiddenOpen = $state(false);

	const workstreams = $derived(activeWorkstreamsQuery.data);
	const repositories = $derived(connectedRepositoriesQuery.data);
	const workstreamScopeReady = $derived(repositoriesScopeReadyQuery.data);
	const workstreamScopeError = $derived(repositoriesScopeErrorQuery.data);
	const retryingScope = $derived(repositoriesScopeRetryingQuery.data);
	const githubAuth = $derived(githubAuthQuery.data);
	const connecting = $derived(repositoryConnectingQuery.data);
	const connectError = $derived(repositoryConnectErrorQuery.data);
	const connectionRequested = $derived(repositoryConnectionRequestedQuery.data);
	const claudeStatus = $derived(claudeCodeStatusQuery.data);
	const claudeNeedsSetup = $derived(
		claudeStatus.kind === 'missing' ||
			claudeStatus.kind === 'signed-out' ||
			claudeStatus.kind === 'unknown',
	);
	const workstreamScopeFailure = $derived(
		workstreamScopeError
			? describeFailure(workstreamScopeError, { subject: 'Repositories' })
			: null,
	);
	const githubSignedOut = $derived(githubAuth !== null && !githubAuth.authenticated);
	const hiddenIds = $derived(hiddenRepositoriesQuery.data);
	const matchingRepositories = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (needle.length === 0) return repositories;
		return repositories.filter((repo) => repo.fullName.toLowerCase().includes(needle));
	});
	const filteredRepositories = $derived(
		matchingRepositories.filter((repo) => !hiddenIds.has(repo.id)),
	);
	const hiddenRepositories = $derived(
		matchingRepositories.filter((repo) => hiddenIds.has(repo.id)),
	);
	const allHidden = $derived(query.trim().length === 0 && hiddenRepositories.length > 0);
	const onboarding = $derived(onboardingQuery.data);
	const firstRun = $derived(
		workstreamScopeReady && !workstreamScopeError && repositories.length === 0,
	);
	const searchPlaceholder = $derived(
		`Search ${repositories.length} ${repositories.length === 1 ? 'repository' : 'repositories'}`,
	);

	onMount(() => {
		loadOnboardingCommand();
		clearRepositoryConnectErrorCommand();
		loadGithubAuthCommand();
	});

	$effect(() => {
		if (connectionRequested)
			answerRepositoryConnectionRequestCommand(() => (cloneDialogOpen = true));
	});

	function workstreamsFor(repo: Repository): Workstream[] {
		return workstreamsForRepository(repo, workstreams);
	}

	function repositoryDetail(repo: Repository, streams: readonly Workstream[]): string {
		const parts = [repositoryLocationLabel(repo), repo.defaultBranch];
		if (streams.length > 0) {
			parts.push(`${streams.length} ${streams.length === 1 ? 'workstream' : 'workstreams'}`);
		}
		return parts.join(' · ');
	}

	function repositoryLocationLabel(repo: Repository): string {
		if (repo.localPath) return repo.localPath.replace(/^\/Users\/[^/]+/u, '~');
		if (repo.remoteUrl) return repo.remoteUrl;
		return `default ${repo.defaultBranch}`;
	}
</script>

{#snippet cloneButton(size: 'sm' | 'md')}
	<Button
		variant="secondary"
		{size}
		disabled={connecting !== null}
		ariaBusy={connecting === 'clone'}
		ariaHasPopup="dialog"
		ariaLabel="Clone a GitHub repository"
		data-testid="repository-clone-open"
		onclick={() => (cloneDialogOpen = true)}
	>
		{#snippet leading()}
			<Icon name="link" size={size === 'md' ? 16 : 14} />
		{/snippet}
		Clone repo
	</Button>
{/snippet}

{#snippet connectErrorBlock(failure: NonNullable<typeof connectError>)}
	<div
		class="border-surface-50-border bg-surface-50 -mx-4 mb-3 rounded-2xl border-[0.5px] px-2"
		data-testid="repository-connect-error"
	>
		<StateBlock
			layout="inline"
			live="alert"
			tone="critical"
			heading="Could not connect repository"
			detail={failure.detail}
			remedy={failure.remedy}
			technical={failure.technical}
			testId="repository-connect-error-state"
		>
			{#snippet icon()}
				<Icon name="alert" size={14} />
			{/snippet}
		</StateBlock>
	</div>
{/snippet}

{#if cloneDialogOpen}
	<CloneRepositoryDialog onclose={() => (cloneDialogOpen = false)} />
{/if}

<svelte:head>
	<title>Malini · Repositories</title>
</svelte:head>

<div
	class="text-fg-default h-full w-full flex-1 overflow-y-auto"
	data-testid="repository-list-page"
	data-navigation-ready={workstreamScopeReady ? 'true' : undefined}
	data-navigation-error={workstreamScopeError ? 'true' : undefined}
	data-navigation-error-message={workstreamScopeError ?? undefined}
>
	{#if firstRun && onboarding.finished === false}
		<Onboarding />
	{:else if !(firstRun && onboarding.finished === null)}
		<div class="mx-auto flex w-full max-w-[640px] flex-col px-6 pt-20 pb-32">
			<header>
				<h1 class="text-fg-default text-xl font-semibold tracking-tight">Repositories</h1>
			</header>

			{#if claudeNeedsSetup || githubSignedOut}
				<div class="-mx-4 mt-6 flex flex-col gap-3">
					{#if claudeNeedsSetup}
						<ClaudeCodeSetup />
					{/if}
					{#if githubSignedOut}
						<GitHubSetup />
					{/if}
				</div>
			{/if}

			{#if !firstRun}
				<div class="mt-6 flex h-7 items-center gap-2">
					{#if workstreamScopeReady && !workstreamScopeFailure && repositories.length > 0}
						<TextInput
							bind:value={query}
							type="search"
							size="xs"
							ariaLabel="Search repositories"
							placeholder={searchPlaceholder}
							autocomplete="off"
							class="min-w-0 flex-1"
							inputClass="text-xs [&::-webkit-search-cancel-button]:hidden"
							data-testid="repository-search"
						>
							{#snippet icon()}
								<Icon name="search" size={14} />
							{/snippet}
						</TextInput>
					{/if}
					<div class="ml-auto flex shrink-0 items-center gap-2">
						{@render cloneButton('md')}
						<Button
							variant="primary"
							size="md"
							disabled={connecting !== null}
							ariaBusy={connecting === 'folder'}
							ariaLabel="Open a local repository folder"
							data-testid="repository-open-folder"
							onclick={openRepositoryFolderCommand}
						>
							{#snippet leading()}
								<Icon name="folder-plus" size={16} />
							{/snippet}
							Open folder
						</Button>
					</div>
				</div>
			{/if}

			{#if workstreamScopeFailure}
				<div
					class="border-border-subtle -mx-4 mt-3 flex items-center justify-center rounded-2xl border border-dashed"
				>
					<StateBlock
						live="alert"
						tone={workstreamScopeFailure.tone}
						heading={workstreamScopeFailure.heading}
						detail={workstreamScopeFailure.detail}
						remedy={workstreamScopeFailure.remedy}
						technical={workstreamScopeFailure.technical}
						testId="repositories-scope-error"
					>
						{#snippet icon()}
							<Icon name="plug" size={22} />
						{/snippet}
						{#snippet action()}
							<Button
								variant="secondary"
								size="md"
								disabled={retryingScope}
								ariaBusy={retryingScope}
								ariaLabel="Retry loading repositories"
								data-testid="repositories-scope-retry"
								onclick={retryRepositoriesScopeCommand}
							>
								{#snippet leading()}
									<Icon name="refresh" size={16} />
								{/snippet}
								{retryingScope ? 'Retrying…' : 'Retry'}
							</Button>
						{/snippet}
					</StateBlock>
				</div>
			{:else if !workstreamScopeReady}
				<section
					class="-mx-4 mt-3"
					data-testid="repository-cold-shell"
					data-navigation-cold-shell="true"
					aria-label="Repositories unavailable until their local scope is verified"
				>
					<RepositoryListSkeleton />
				</section>
			{:else}
				<section class={firstRun ? 'mt-6' : 'mt-3'} aria-label="Repositories">
					{#if connectError}
						{@render connectErrorBlock(connectError)}
					{/if}

					{#if filteredRepositories.length === 0 && (hiddenRepositories.length === 0 || allHidden)}
						<div
							class="border-border-subtle -mx-4 flex items-center justify-center rounded-2xl border border-dashed"
							data-testid="repositories-empty-state"
						>
							<StateBlock
								heading={query.trim().length > 0
									? 'No matching repositories'
									: allHidden
										? 'Every repository is hidden'
										: 'No repositories yet'}
								detail={query.trim().length > 0
									? `Nothing connected matches “${query.trim()}”.`
									: allHidden
										? 'Hidden repositories keep their workstreams.'
										: 'A repository is a folder on this Mac, or a URL git can clone.'}
								remedy={query.trim().length > 0
									? 'Clear the search, or connect the repository first.'
									: allHidden
										? 'Unhide one below, or open another folder.'
										: 'Open a folder or clone a repository to start a workstream.'}
								testId="repositories-empty-block"
							>
								{#snippet icon()}
									{#if query.trim().length > 0}
										<Icon name="search" size={20} />
									{:else}
										<Icon name="folder-plus" size={20} />
									{/if}
								{/snippet}
								{#snippet action()}
									{#if query.trim().length > 0}
										<Button
											variant="secondary"
											size="md"
											ariaLabel="Clear repository search"
											onclick={() => (query = '')}
										>
											Clear search
										</Button>
									{:else}
										{#if firstRun}
											{@render cloneButton('md')}
										{/if}
										<Button
											variant="primary"
											size="md"
											disabled={connecting !== null}
											ariaBusy={connecting === 'folder'}
											ariaLabel="Open a local repository folder"
											data-testid="repository-open-folder-empty"
											onclick={openRepositoryFolderCommand}
										>
											{#snippet leading()}
												<Icon name="folder-plus" size={16} />
											{/snippet}
											Open folder
										</Button>
									{/if}
								{/snippet}
							</StateBlock>
						</div>
					{:else if filteredRepositories.length > 0}
						<ul
							class="border-surface-50-border bg-surface-50 divide-surface-50-border -mx-4 divide-y-[0.5px] overflow-hidden rounded-2xl border-[0.5px]"
							data-testid="repository-list"
						>
							{#each filteredRepositories as repo (repo.id)}
								{@const streams = workstreamsFor(repo)}
								{@const webUrl = repositoryWebUrl(repo.remoteUrl)}
								<li
									data-testid="repository-row"
									data-repository-id={repo.id}
									data-full-name={repo.fullName}
									data-default-branch={repo.defaultBranch}
									class="group/row flex items-center gap-3 px-4 py-3"
								>
									<RepositoryAvatar fullName={repo.fullName} size={28} />
									<div class="min-w-0 flex-1">
										<Tooltip
											content={repo.fullName}
											placement="top"
											onlyWhenTruncated
											class="min-w-0"
										>
											<span class="text-fg-default block truncate text-sm font-medium">
												{repo.fullName}
											</span>
										</Tooltip>
										<p class="text-fg-tertiary truncate text-xs">
											<SensitiveText text={repositoryDetail(repo, streams)} />
										</p>
									</div>
									{#if webUrl}
										<Tooltip content="Open on GitHub" placement="top">
											<IconButton
												variant="ghost"
												size="sm"
												class={REVEAL_ON_ROW_HOVER}
												ariaLabel={`Open ${repo.fullName} on GitHub`}
												href={webUrl}
											>
												<GitHubIcon size={14} />
											</IconButton>
										</Tooltip>
									{/if}
									<Tooltip content={`Hide ${repo.fullName}`} placement="top">
										<IconButton
											variant="ghost"
											size="sm"
											class={REVEAL_ON_ROW_HOVER}
											ariaLabel={`Hide ${repo.fullName}`}
											data-testid="repository-hide-button"
											onclick={() => setRepositoryHiddenCommand(repo, true)}
										>
											<Icon name="eye-off" size={14} />
										</IconButton>
									</Tooltip>
									<RemoveRepositoryButton
										repository={repo}
										workstreams={streams}
										onremove={removeRepositoryCommand}
										placement="top"
										restingClass={REVEAL_ON_ROW_HOVER}
										testId="repository-remove-button"
									/>
									<Button
										variant="secondary"
										size="sm"
										ariaLabel={`Open ${repo.fullName}`}
										href={repositoryHref(repo.id)}
										data-testid="repository-open-button"
										data-navigation-target={repositoryHref(repo.id)}
										data-navigation-path-id="expected-path:repository.open-scratchpad"
									>
										Open
										{#snippet trailing()}
											<Icon name="arrow-right" size={14} />
										{/snippet}
									</Button>
								</li>
							{/each}
						</ul>
					{/if}

					{#if hiddenRepositories.length > 0}
						<details
							class={['group/hidden', filteredRepositories.length > 0 && 'mt-6']}
							bind:open={() => hiddenOpen || query.trim().length > 0, (open) => (hiddenOpen = open)}
							data-testid="hidden-repositories"
						>
							<summary
								class="text-fg-tertiary hover:text-fg-secondary focus-visible:ring-border-default/50 -ml-1 flex h-7 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
							>
								<Icon
									name="chevron-right"
									size={13}
									class="transition-transform duration-100 group-open/hidden:rotate-90"
								/>
								Hidden ({hiddenRepositories.length})
							</summary>
							<ul
								class="border-surface-50-border bg-surface-50 divide-surface-50-border -mx-4 mt-2 divide-y-[0.5px] overflow-hidden rounded-2xl border-[0.5px]"
								aria-label="Hidden repositories"
								data-testid="hidden-repository-list"
							>
								{#each hiddenRepositories as repo (repo.id)}
									{@const streams = workstreamsFor(repo)}
									<li
										data-testid="hidden-repository-row"
										data-repository-id={repo.id}
										data-full-name={repo.fullName}
										class="flex items-center gap-3 px-4 py-3"
									>
										<span class="opacity-60">
											<RepositoryAvatar fullName={repo.fullName} size={28} />
										</span>
										<div class="min-w-0 flex-1">
											<Tooltip
												content={repo.fullName}
												placement="top"
												onlyWhenTruncated
												class="min-w-0"
											>
												<span class="text-fg-secondary block truncate text-sm font-medium">
													{repo.fullName}
												</span>
											</Tooltip>
											<p class="text-fg-tertiary truncate text-xs">
												<SensitiveText text={repositoryDetail(repo, streams)} />
											</p>
										</div>
										<RemoveRepositoryButton
											repository={repo}
											workstreams={streams}
											onremove={removeRepositoryCommand}
											placement="top"
											testId="repository-remove-button"
										/>
										<Button
											variant="secondary"
											size="sm"
											ariaLabel={`Unhide ${repo.fullName}`}
											data-testid="repository-unhide-button"
											onclick={() => setRepositoryHiddenCommand(repo, false)}
										>
											{#snippet leading()}
												<Icon name="eye" size={14} />
											{/snippet}
											Unhide
										</Button>
									</li>
								{/each}
							</ul>
						</details>
					{/if}
				</section>
			{/if}
		</div>
	{/if}
</div>
