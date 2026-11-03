<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { Icon } from '$hyper-ui/icons';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import {
		GitHubSetup,
		connectedRepositoriesQuery,
		githubAuthQuery,
		githubRepositoriesQuery,
		githubRepositoryState,
		loadGithubAuthCommand,
		loadGithubRepositoriesCommand,
		pickGithubRepositoryCommand,
		reloadGithubRepositoriesOnSignInHook,
		repositoryConnectErrorQuery,
		repositoryConnectingKeyQuery,
		repositoryPreparationQuery,
		type GithubRepository,
		type GithubRepositoryState,
	} from '$shared/repositories/repositories.api';
	import { openCommandCenterCommand } from '$lib/app/application/commands/open-command-center.command';
	import { FIRST_CHAT_TRAY_ROWS, firstChatTray } from '$lib/app/domain/first-chat-tray';
	import GithubRepositoryLabel from './GithubRepositoryLabel.svelte';

	const CLOCK_MS = 30_000;
	const SKELETON_WIDTHS = ['38%', '30%', '44%', '26%', '34%'].slice(0, FIRST_CHAT_TRAY_ROWS);
	const ROW =
		'hover:bg-surface-50-hover focus-visible:bg-surface-50-hover flex h-9 w-full cursor-pointer items-center gap-2.5 px-3 text-left outline-none';

	let nowMs = $state(Date.now());

	const listing = $derived(githubRepositoriesQuery.data);
	const signedOut = $derived(githubAuthQuery.data?.authenticated === false);
	const connected = $derived(connectedRepositoriesQuery.data);
	const preparationOf = $derived(repositoryPreparationQuery.data);
	const connectingKey = $derived(repositoryConnectingKeyQuery.data);
	const connectError = $derived(repositoryConnectErrorQuery.data);
	const rows = $derived(
		listing.kind === 'loaded'
			? firstChatTray(
					listing.repositories,
					(repository) => stateOf(repository).kind !== 'available',
				)
			: [],
	);

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

<section
	class="flex flex-col gap-3"
	aria-label="Your repositories"
	data-testid="first-chat-repositories"
>
	{#if signedOut}
		<div class="pt-4">
			<GitHubSetup nested />
		</div>
	{:else}
		<div
			class="border-surface-50-border bg-surface-50 mx-6 overflow-hidden rounded-b-xl border-x-[0.5px] border-b-[0.5px]"
		>
			{#if listing.kind === 'loading'}
				<ul aria-busy="true" aria-label="Loading your GitHub repositories">
					{#each SKELETON_WIDTHS as width (width)}
						<li class="flex h-9 items-center gap-2.5 px-3">
							<Skeleton shape="rect" width="1.25rem" height="1.25rem" />
							<Skeleton shape="text" {width} height="0.625rem" />
						</li>
					{/each}
				</ul>
			{:else if listing.kind === 'failed'}
				<StateBlock
					layout="inline"
					tone="caution"
					class="px-3"
					heading="Could not load your GitHub repositories"
					detail={listing.failure.detail}
					remedy={listing.failure.remedy}
					technical={listing.failure.technical}
					testId="first-chat-repositories-error"
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
								ariaLabel={state.kind === 'failed'
									? `Retry cloning ${repository.fullName}`
									: repository.fullName}
								disabled={state.kind === 'cloning' || state.kind === 'cloned'}
								ariaBusy={state.kind === 'cloning'}
								class={[ROW, 'disabled:cursor-default disabled:hover:bg-transparent']}
								data-testid="first-chat-repository"
								onclick={() => pickGithubRepositoryCommand(repository, state, { open: false })}
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
				class={[
					ROW,
					'text-fg-secondary hover:text-fg-default text-sm',
					listing.kind !== 'loaded' || rows.length > 0
						? 'border-surface-50-border border-t-[0.5px]'
						: null,
				]}
				onclick={() => openCommandCenterCommand('find')}
			>
				<span class="text-fg-tertiary grid size-5 place-items-center">
					<Icon name="search" size={14} />
				</span>
				<span class="flex-1">More repositories</span>
				<kbd
					class="border-chip-border bg-chip text-2xs text-fg-tertiary rounded border px-1.5 py-0.5 font-sans"
				>
					⌘K
				</kbd>
			</Button>
			<Button
				bare
				ariaHasPopup="dialog"
				class={[
					ROW,
					'border-surface-50-border text-fg-secondary hover:text-fg-default border-t-[0.5px] text-sm',
				]}
				onclick={() => openCommandCenterCommand('new-repository')}
			>
				<span
					class="border-border-default text-fg-tertiary grid size-5 place-items-center rounded-md border-[0.5px] border-dashed"
				>
					<Icon name="plus" size={14} />
				</span>
				New repository
			</Button>
		</div>
		{#if connectError}
			<div
				class="border-border-default mx-6 rounded-xl border-[0.5px] px-2"
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
	{/if}
</section>
