<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { UsageStepValue } from '$contract/system';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { DownloadProgress } from '$hyper-ui/components/download-progress';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { GitHubIcon, Icon } from '$hyper-ui/icons';
	import { motionOff } from '$hyper-ui/motion/motion-off';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import {
		GitHubDeviceCode,
		cancelGithubSignInCommand,
		connectedRepositoriesQuery,
		githubAuthErrorQuery,
		githubAuthQuery,
		githubCliInstallQuery,
		githubRepositoriesQuery,
		githubRepositoryState,
		githubSetupStatus,
		githubSignInQuery,
		installGithubCliCommand,
		loadGithubAuthCommand,
		loadGithubRepositoriesCommand,
		openRepositoryFolderCommand,
		pickGithubRepositoryCommand,
		repositoryConnectErrorQuery,
		repositoryConnectingKeyQuery,
		repositoryConnectingQuery,
		signInToGithubCommand,
		watchGithubAuthHook,
		type GithubRepository,
		type GithubRepositoryState,
	} from '$shared/repositories/repositories.api';
	import { countUsageStepCommand } from '$lib/app/application/commands/count-usage-step.command';
	import { loadUsageDataCommand } from '$lib/app/application/commands/load-usage-data.command';
	import { openCommandCenterCommand } from '$lib/app/application/commands/open-command-center.command';
	import { usageDataQuery } from '$lib/app/application/queries/usage-data.query.svelte';
	import { showOnboardingHook } from '$lib/app/application/hooks/show-onboarding.hook';
	import GithubRepositoryLabel from './GithubRepositoryLabel.svelte';

	type GithubView = 'loading' | 'code' | 'sign-in' | 'install-failed' | 'unknown' | 'list';

	const ROWS = 5;
	const CLOCK_MS = 30_000;
	const SKELETON_WIDTHS = ['38%', '30%', '44%', '26%', '34%'];
	const ROW =
		'hover:bg-surface-100-hover focus-visible:bg-surface-100-hover flex h-8 w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 text-left outline-none disabled:cursor-default disabled:hover:bg-transparent';
	const DOOR =
		'hover:bg-surface-100-hover focus-visible:bg-surface-100-hover text-fg-default flex h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left outline-none disabled:cursor-default disabled:hover:bg-transparent';
	const BADGE =
		'bg-surface-150 text-fg-secondary grid size-7 shrink-0 place-items-center rounded-lg';
	const ICON_SLOT = 'text-fg-tertiary grid size-4 shrink-0 place-items-center';
	const KEY =
		'border-chip-border bg-chip text-2xs text-fg-tertiary rounded border px-1.5 py-0.5 font-sans';

	let nowMs = $state(Date.now());
	let browsing = $state(false);
	let signInAsked = $state(false);
	let lastShown: UsageStepValue<'github_view'> | null = null;

	const listing = $derived(githubRepositoriesQuery.data);
	const auth = $derived(githubAuthQuery.data);
	const status = $derived(githubSetupStatus(auth, githubAuthErrorQuery.data));
	const signIn = $derived(githubSignInQuery.data);
	const install = $derived(githubCliInstallQuery.data);
	const download = $derived(install.kind === 'installing' ? install.progress : null);
	const connected = $derived(connectedRepositoriesQuery.data);
	const connectingKey = $derived(repositoryConnectingKeyQuery.data);
	const connecting = $derived(repositoryConnectingQuery.data);
	const connectError = $derived(repositoryConnectErrorQuery.data);
	const rows = $derived(listing.kind === 'loaded' ? listing.repositories.slice(0, ROWS) : []);
	const view = $derived(githubView());
	const subline = $derived(githubSubline());
	const shown = $derived(shownView());

	onMount(() => showOnboardingHook());

	onMount(loadUsageDataCommand);

	onMount(() => {
		const clock = setInterval(() => (nowMs = Date.now()), CLOCK_MS);
		const stopWatching = watchGithubAuthHook();
		return () => {
			clearInterval(clock);
			stopWatching();
		};
	});

	$effect(() => {
		if (status === 'ready') untrack(loadGithubRepositoriesCommand);
	});

	$effect(() => {
		if (!browsing || shown === null || shown === lastShown) return;
		lastShown = shown;
		untrack(() => countUsageStepCommand({ step: 'github_view', value: shown }));
	});

	$effect(() => {
		if (!browsing) return;
		if (status === 'missing' && install.kind === 'idle') untrack(installGithubCliCommand);
		if (status === 'signed-out' && signIn.kind === 'idle' && !signInAsked) {
			signInAsked = true;
			untrack(() => signInToGithubCommand());
		}
	});

	function githubView(): GithubView {
		if (signIn.kind === 'waiting') return 'code';
		if (signIn.kind !== 'idle') return 'loading';
		switch (status) {
			case 'ready':
				return 'list';
			case 'signed-out':
				return signInAsked ? 'sign-in' : 'loading';
			case 'unknown':
				return 'unknown';
			case 'missing':
				return install.kind === 'failed' ? 'install-failed' : 'loading';
			case 'checking':
				return 'loading';
		}
	}

	function shownView(): UsageStepValue<'github_view'> | null {
		switch (view) {
			case 'list':
				if (listing.kind === 'failed') return 'list_failed';
				if (listing.kind === 'loaded') return rows.length > 0 ? 'list' : 'empty';
				return null;
			case 'code':
				return 'code';
			case 'sign-in':
				return 'sign_in';
			case 'install-failed':
				return 'install_failed';
			case 'unknown':
				return 'unknown';
			case 'loading':
				return null;
		}
	}

	function githubSubline(): string | null {
		switch (view) {
			case 'loading':
				return 'Loading your repositories';
			case 'code':
				return 'Paste this code on GitHub';
			case 'sign-in':
				return 'Not signed in';
			case 'list':
				return listing.kind === 'loading' ? 'Loading your repositories' : (auth?.login ?? null);
			case 'install-failed':
			case 'unknown':
				return null;
		}
	}

	function pick(choice: UsageStepValue<'picked'>, open: () => void): void {
		countUsageStepCommand({ step: 'picked', value: choice });
		open();
	}

	function back(): void {
		countUsageStepCommand({ step: 'github_back', value: shown ?? 'loading' });
		lastShown = null;
		if (signIn.kind === 'starting' || signIn.kind === 'waiting') cancelGithubSignInCommand();
		browsing = false;
		signInAsked = false;
	}

	function stateOf(repository: GithubRepository): GithubRepositoryState {
		return githubRepositoryState(repository, connectingKey, connected);
	}
