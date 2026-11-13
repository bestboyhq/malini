<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { DownloadProgress } from '$hyper-ui/components/download-progress';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { motionOff } from '$hyper-ui/motion/motion-off';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import {
		claudeCodeInstallQuery,
		installClaudeCodeCommand,
	} from '$shared/providers/providers.api';
	import {
		GitHubSetup,
		connectedRepositoriesQuery,
		githubAuthQuery,
		githubRepositoriesQuery,
		githubRepositoryState,
		loadGithubAuthCommand,
		loadGithubRepositoriesCommand,
		openRepositoryFolderCommand,
		pickGithubRepositoryCommand,
		reloadGithubRepositoriesOnSignInHook,
		repositoryConnectErrorQuery,
		repositoryConnectingKeyQuery,
		repositoryConnectingQuery,
		repositoryPreparationQuery,
		type GithubRepository,
		type GithubRepositoryState,
	} from '$shared/repositories/repositories.api';
	import { loadUsageDataCommand } from '$lib/app/application/commands/load-usage-data.command';
	import { openCommandCenterCommand } from '$lib/app/application/commands/open-command-center.command';
	import { usageDataQuery } from '$lib/app/application/queries/usage-data.query.svelte';
	import { showOnboardingHook } from '$lib/app/application/hooks/show-onboarding.hook';
	import GithubRepositoryLabel from './GithubRepositoryLabel.svelte';

	const ROWS = 5;
	const CLOCK_MS = 30_000;
	const SKELETON_WIDTHS = ['38%', '30%', '44%', '26%', '34%'];
	const ROW =
		'hover:bg-surface-100-hover focus-visible:bg-surface-100-hover flex h-8 w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 text-left outline-none disabled:cursor-default disabled:hover:bg-transparent';
	const ACTION_ROW =
		'text-fg-secondary hover:text-fg-default focus-visible:text-fg-default text-sm';
	const ICON_SLOT = 'text-fg-tertiary grid size-4 shrink-0 place-items-center';
	const KEY =
		'border-chip-border bg-chip text-2xs text-fg-tertiary rounded border px-1.5 py-0.5 font-sans';

	let nowMs = $state(Date.now());

	const listing = $derived(githubRepositoriesQuery.data);
	const signedOut = $derived(githubAuthQuery.data?.authenticated === false);
	const connected = $derived(connectedRepositoriesQuery.data);
	const preparationOf = $derived(repositoryPreparationQuery.data);
	const connectingKey = $derived(repositoryConnectingKeyQuery.data);
	const connecting = $derived(repositoryConnectingQuery.data);
	const connectError = $derived(repositoryConnectErrorQuery.data);
	const rows = $derived(listing.kind === 'loaded' ? listing.repositories.slice(0, ROWS) : []);
	const listed = $derived(listing.kind !== 'loaded' || rows.length > 0);
	const claudeInstall = $derived(claudeCodeInstallQuery.data);

	onMount(() => showOnboardingHook());

	onMount(loadUsageDataCommand);

	onMount(() => {
		loadGithubAuthCommand();
		loadGithubRepositoriesCommand();
		const clock = setInterval(() => (nowMs = Date.now()), CLOCK_MS);
		const stopReloading = reloadGithubRepositoriesOnSignInHook();
		return () => {
			clearInterval(clock);
			stopReloading();
		};
	});

	function stateOf(repository: GithubRepository): GithubRepositoryState {
		return githubRepositoryState(repository, connectingKey, connected, preparationOf);
	}
</script>

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
		{#if signedOut}
			<GitHubSetup pitch />
		{:else}
			<ComposerShell>
				{#if listed}
					{#if listing.kind === 'loading'}
						<ul
							class="flex flex-col p-1"
							aria-busy="true"
							aria-label="Loading your GitHub repositories"
						>
							{#each SKELETON_WIDTHS as width (width)}
								<li class="flex h-8 items-center gap-3 px-2.5">
									<Skeleton shape="rect" width="1rem" height="1rem" />
									<Skeleton shape="text" {width} height="0.625rem" />
								</li>
							{/each}
						</ul>
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
					{:else}
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
										onclick={() =>
											pickGithubRepositoryCommand(repository, state, { open: 'workstream' })}
									>
										<GithubRepositoryLabel {repository} {state} {nowMs} compact />
									</Button>
								</li>
							{/each}
						</ul>
					{/if}
					<div class="border-surface-150-border mx-3.5 border-t-[0.5px]" role="separator"></div>
				{/if}
				<div class="flex flex-col p-1">
					<Button
						bare
						ariaHasPopup="dialog"
						ariaKeyshortcuts="Meta+K"
						class={[ROW, ACTION_ROW]}
						onclick={() => openCommandCenterCommand('find')}
					>
						<span class={ICON_SLOT}>
							<Icon name="search" size={14} />
						</span>
						<span class="flex-1">More repositories</span>
						<kbd class={KEY}>⌘K</kbd>
					</Button>
					<Button
						bare
						ariaHasPopup="dialog"
						class={[ROW, ACTION_ROW]}
						onclick={() => openCommandCenterCommand('new-repository')}
					>
						<span class={[ICON_SLOT, 'border-border-default rounded-md border border-dashed']}>
							<Icon name="plus" size={12} />
						</span>
						New repository
					</Button>
				</div>
			</ComposerShell>
		{/if}
		<p class="text-fg-tertiary flex items-center gap-1.5 px-[15px] text-sm">
			Not on GitHub?
			<Button
				bare
				ariaKeyshortcuts="Meta+O"
				disabled={connecting !== null}
				ariaBusy={connecting === 'folder'}
				class="text-fg-secondary hover:text-fg-default focus-visible:text-fg-default cursor-pointer underline-offset-2 hover:underline disabled:cursor-default"
				onclick={() => openRepositoryFolderCommand({ open: 'workstream' })}
			>
				{connecting === 'folder' ? 'Opening…' : 'Open a folder'}
			</Button>
			<kbd class={KEY}>⌘O</kbd>
		</p>
		{#if claudeInstall.kind === 'installing'}
			<div
				class="text-fg-tertiary flex items-center gap-2 px-[15px] text-xs"
				role="status"
				data-testid="claude-code-install-status"
			>
				<BusyIcon size={12} />
				<span class="shrink-0">Installing Claude Code in the background</span>
				{#if claudeInstall.progress}
					<DownloadProgress
						class="min-w-0 flex-1"
						received={claudeInstall.progress.received}
						total={claudeInstall.progress.total}
						ariaLabel="Claude Code download"
					/>
				{/if}
			</div>
		{:else if claudeInstall.kind === 'failed'}
			<div
				class="text-fg-tertiary flex items-center gap-2 px-[15px] text-xs"
				role="alert"
				data-testid="claude-code-install-status"
			>
				<Icon name="warning" size={12} class="text-warning-content shrink-0" />
				<span class="min-w-0 break-words">{claudeInstall.message}</span>
				<Button
					bare
					class="text-fg-secondary hover:text-fg-default ml-auto shrink-0 cursor-pointer underline-offset-2 hover:underline"
					onclick={installClaudeCodeCommand}
				>
					Try again
				</Button>
			</div>
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
