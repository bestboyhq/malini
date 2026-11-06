<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { Icon } from '$hyper-ui/icons';
	import { motionOff } from '$hyper-ui/motion/motion-off';
	import StateBlock from '$shared/errors/StateBlock.svelte';
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
	import { openCommandCenterCommand } from '$lib/app/application/commands/open-command-center.command';
	import { showOnboardingHook } from '$lib/app/application/hooks/show-onboarding.hook';
	import GithubRepositoryLabel from './GithubRepositoryLabel.svelte';

	const ROWS = 5;
	const CLOCK_MS = 30_000;
	const SKELETON_WIDTHS = ['38%', '30%', '44%', '26%', '34%'];
	const ROW =
		'hover:bg-surface-50-hover focus-visible:bg-surface-50-hover flex h-11 w-full cursor-pointer items-center gap-3 px-4 text-left outline-none';
	const SECONDARY_ROW =
		'border-surface-50-border text-fg-secondary hover:text-fg-default not-first:border-t-[0.5px] text-sm';
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

	onMount(() => showOnboardingHook('picker'));

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
	class="flex w-full justify-center px-6 pt-[18vh] pb-6"
	in:fade={{ duration: motionOff() ? 0 : 150 }}
>
	<section
		class="flex w-[600px] max-w-full flex-col"
		aria-label="Your repositories"
		data-testid="first-repository-picker"
	>
		<h1 class="text-fg-default text-2xl font-medium tracking-tight">What are you working on?</h1>
		{#if signedOut}
			<div class="mt-6">
				<GitHubSetup nested />
			</div>
		{/if}
		<div
			class={[
				'border-surface-50-border bg-surface-50 overflow-hidden rounded-2xl border-[0.5px]',
				signedOut ? 'mt-3' : 'mt-6',
			]}
		>
			{#if !signedOut}
				{#if listing.kind === 'loading'}
					<ul aria-busy="true" aria-label="Loading your GitHub repositories">
						{#each SKELETON_WIDTHS as width (width)}
							<li class="flex h-11 items-center gap-3 px-4">
								<Skeleton shape="rect" width="1.25rem" height="1.25rem" />
								<Skeleton shape="text" {width} height="0.625rem" />
							</li>
						{/each}
					</ul>
				{:else if listing.kind === 'failed'}
					<StateBlock
						layout="inline"
						tone="caution"
						class="px-4"
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
					<ul aria-label="Your GitHub repositories">
						{#each rows as repository (repository.fullName)}
							{@const state = stateOf(repository)}
							<li class="border-surface-50-border not-first:border-t-[0.5px]">
								<Button
									bare
									ariaLabel={repository.fullName}
									disabled={state.kind === 'cloning'}
									ariaBusy={state.kind === 'cloning'}
									class={[ROW, 'disabled:cursor-default disabled:hover:bg-transparent']}
									data-testid="first-repository"
									onclick={() =>
										pickGithubRepositoryCommand(repository, state, { open: 'workstream' })}
								>
									<GithubRepositoryLabel {repository} {state} {nowMs} />
								</Button>
							</li>
						{/each}
					</ul>
				{/if}
				<Button
					bare
					ariaHasPopup="dialog"
					ariaKeyshortcuts="Meta+K"
					class={[ROW, SECONDARY_ROW]}
					onclick={() => openCommandCenterCommand('find')}
				>
					<span class="text-fg-tertiary grid size-5 place-items-center">
						<Icon name="search" size={14} />
					</span>
					<span class="flex-1">More repositories</span>
					<kbd class={KEY}>⌘K</kbd>
				</Button>
			{/if}
			<Button
				bare
				ariaKeyshortcuts="Meta+O"
				disabled={connecting !== null}
				ariaBusy={connecting === 'folder'}
				class={[ROW, SECONDARY_ROW, 'disabled:cursor-default disabled:hover:bg-transparent']}
				onclick={() => openRepositoryFolderCommand({ open: 'workstream' })}
			>
				<span class="text-fg-tertiary grid size-5 place-items-center">
					<Icon name="folder-open" size={14} />
				</span>
				<span class="flex-1">{connecting === 'folder' ? 'Opening…' : 'Open a folder'}</span>
				<kbd class={KEY}>⌘O</kbd>
			</Button>
			{#if !signedOut}
				<Button
					bare
					ariaHasPopup="dialog"
					class={[ROW, SECONDARY_ROW]}
					onclick={() => openCommandCenterCommand('new-repository')}
				>
					<span
						class="border-border-default text-fg-tertiary grid size-5 place-items-center rounded-md border-[0.5px] border-dashed"
					>
						<Icon name="plus" size={14} />
					</span>
					New repository
				</Button>
			{/if}
		</div>
		{#if connectError}
			<div
				class="border-border-default mt-3 rounded-2xl border-[0.5px] px-2"
				data-testid="repository-connect-error"
			>
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
			</div>
		{/if}
	</section>
</div>
