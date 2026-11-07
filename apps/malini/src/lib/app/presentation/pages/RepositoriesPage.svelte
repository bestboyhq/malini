<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { repositoryHref } from '$shared/router/routes-hrefs';
	import { onMount } from 'svelte';
	import { GitHubIcon, Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import {
		activeWorkstreamsQuery,
		answerRepositoryFolderRequestCommand,
		clearRepositoryConnectErrorCommand,
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
		repositoryFolderRequestedQuery,
		retryRepositoriesScopeCommand,
		setRepositoryHiddenCommand,
		workstreamCount,
		workstreamsForRepository,
		RepositoryAvatar,
		RepositoryListSkeleton,
		repositoryName,
		repositoryOwner,
		repositoryWebUrl,
		type Repository,
		type Workstream,
	} from '$shared/repositories/repositories.api';
	import { ClaudeCodeSetup, claudeCodeStatusQuery } from '$shared/providers/providers.api';
	import { loadOnboardingCommand } from '$lib/app/application/commands/load-onboarding.command';
	import { openCommandCenterCommand } from '$lib/app/application/commands/open-command-center.command';
	import { toggleGroupCollapsedCommand } from '$lib/app/application/commands/toggle-group-collapsed.command';
	import { collapsedGroupsQuery } from '$lib/app/application/queries/collapsed-groups.query.svelte';
	import { repositoryGroups, type OwnerGroup } from '$lib/app/domain/repository-groups';
	import { onboardingQuery } from '$lib/app/application/queries/onboarding.query.svelte';
	import FirstRepositoryPicker from '../FirstRepositoryPicker.svelte';
	import Onboarding from '../onboarding/Onboarding.svelte';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { describeFailure } from '$shared/errors/failure-copy';

	const REVEAL_ON_ROW_HOVER =
		'pointer-events-none opacity-0 transition-none group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-has-focus-visible/row:pointer-events-auto group-has-focus-visible/row:opacity-100';
	const HIDE_ON_ROW_HOVER =
		'group-hover/row:opacity-0 group-has-focus-visible/row:opacity-0 group-has-[[data-armed]]/row:opacity-0';
	const ROW =
		'group/row hover:bg-surface-100-hover has-focus-visible:bg-surface-100-hover relative flex h-8 items-center gap-3 rounded-lg px-2.5';
	const TRAY =
		'border-surface-50-border bg-surface-50 text-fg-secondary flex h-7 w-full items-center gap-2 px-3 text-xs outline-none';
	const TRAY_OPEN = 'rounded-t-xl border-x-[0.5px] border-t-[0.5px]';
	const TRAY_CLOSED = 'rounded-xl border-[0.5px]';
	const TRAY_INTERACTIVE =
		'hover:bg-surface-50-hover hover:text-fg-default focus-visible:bg-surface-50-hover focus-visible:text-fg-default cursor-pointer';

	let query = $state('');
	let hiddenOpen = $state(false);

	const workstreams = $derived(activeWorkstreamsQuery.data);
	const repositories = $derived(connectedRepositoriesQuery.data);
	const workstreamScopeReady = $derived(repositoriesScopeReadyQuery.data);
	const workstreamScopeError = $derived(repositoriesScopeErrorQuery.data);
	const retryingScope = $derived(repositoriesScopeRetryingQuery.data);
	const githubAuth = $derived(githubAuthQuery.data);
	const connecting = $derived(repositoryConnectingQuery.data);
	const connectError = $derived(repositoryConnectErrorQuery.data);
	const folderRequested = $derived(repositoryFolderRequestedQuery.data);
	const claudeStatus = $derived(claudeCodeStatusQuery.data);
	const claudeNeedsSetup = $derived(
		claudeStatus.kind === 'missing' || claudeStatus.kind === 'unknown',
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
	const searching = $derived(query.trim().length > 0);
	const hiddenShown = $derived(hiddenOpen || searching);
	const collapsedGroupIds = $derived(collapsedGroupsQuery.data);
	const groups = $derived(repositoryGroups(filteredRepositories, (repo) => repo));
	const ownerGroups = $derived(
		groups.filter((group): group is OwnerGroup<Repository> => group.kind === 'owner'),
	);
	const loneRepositories = $derived(
		groups.flatMap((group) => (group.kind === 'repository' ? [group.item] : [])),
	);
	const onboarding = $derived(onboardingQuery.data);
	const firstRun = $derived(
		workstreamScopeReady && !workstreamScopeError && repositories.length === 0,
	);
	let picking = $state(false);

	onMount(() => {
		loadOnboardingCommand();
		clearRepositoryConnectErrorCommand();
		loadGithubAuthCommand();
	});

	$effect(() => {
		if (folderRequested)
			answerRepositoryFolderRequestCommand({ open: picking ? 'workstream' : 'repository' });
	});

	$effect.pre(() => {
		if (firstRun && onboarding.finished) picking = true;
	});

	function workstreamsFor(repo: Repository): Workstream[] {
		return workstreamsForRepository(repo, workstreams);
	}

	function homeRelative(path: string): string {
		return path.replace(/^\/Users\/[^/]+/u, '~');
	}

	function repositoryCountLabel(count: number): string {
		return `${count} ${count === 1 ? 'repository' : 'repositories'}`;
	}
</script>

{#snippet repositoryLabel(repo: Repository, owner: string | null, nameClass: string)}
	{#if owner}
		<span class="sr-only">{repo.fullName}</span>
	{/if}
	<Tooltip
		content={repo.fullName}
		placement="top"
		onlyWhenTruncated
		class="relative max-w-[60%] min-w-0 shrink-0"
	>
		<span class="flex min-w-0 text-sm" aria-hidden={owner ? 'true' : undefined}>
			{#if owner}
				<span class="text-fg-tertiary shrink-0">{owner}/</span>
			{/if}
			<span class={['truncate', nameClass]}>{repositoryName(repo.fullName)}</span>
		</span>
	</Tooltip>
{/snippet}

{#snippet repositoryRow(repo: Repository, owner: string | null)}
	{@const streams = workstreamsFor(repo)}
	{@const webUrl = repositoryWebUrl(repo.remoteUrl)}
	<li
		data-testid="repository-row"
		data-repository-id={repo.id}
		data-full-name={repo.fullName}
		data-default-branch={repo.defaultBranch}
		class={ROW}
	>
		<a
			href={repositoryHref(repo.id)}
			aria-label={`Open ${repo.fullName}`}
			class="flex min-w-0 flex-1 items-center gap-3 outline-none before:absolute before:inset-0 before:rounded-lg before:content-['']"
			draggable="false"
		>
			<RepositoryAvatar fullName={repo.fullName} size={16} />
			<span class="flex min-w-0 flex-1 items-baseline gap-2.5">
				{@render repositoryLabel(repo, owner, 'text-fg-default')}
				{#if repo.localPath}
					<span class="text-fg-tertiary min-w-0 truncate text-xs">
						<SensitiveText text={homeRelative(repo.localPath)} />
					</span>
				{/if}
			</span>
		</a>
		<span class="grid shrink-0 items-center justify-items-end">
			{#if streams.length > 0}
				<span class={['text-fg-tertiary text-xs tabular-nums [grid-area:1/1]', HIDE_ON_ROW_HOVER]}>
					{workstreamCount(streams.length)}
				</span>
			{/if}
			<span class="relative z-10 -mr-1.5 flex items-center gap-0.5 [grid-area:1/1]">
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
			</span>
		</span>
	</li>
{/snippet}

{#snippet openFolderButton()}
	<Button
		variant="primary"
		size="md"
		disabled={connecting === 'clone'}
		loading={connecting === 'folder'}
		ariaLabel="Open a local repository folder"
		data-testid="repository-open-folder-empty"
		onclick={() => openRepositoryFolderCommand()}
	>
		{#snippet leading()}
			<Icon name="folder-open" size={16} />
		{/snippet}
		{connecting === 'folder' ? 'Opening…' : 'Open folder'}
	</Button>
{/snippet}

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
	{:else if picking}
		<FirstRepositoryPicker />
	{:else if !firstRun}
		<div class="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-6 pt-10 pb-32">
			<h1 class="sr-only">Repositories</h1>

			{#if claudeNeedsSetup}
				<ClaudeCodeSetup nested />
			{/if}
			{#if githubSignedOut}
				<GitHubSetup nested />
			{/if}

			<ComposerShell>
				<div class="flex h-10 items-center gap-3 pr-1.5 pl-3.5">
					<label class="flex min-w-0 flex-1 items-center gap-3 self-stretch">
						<Icon name="search" size={16} class="text-fg-tertiary shrink-0" />
						<TextInput
							bind:value={query}
							bare
							type="search"
							ariaLabel="Search repositories"
							placeholder={`Search ${repositoryCountLabel(repositories.length)}`}
							autocomplete="off"
							disabled={!workstreamScopeReady || workstreamScopeFailure !== null}
							class="min-w-0 flex-1"
							inputClass="text-sm [&::-webkit-search-cancel-button]:hidden"
							data-testid="repository-search"
						/>
					</label>
					<span class="flex shrink-0 items-center gap-0.5">
						<Tooltip content="Find a repository ⌘K" placement="top">
							<Button
								variant="ghost"
								size="md"
								iconOnly
								disabled={connecting === 'folder'}
								loading={connecting === 'clone'}
								ariaLabel="Find a repository"
								ariaHasPopup="dialog"
								ariaKeyshortcuts="Meta+K"
								data-testid="repository-clone-open"
								onclick={() => openCommandCenterCommand('find')}
							>
								{#snippet leading()}
									<GitHubIcon size={14} />
								{/snippet}
							</Button>
						</Tooltip>
						<Tooltip content="Open a folder ⌘O" placement="top">
							<Button
								variant="ghost"
								size="md"
								iconOnly
								disabled={connecting === 'clone'}
								loading={connecting === 'folder'}
								ariaLabel="Open a local repository folder"
								ariaKeyshortcuts="Meta+O"
								data-testid="repository-open-folder"
								onclick={() => openRepositoryFolderCommand()}
							>
								{#snippet leading()}
									<Icon name="folder-open" size={16} />
								{/snippet}
							</Button>
						</Tooltip>
						{#if !githubSignedOut}
							<Tooltip content="New repository" placement="top">
								<IconButton
									variant="ghost"
									size="md"
									ariaLabel="New repository"
									ariaHasPopup="dialog"
									onclick={() => openCommandCenterCommand('new-repository')}
								>
									<Icon name="plus" size={16} />
								</IconButton>
							</Tooltip>
						{/if}
					</span>
				</div>
			</ComposerShell>

			{#if workstreamScopeFailure}
				<ComposerShell class="flex items-center justify-center">
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
				</ComposerShell>
			{:else if !workstreamScopeReady}
				<section
					data-testid="repository-cold-shell"
					data-navigation-cold-shell="true"
					aria-label="Repositories unavailable until their local scope is verified"
				>
					<RepositoryListSkeleton />
				</section>
			{:else}
				<section class="flex flex-col gap-5" aria-label="Repositories">
					{#if connectError}
						<ComposerShell class="px-2" testId="repository-connect-error">
							<StateBlock
								layout="inline"
								live="alert"
								tone="critical"
								heading="Could not connect repository"
								detail={connectError.detail}
								remedy={connectError.remedy}
								technical={connectError.technical}
								testId="repository-connect-error-state"
							>
								{#snippet icon()}
									<Icon name="alert" size={14} />
								{/snippet}
							</StateBlock>
						</ComposerShell>
					{/if}

					{#if filteredRepositories.length === 0 && (hiddenRepositories.length === 0 || allHidden)}
						<ComposerShell
							class="flex items-center justify-center"
							testId="repositories-empty-state"
						>
							<StateBlock
								heading={searching ? 'No matching repositories' : 'Every repository is hidden'}
								detail={searching
									? `Nothing connected matches “${query.trim()}”.`
									: 'Hidden repositories keep their workstreams.'}
								remedy={searching
									? 'Clear the search, or connect the repository first.'
									: 'Unhide one below, or open another folder.'}
								testId="repositories-empty-block"
							>
								{#snippet icon()}
									<Icon name={searching ? 'search' : 'folder-open'} size={20} />
								{/snippet}
								{#snippet action()}
									{#if searching}
										<Button
											variant="secondary"
											size="md"
											ariaLabel="Clear repository search"
											onclick={() => (query = '')}
										>
											Clear search
										</Button>
									{:else}
										{@render openFolderButton()}
									{/if}
								{/snippet}
							</StateBlock>
						</ComposerShell>
					{:else if filteredRepositories.length > 0}
						<div class="flex flex-col gap-5" data-testid="repository-list">
							{#each ownerGroups as group (group.id)}
								{@const open = searching || !collapsedGroupIds.has(group.id)}
								{@const first = group.items[0]}
								<div>
									<div class="px-[15px]">
										<Button
											bare
											class={[TRAY, open ? TRAY_OPEN : TRAY_CLOSED, !searching && TRAY_INTERACTIVE]}
											disabled={searching}
											ariaLabel={`${group.owner}, ${repositoryCountLabel(group.items.length)}`}
											ariaExpanded={open}
											ariaControls={`owner-list-${group.id}`}
											onclick={() => toggleGroupCollapsedCommand(group.id)}
										>
											{#if first}
												<RepositoryAvatar fullName={first.fullName} size={14} />
											{/if}
											<span class="font-medium">{group.owner}</span>
											<span class="text-fg-tertiary">
												{repositoryCountLabel(group.items.length)}
											</span>
											<Icon
												name="chevron-down"
												size={12}
												class={`text-fg-tertiary ml-auto transition-transform duration-100 ${open ? '' : '-rotate-90'}`}
											/>
										</Button>
									</div>
									<ComposerShell class={[!open && 'hidden']}>
										<ul id={`owner-list-${group.id}`} class="flex flex-col p-1">
											{#each group.items as repo (repo.id)}
												{@render repositoryRow(repo, null)}
											{/each}
										</ul>
									</ComposerShell>
								</div>
							{/each}
							{#if loneRepositories.length > 0}
								<ComposerShell>
									<ul class="flex flex-col p-1">
										{#each loneRepositories as repo (repo.id)}
											{@render repositoryRow(repo, repositoryOwner(repo.fullName))}
										{/each}
									</ul>
								</ComposerShell>
							{/if}
						</div>
					{/if}

					{#if hiddenRepositories.length > 0}
						<div>
							<div class="px-[15px]">
								<Button
									bare
									class={[
										TRAY,
										hiddenShown ? TRAY_OPEN : TRAY_CLOSED,
										!searching && TRAY_INTERACTIVE,
									]}
									disabled={searching}
									ariaLabel={`Hidden, ${repositoryCountLabel(hiddenRepositories.length)}`}
									ariaExpanded={hiddenShown}
									ariaControls="hidden-repository-list"
									onclick={() => (hiddenOpen = !hiddenOpen)}
								>
									<span class="text-fg-tertiary grid w-3.5 place-items-center">
										<Icon name="eye-off" size={13} />
									</span>
									<span class="font-medium">Hidden</span>
									<span class="text-fg-tertiary tabular-nums">{hiddenRepositories.length}</span>
									<Icon
										name="chevron-down"
										size={12}
										class={`text-fg-tertiary ml-auto transition-transform duration-100 ${hiddenShown ? '' : '-rotate-90'}`}
									/>
								</Button>
							</div>
							<ComposerShell class={[!hiddenShown && 'hidden']}>
								<ul
									id="hidden-repository-list"
									class="flex flex-col p-1"
									aria-label="Hidden repositories"
									data-testid="hidden-repository-list"
								>
									{#each hiddenRepositories as repo (repo.id)}
										<li
											data-testid="hidden-repository-row"
											data-repository-id={repo.id}
											data-full-name={repo.fullName}
											class={ROW}
										>
											<span class="opacity-60">
												<RepositoryAvatar fullName={repo.fullName} size={16} />
											</span>
											<span class="flex min-w-0 flex-1">
												{@render repositoryLabel(
													repo,
													repositoryOwner(repo.fullName),
													'text-fg-secondary',
												)}
											</span>
											<span class="-mr-1.5 flex shrink-0 items-center gap-0.5">
												<RemoveRepositoryButton
													repository={repo}
													workstreams={workstreamsFor(repo)}
													onremove={removeRepositoryCommand}
													placement="top"
													restingClass={REVEAL_ON_ROW_HOVER}
													testId="repository-remove-button"
												/>
												<Button
													variant="ghost"
													size="sm"
													class={REVEAL_ON_ROW_HOVER}
													ariaLabel={`Unhide ${repo.fullName}`}
													data-testid="repository-unhide-button"
													onclick={() => setRepositoryHiddenCommand(repo, false)}
												>
													{#snippet leading()}
														<Icon name="eye" size={14} />
													{/snippet}
													Unhide
												</Button>
											</span>
										</li>
									{/each}
								</ul>
							</ComposerShell>
						</div>
					{/if}
				</section>
			{/if}
		</div>
	{/if}
</div>