</script>

{#snippet skeleton()}
	<ul class="flex flex-col p-1" aria-busy="true" aria-label="Loading your GitHub repositories">
		{#each SKELETON_WIDTHS as width (width)}
			<li class="flex h-8 items-center gap-3 px-2.5">
				<Skeleton shape="rect" width="1rem" height="1rem" />
				<Skeleton shape="text" {width} height="0.625rem" />
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet repositoryList()}
	{#if listing.kind === 'loading'}
		{@render skeleton()}
	{:else if listing.kind === 'failed'}
		<StateBlock
			layout="inline"
			tone="caution"
			class="px-3.5"
			heading="Could not load your GitHub repositories"
			detail={listing.failure.detail}
			remedy={listing.failure.remedy}
			technical={listing.failure.technical}
			testId="first-repository-picker-error"
		>
			{#snippet icon()}
				<Icon name="alert" size={14} />
			{/snippet}
		</StateBlock>
	{:else if rows.length > 0}
		<ul class="flex flex-col p-1" aria-label="Your GitHub repositories">
			{#each rows as repository (repository.fullName)}
				{@const state = stateOf(repository)}
				<li>
					<Button
						bare
						ariaLabel={repository.fullName}
						disabled={state.kind === 'cloning'}
						ariaBusy={state.kind === 'cloning'}
						class={ROW}
						data-testid="first-repository"
						onclick={() => pickGithubRepositoryCommand(repository, state)}
					>
						<GithubRepositoryLabel {repository} {state} {nowMs} compact />
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if listing.kind !== 'loaded' || rows.length > 0}
		<div class="border-surface-150-border mx-3.5 border-t-[0.5px]" role="separator"></div>
	{/if}
	<div class="p-1">
		<Button
			bare
			ariaHasPopup="dialog"
			ariaKeyshortcuts="Meta+K"
			class={[ROW, 'text-fg-secondary hover:text-fg-default focus-visible:text-fg-default text-sm']}
			onclick={() => pick('more', () => openCommandCenterCommand('find'))}
		>
			<span class={ICON_SLOT}>
				<Icon name="search" size={14} />
			</span>
			<span class="flex-1">More repositories</span>
			<kbd class={KEY} aria-hidden="true">⌘K</kbd>
		</Button>
	</div>
{/snippet}

{#snippet github()}
	<ComposerShell testId="first-repository-github">
		<div class="flex items-center gap-3 px-3 pt-3 pb-2">
			<span class={BADGE} aria-hidden="true">
				<GitHubIcon size={16} />
			</span>
			<hgroup class="flex min-w-0 flex-1 flex-col">
				<h2 class="text-fg-default text-sm font-medium">GitHub</h2>
				{#if subline}
					<p class="text-fg-tertiary truncate text-xs leading-5" role="status">{subline}</p>
				{/if}
			</hgroup>
			{#if view === 'sign-in'}
				<Button
					variant="primary"
					size="sm"
					ariaLabel="Sign in to GitHub"
					onclick={() => signInToGithubCommand()}
				>
					Sign in
				</Button>
			{/if}
			<Button variant="secondary" size="sm" onclick={back}>
				{#snippet leading()}
					<Icon name="chevron-left" size={14} />
				{/snippet}
				Back
			</Button>
		</div>
		{#if view === 'list'}
			{@render repositoryList()}
		{:else if view === 'code' && signIn.kind === 'waiting'}
			<div class="px-3 pb-3">
				<GitHubDeviceCode userCode={signIn.userCode} />
			</div>
		{:else if view === 'install-failed' && install.kind === 'failed'}
			{@render problem(
				'Could not load your repositories',
				install.message,
				installGithubCliCommand,
			)}
		{:else if view === 'unknown'}
			{@render problem(
				'Could not check GitHub',
				githubAuthErrorQuery.data ?? null,
				loadGithubAuthCommand,
			)}
		{:else if view === 'loading'}
			{#if download}
				<DownloadProgress
					class="px-3 pb-1"
					received={download.received}
					total={download.total}
					ariaLabel="Loading your repositories"
				/>
			{/if}
			{@render skeleton()}
		{/if}
	</ComposerShell>
{/snippet}

{#snippet problem(heading: string, technical: string | null, retry: () => void)}
	<StateBlock
		layout="inline"
		live="alert"
		tone="caution"
		class="px-3.5 pb-3"
		{heading}
		{technical}
		testId="first-repository-github-problem"
	>
		{#snippet icon()}
			<Icon name="alert" size={14} />
		{/snippet}
		{#snippet action()}
			<Button variant="secondary" size="sm" onclick={retry}>
				{#snippet leading()}
					<Icon name="refresh" size={14} />
				{/snippet}
				Try again
			</Button>
		{/snippet}
	</StateBlock>
{/snippet}

<div
	class="mx-auto flex w-full max-w-[640px] px-6 pt-[18vh] pb-6"
	in:fade={{ duration: motionOff() ? 0 : 150 }}
>
	<section
		class="flex w-full flex-col gap-5"
		aria-label="Your repositories"
		data-testid="first-repository-picker"
	>
		<hgroup class="flex flex-col gap-2 px-[15px]">
			<h1 class="text-fg-default text-2xl font-medium tracking-tight">What are we working on?</h1>
			<p class="text-fg-tertiary max-w-[60ch] text-[15px] leading-6 text-pretty">
				Malini runs Claude Code and works in your GitHub repositories.
				{#if usageDataQuery.data.shared !== false}
					It shares usage stats, never your code or chats. Turn it off in Settings.
				{/if}
			</p>
		</hgroup>
		{#if browsing}
			{@render github()}
		{:else}
			<ComposerShell>
				<div class="flex flex-col p-1">
					<Button bare class={DOOR} onclick={() => pick('github', () => (browsing = true))}>
						<span class={BADGE} aria-hidden="true">
							<GitHubIcon size={16} />
						</span>
						GitHub
					</Button>
					<Button
						bare
						ariaKeyshortcuts="Meta+O"
						disabled={connecting !== null}
						ariaBusy={connecting === 'folder'}
						class={DOOR}
						onclick={() => pick('folder', () => openRepositoryFolderCommand())}
					>
						<span class={BADGE} aria-hidden="true">
							<Icon name="folder-open" size={15} />
						</span>
						<span class="flex-1">
							{connecting === 'folder' ? 'Opening…' : 'A folder on this Mac'}
						</span>
						<kbd class={KEY} aria-hidden="true">⌘O</kbd>
					</Button>
					<Button
						bare
						ariaHasPopup="dialog"
						class={DOOR}
						onclick={() => pick('new', () => openCommandCenterCommand('new-repository'))}
					>
						<span class={BADGE} aria-hidden="true">
							<Icon name="plus" size={14} />
						</span>
						New repository
					</Button>
				</div>
			</ComposerShell>
		{/if}
		{#if connectError}
			<ComposerShell class="px-2" testId="repository-connect-error">
				<StateBlock
					layout="inline"
					live="alert"
					tone="critical"
					heading="Could not clone repository"
					detail={connectError.detail}
					remedy={connectError.remedy}
					technical={connectError.technical}
				>
					{#snippet icon()}
						<Icon name="alert" size={14} />
					{/snippet}
				</StateBlock>
			</ComposerShell>
		{/if}
	</section>
</div>
