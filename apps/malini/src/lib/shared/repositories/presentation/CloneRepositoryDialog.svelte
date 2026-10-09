<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Modal } from '$hyper-ui/components/modal';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { clearRepositoryConnectErrorCommand } from '$shared/repositories/application/commands/clear-repository-connect-error.command';
	import { connectRepositoryCommand } from '$shared/repositories/application/commands/connect-repository.command';
	import { loadGithubRepositoriesCommand } from '$shared/repositories/application/commands/load-github-repositories.command';
	import { githubRepositoriesQuery } from '$shared/repositories/application/queries/github-repositories.query.svelte';
	import { repositoryConnectErrorQuery } from '$shared/repositories/application/queries/repository-connect-error.query.svelte';
	import { repositoryConnectingQuery } from '$shared/repositories/application/queries/repository-connecting.query.svelte';
	import type { GithubRepository } from '$shared/repositories/domain/repository';
	import { isCloneUrl } from '$shared/repositories/domain/repository-connection';
	import RepositoryAvatar from './RepositoryAvatar.svelte';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	let url = $state('');
	let query = $state('');
	let urlInput: HTMLInputElement | null = $state(null);

	const recentHeadingId = $props.id();
	const listing = $derived(githubRepositoriesQuery.data);
	const connecting = $derived(repositoryConnectingQuery.data);
	const connectError = $derived(repositoryConnectErrorQuery.data);
	const cloneUrlValid = $derived(isCloneUrl(url));
	const matches = $derived.by((): readonly GithubRepository[] => {
		if (listing.kind !== 'loaded') return [];
		const needle = query.trim().toLowerCase();
		if (needle.length === 0) return listing.repositories;
		return listing.repositories.filter((repo) =>
			`${repo.fullName} ${repo.description ?? ''}`.toLowerCase().includes(needle),
		);
	});

	onMount(() => {
		clearRepositoryConnectErrorCommand();
		loadGithubRepositoriesCommand();
		void focusUrl();
	});

	async function focusUrl(): Promise<void> {
		await tick();
		urlInput?.focus();
	}

	function clone(cloneUrl: string = url): void {
		if (!isCloneUrl(cloneUrl) || connecting !== null) return;
		url = cloneUrl;
		connectRepositoryCommand({ kind: 'clone-url', url: cloneUrl.trim() }, onclose);
	}

	function onWindowKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || !event.metaKey) return;
		event.preventDefault();
		clone();
	}

	function onSearchKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.metaKey) return;
		event.preventDefault();
		const first = matches[0];
		if (first) url = first.cloneUrl;
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<Modal open title="Clone GitHub repo" size="lg" class="w-xl" {onclose}>
	<form
		class="flex flex-col gap-5"
		data-testid="clone-repository-dialog"
		onsubmit={(event) => {
			event.preventDefault();
			clone();
		}}
	>
		<TextInput
			bind:value={url}
			bind:element={urlInput}
			label="Repository URL"
			placeholder="https://github.com/user/repo.git"
			autocomplete="off"
			data-testid="clone-repository-url"
		/>

		<section class="flex flex-col gap-1.5" aria-labelledby={recentHeadingId}>
			<h3 id={recentHeadingId} class="text-fg-secondary text-sm font-medium">Recent repos</h3>
			<TextInput
				bind:value={query}
				type="search"
				ariaLabel="Search repositories"
				placeholder="Search repositories…"
				autocomplete="off"
				inputClass="[&::-webkit-search-cancel-button]:hidden"
				onkeydown={onSearchKeydown}
			>
				{#snippet icon()}
					<Icon name="search" size={14} />
				{/snippet}
			</TextInput>
			<div
				class="border-surface-50-border bg-surface-50 styled-scrollbar mt-1 h-56 overflow-y-auto rounded-xl border-[0.5px]"
			>
				{#if listing.kind === 'loading'}
					<ul
						class="divide-surface-50-border divide-y-[0.5px]"
						aria-busy="true"
						aria-label="Loading your GitHub repositories"
					>
						{#each ['44%', '32%', '50%', '38%'] as width (width)}
							<li class="flex h-14 items-center gap-3 px-3">
								<Skeleton shape="rect" width="1.75rem" height="1.75rem" />
								<div class="flex min-w-0 flex-1 flex-col gap-2">
									<Skeleton shape="text" {width} height="0.625rem" />
									<Skeleton shape="text" width="24%" height="0.5rem" />
								</div>
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
						remedy={listing.failure.remedy ?? 'Paste the repository URL above instead.'}
						technical={listing.failure.technical}
						testId="clone-repository-list-error"
					>
						{#snippet icon()}
							<Icon name="alert" size={14} />
						{/snippet}
					</StateBlock>
				{:else if matches.length === 0}
					<StateBlock
						layout="inline"
						class="px-3"
						heading={query.trim().length > 0 ? 'No matching repositories' : 'No repositories yet'}
						detail={query.trim().length > 0
							? `None of your recent repositories match “${query.trim()}”.`
							: 'Your GitHub account has no repositories to show.'}
						remedy="Paste the repository URL above instead."
						testId="clone-repository-list-empty"
					>
						{#snippet icon()}
							<Icon name="search" size={14} />
						{/snippet}
					</StateBlock>
				{:else}
					<ul class="divide-surface-50-border divide-y-[0.5px]" aria-label="Recent repositories">
						{#each matches as repo (repo.fullName)}
							{@const selected = url.trim() === repo.cloneUrl}
							<li>
								<Button
									bare
									ariaPressed={selected}
									class={[
										'hover:bg-surface-50-hover focus-visible:bg-surface-50-hover flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left outline-none',
										selected ? 'bg-surface-50-selected' : null,
									]}
									data-testid="clone-repository-option"
									onclick={() => (url = repo.cloneUrl)}
									ondblclick={() => clone(repo.cloneUrl)}
								>
									<RepositoryAvatar fullName={repo.fullName} size={28} />
									<span class="min-w-0 flex-1">
										<span class="text-fg-default block truncate text-sm font-medium">
											{repo.fullName}
										</span>
										{#if repo.description}
											<span class="text-fg-tertiary block truncate text-xs">
												{repo.description}
											</span>
										{/if}
									</span>
									{#if selected}
										<Icon name="check" size={14} class="text-fg-secondary shrink-0" />
									{/if}
								</Button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>

		{#if connectError}
			<StateBlock
				layout="inline"
				live="alert"
				tone="critical"
				heading="Could not clone repository"
				detail={connectError.detail}
				remedy={connectError.remedy}
				technical={connectError.technical}
				testId="clone-repository-error"
			>
				{#snippet icon()}
					<Icon name="alert" size={14} />
				{/snippet}
			</StateBlock>
		{/if}

		<div class="flex justify-end">
			<Button
				type="submit"
				variant="primary"
				size="lg"
				disabled={!cloneUrlValid || connecting === 'folder'}
				loading={connecting === 'clone'}
				ariaKeyshortcuts="Meta+Enter"
				data-testid="clone-repository-submit"
			>
				{connecting === 'clone' ? 'Cloning…' : 'Clone repo'}
				{#snippet trailing()}
					<kbd class="text-xs font-normal opacity-60" aria-hidden="true">⌘↵</kbd>
				{/snippet}
			</Button>
		</div>
	</form>
</Modal>
