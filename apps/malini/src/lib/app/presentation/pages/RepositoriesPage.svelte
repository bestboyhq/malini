<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import { goto } from '$shared/router/navigation';
	import { onMount } from 'svelte';
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import {
		activeWorkstreamsQuery,
		clearRepositoryConnectErrorCommand,
		connectRepositoryCommand,
		connectedRepositoriesQuery,
		createWorkstreamForRepositoryCommand,
		githubAuthQuery,
		isCloneUrl,
		loadGithubAuthCommand,
		openRepositoryFolderCommand,
		repositoriesScopeErrorQuery,
		repositoriesScopeReadyQuery,
		repositoriesScopeRetryingQuery,
		repositoryConnectErrorQuery,
		repositoryConnectingQuery,
		retryRepositoriesScopeCommand,
		workstreamsForRepository,
		RepositoryAvatar,
		RepositoryListSkeleton,
		type Repository,
		type Workstream,
	} from '$shared/repositories/repositories.api';
	import { ClaudeCodeSetup, claudeCodeStatusQuery } from '$shared/providers/providers.api';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { describeFailure } from '$shared/errors/failure-copy';

	let query = $state('');
	let cloneUrl = $state('');
	let cloneFormOpen = $state(false);

	const workstreams = $derived(activeWorkstreamsQuery.data);
	const repositories = $derived(connectedRepositoriesQuery.data);
	const workstreamScopeReady = $derived(repositoriesScopeReadyQuery.data);
	const workstreamScopeError = $derived(repositoriesScopeErrorQuery.data);
	const retryingScope = $derived(repositoriesScopeRetryingQuery.data);
	const githubAuth = $derived(githubAuthQuery.data);
	const connecting = $derived(repositoryConnectingQuery.data);
	const connectError = $derived(repositoryConnectErrorQuery.data);
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
	const githubHint = $derived.by(() => {
		if (!githubAuth || githubAuth.authenticated) return null;
		if (!githubAuth.installed) {
			return 'The GitHub CLI (gh) is not installed, so pull requests are off. Install it and run `gh auth login`.';
		}
		return (
			githubAuth.message ??
			'The GitHub CLI is not signed in, so pull requests are off. Run `gh auth login` in a terminal.'
		);
	});
	const filteredRepositories = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (needle.length === 0) return repositories;
		return repositories.filter((repo) => repo.fullName.toLowerCase().includes(needle));
	});
	const cloneUrlValid = $derived(isCloneUrl(cloneUrl));
	const firstRun = $derived(
		workstreamScopeReady && !workstreamScopeError && repositories.length === 0,
	);
	const searchPlaceholder = $derived(
		`Search ${repositories.length} ${repositories.length === 1 ? 'repository' : 'repositories'}`,
	);

	onMount(() => {
		clearRepositoryConnectErrorCommand();
		loadGithubAuthCommand();
	});

	function workstreamsFor(repo: Repository): Workstream[] {
		return workstreamsForRepository(repo, workstreams);
	}

	function firstWorkstreamHref(repo: Repository): string | undefined {
		const first = workstreamsFor(repo)[0];
		return first ? workstreamHref(first.id) : undefined;
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

	function cloneFromUrl(): void {
		const url = cloneUrl.trim();
		if (!cloneUrlValid) return;
		connectRepositoryCommand({ kind: 'clone-url', url }, () => {
			cloneUrl = '';
			cloneFormOpen = false;
		});
	}

	function openRepository(repo: Repository): void {
		const existing = firstWorkstreamHref(repo);
		if (existing) {
			void goto(existing);
			return;
		}
		createWorkstreamForRepositoryCommand(repo);
	}
</script>

{#snippet cloneForm()}
	<form
		class="mt-6 flex gap-2"
		data-testid="repository-clone-form"
		onsubmit={(event) => {
			event.preventDefault();
			cloneFromUrl();
		}}
	>
		<TextInput
			bind:value={cloneUrl}
			type="text"
			size="xs"
			ariaLabel="Clone URL"
			placeholder="https://github.com/owner/repo.git"
			autocomplete="off"
			class="min-w-0 flex-1"
			data-testid="repository-clone-url-input"
		>
			{#snippet icon()}
				<Icon name="link" size={14} />
			{/snippet}
		</TextInput>
		<Button
			type="submit"
			variant="primary"
			size="md"
			disabled={!cloneUrlValid || connecting !== null}
			ariaBusy={connecting === 'clone'}
			ariaLabel="Clone this repository and open a workstream"
			data-testid="repository-clone-submit"
		>
			{connecting === 'clone' ? 'Cloning…' : 'Clone'}
			{#snippet trailing()}
				<Icon name="arrow-right" size={16} />
			{/snippet}
		</Button>
	</form>
{/snippet}

{#snippet connectErrorBlock(failure: NonNullable<typeof connectError>)}
	<div
		class="border-surface-50-border bg-surface-50 mb-3 rounded-2xl border-[0.5px] px-2"
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

<svelte:head>
	<title>malini · Repositories</title>
</svelte:head>

<div
	class="text-fg-default h-full w-full flex-1 overflow-y-auto"
	data-testid="repository-list-page"
	data-navigation-ready={workstreamScopeReady ? 'true' : undefined}
	data-navigation-error={workstreamScopeError ? 'true' : undefined}
	data-navigation-error-message={workstreamScopeError ?? undefined}
>
	<div class="mx-auto flex w-full max-w-[640px] flex-col px-6 pt-20 pb-16">
		{#if firstRun}
			<header data-testid="first-run-setup">
				<h1 class="text-fg-default text-xl font-semibold tracking-tight">Set up malini</h1>
				<p class="text-fg-tertiary mt-1 text-sm">
					Two steps. Then every workstream gets its own git worktree and its own Claude Code.
				</p>
			</header>
			<ol class="mt-8 flex flex-col gap-3" aria-label="Setup steps">
				<li>
					<ClaudeCodeSetup step={1} />
				</li>
				<li
					class="border-surface-50-border bg-surface-50 rounded-2xl border-[0.5px] px-4 py-3.5"
					data-testid="repository-setup-step"
				>
					<div class="flex items-center gap-3">
						<div
							class="bg-surface-150 text-fg-secondary grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-medium tabular-nums"
							aria-hidden="true"
						>
							2
						</div>
						<div class="min-w-0 flex-1">
							<h3 class="text-fg-default text-sm font-medium">Add a repository</h3>
							<p class="text-fg-tertiary text-xs leading-5">
								A folder on this Mac, or a URL git can clone.
							</p>
						</div>
						<Button
							variant="secondary"
							size="sm"
							active={cloneFormOpen}
							disabled={connecting !== null}
							ariaLabel={cloneFormOpen ? 'Hide the clone form' : 'Clone a repository from a URL'}
							data-testid="repository-clone-toggle"
							onclick={() => (cloneFormOpen = !cloneFormOpen)}
						>
							Clone URL
						</Button>
						<Button
							variant="primary"
							size="sm"
							disabled={connecting !== null}
							ariaBusy={connecting === 'folder'}
							ariaLabel="Open a local repository folder"
							data-testid="repository-open-folder"
							onclick={openRepositoryFolderCommand}
						>
							Open folder
						</Button>
					</div>
					{#if cloneFormOpen}
						{@render cloneForm()}
					{/if}
				</li>
			</ol>
			{#if connectError}
				<div class="mt-3">
					{@render connectErrorBlock(connectError)}
				</div>
			{/if}
		{:else}
			<header class="flex items-center justify-between gap-3">
				<h1 class="text-fg-default text-xl font-semibold tracking-tight">Repositories</h1>
				<div class="flex items-center gap-2">
					<Button
						variant="secondary"
						size="sm"
						active={cloneFormOpen}
						disabled={connecting !== null}
						ariaLabel={cloneFormOpen ? 'Hide the clone form' : 'Clone a repository from a URL'}
						data-testid="repository-clone-toggle"
						onclick={() => (cloneFormOpen = !cloneFormOpen)}
					>
						{#snippet leading()}
							<Icon name="link" size={14} />
						{/snippet}
						Clone URL
					</Button>
					<Button
						variant="primary"
						size="sm"
						disabled={connecting !== null}
						ariaBusy={connecting === 'folder'}
						ariaLabel="Open a local repository folder"
						data-testid="repository-open-folder"
						onclick={openRepositoryFolderCommand}
					>
						{#snippet leading()}
							<Icon name="folder-plus" size={14} />
						{/snippet}
						Open folder
					</Button>
				</div>
			</header>

			{#if cloneFormOpen}
				{@render cloneForm()}
			{/if}

			{#if claudeNeedsSetup}
				<div class="mt-6">
					<ClaudeCodeSetup />
				</div>
			{/if}

			{#if githubSignedOut && githubHint}
				<div
					class="border-surface-50-border bg-surface-50 mt-6 rounded-2xl border-[0.5px] px-2"
					data-testid="github-auth-hint"
				>
					<StateBlock
						layout="inline"
						tone="caution"
						heading="GitHub CLI is not signed in"
						detail={githubHint}
						remedy="Pull requests come back the moment `gh auth status` succeeds."
						testId="github-auth-hint-block"
					>
						{#snippet icon()}
							<Icon name="alert" size={14} />
						{/snippet}
						{#snippet action()}
							<Button
								variant="secondary"
								size="sm"
								ariaLabel="Check GitHub CLI sign-in again"
								onclick={loadGithubAuthCommand}
							>
								{#snippet leading()}
									<Icon name="refresh" size={14} />
								{/snippet}
								Check again
							</Button>
						{/snippet}
					</StateBlock>
				</div>
			{/if}

			{#if workstreamScopeFailure}
				<div
					class="border-border-subtle mt-8 flex items-center justify-center rounded-2xl border border-dashed"
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
					class="mt-8"
					data-testid="repository-cold-shell"
					data-navigation-cold-shell="true"
					aria-label="Repositories unavailable until their local scope is verified"
				>
					<div class="mb-2 h-7"></div>
					<RepositoryListSkeleton />
				</section>
			{:else}
				<section class="mt-8" aria-label="Repositories">
					{#if repositories.length > 0}
						<div class="mb-2 flex h-7 items-center">
							<TextInput
								bind:value={query}
								type="search"
								size="xs"
								ariaLabel="Search repositories"
								placeholder={searchPlaceholder}
								autocomplete="off"
								class="w-64"
								inputClass="text-xs [&::-webkit-search-cancel-button]:hidden"
								data-testid="repository-search"
							>
								{#snippet icon()}
									<Icon name="search" size={14} />
								{/snippet}
							</TextInput>
						</div>
					{/if}

					{#if connectError}
						{@render connectErrorBlock(connectError)}
					{/if}

					{#if filteredRepositories.length === 0}
						<div
							class="border-border-subtle flex items-center justify-center rounded-2xl border border-dashed"
							data-testid="repositories-empty-state"
						>
							<StateBlock
								heading={query.trim().length > 0
									? 'No matching repositories'
									: 'No repositories yet'}
								detail={query.trim().length > 0
									? `Nothing connected matches “${query.trim()}”.`
									: 'A repository is a folder on this Mac, or a URL git can clone.'}
								remedy={query.trim().length > 0
									? 'Clear the search, or connect the repository first.'
									: 'Open a folder to start a workstream in it.'}
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
										<Button
											variant="primary"
											size="md"
											disabled={connecting !== null}
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
					{:else}
						<ul
							class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] overflow-hidden rounded-2xl border-[0.5px]"
							data-testid="repository-list"
						>
							{#each filteredRepositories as repo (repo.id)}
								{@const streams = workstreamsFor(repo)}
								{@const target = firstWorkstreamHref(repo)}
								<li
									data-testid="repository-row"
									data-repository-id={repo.id}
									data-full-name={repo.fullName}
									data-default-branch={repo.defaultBranch}
									class="flex items-center gap-3 px-4 py-3"
								>
									<RepositoryAvatar fullName={repo.fullName} size={28} />
									<div class="min-w-0 flex-1">
										<Tooltip content={repo.fullName} placement="top" class="min-w-0">
											<span class="text-fg-default block truncate text-sm font-medium">
												{repo.fullName}
											</span>
										</Tooltip>
										<p class="text-fg-tertiary truncate text-xs">
											<SensitiveText text={repositoryDetail(repo, streams)} />
										</p>
									</div>
									<Button
										variant="secondary"
										size="sm"
										disabled={connecting !== null}
										ariaLabel={target
											? `Open ${repo.fullName}`
											: `Start a workstream in ${repo.fullName}`}
										data-testid="repository-open-button"
										data-navigation-target={target}
										data-navigation-dynamic-target={target ? undefined : 'true'}
										data-navigation-path-id="expected-path:repository.open-workstream"
										data-navigation-outcome-key={target ? 'selected' : 'created'}
										onclick={() => openRepository(repo)}
									>
										{target ? 'Open' : 'New workstream'}
										{#snippet trailing()}
											<Icon name="arrow-right" size={14} />
										{/snippet}
									</Button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</div>
