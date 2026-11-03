<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Checkbox } from '$hyper-ui/components/checkbox';
	import { Select } from '$hyper-ui/components/select';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import {
		GitHubSetup,
		RepositoryAvatar,
		connectRepositoryCommand,
		connectedRepositoriesQuery,
		createGithubRepositoryCommand,
		githubAuthQuery,
		githubOwnersQuery,
		githubRepositoriesQuery,
		githubRepositoryName,
		loadGithubAuthCommand,
		loadGithubOwnersCommand,
		loadGithubRepositoriesCommand,
		prepareRepositoryCommand,
		reloadGithubRepositoriesOnSignInHook,
		repositoryConnectErrorQuery,
		repositoryConnectingKeyQuery,
		repositoryConnectingQuery,
		repositoryConnectionFor,
		repositoryName,
		repositoryOwner,
		repositoryPreparationQuery,
		type GithubRepository,
		type Repository,
	} from '$shared/repositories/repositories.api';
	import { formatTimeAgo, plural } from '$lib/stats/stats.api';

	type RowState =
		| Readonly<{ kind: 'available' }>
		| Readonly<{ kind: 'cloning' }>
		| Readonly<{ kind: 'cloned' }>
		| Readonly<{ kind: 'failed'; repository: Repository }>;

	const CLOCK_MS = 30_000;
	const VISIBLE_ROWS = 6;
	const SKELETON_WIDTHS = ['38%', '30%', '44%', '26%', '34%', '40%'];

	let query = $state('');
	let creating = $state(false);
	let name = $state('');
	let makePrivate = $state(true);
	let nameInput: HTMLInputElement | null = $state(null);
	let nowMs = $state(Date.now());

	const listing = $derived(githubRepositoriesQuery.data);
	const auth = $derived(githubAuthQuery.data);
	const ownerLogins = $derived(githubOwnersQuery.data);
	const connectedRepositories = $derived(connectedRepositoriesQuery.data);
	const preparationOf = $derived(repositoryPreparationQuery.data);
	const signedOut = $derived(auth?.authenticated === false);
	const connecting = $derived(repositoryConnectingQuery.data);
	const connectingKey = $derived(repositoryConnectingKeyQuery.data);
	const connectError = $derived(repositoryConnectErrorQuery.data);
	const repositories = $derived(listing.kind === 'loaded' ? listing.repositories : []);
	const typed = $derived(query.trim());
	const matches = $derived.by((): readonly GithubRepository[] => {
		const needle = typed.toLowerCase();
		if (needle.length === 0) return repositories;
		return repositories.filter((repo) =>
			`${repo.fullName} ${repo.description ?? ''}`.toLowerCase().includes(needle),
		);
	});
	const owners = $derived.by((): readonly string[] => {
		if (ownerLogins.length > 0) return ownerLogins;
		return auth?.login ? [auth.login] : [];
	});
	let owner: string = $derived(owners[0] ?? '');
	const newName = $derived(githubRepositoryName(name));

	onMount(() => {
		loadGithubAuthCommand();
		loadGithubRepositoriesCommand();
		loadGithubOwnersCommand();
		const clock = setInterval(() => (nowMs = Date.now()), CLOCK_MS);
		const stopReloading = reloadGithubRepositoriesOnSignInHook();
		return () => {
			clearInterval(clock);
			stopReloading();
		};
	});

	function rowState(repo: GithubRepository): RowState {
		if (connectingKey === repositoryConnectionFor({ kind: 'clone-url', url: repo.cloneUrl }).key) {
			return { kind: 'cloning' };
		}
		const fullName = repo.fullName.toLowerCase();
		const connected = connectedRepositories.find(
			(repository) => repository.fullName.toLowerCase() === fullName,
		);
		if (!connected) return { kind: 'available' };
		const preparation = preparationOf(connected);
		if (preparation.kind === 'preparing') return { kind: 'cloning' };
		if (preparation.kind === 'failed') return { kind: 'failed', repository: connected };
		return { kind: 'cloned' };
	}

	function onPick(repo: GithubRepository, state: RowState): void {
		if (state.kind === 'failed') {
			prepareRepositoryCommand(state.repository);
			return;
		}
		if (state.kind !== 'available' || connecting !== null) return;
		connectRepositoryCommand({ kind: 'clone-url', url: repo.cloneUrl }, { open: false });
	}

	function pushedAgo(pushedAt: string | null): string {
		const at = pushedAt === null ? Number.NaN : Date.parse(pushedAt);
		return Number.isNaN(at) ? '' : formatTimeAgo(Math.max(0, nowMs - at));
	}

	async function onOpenForm(): Promise<void> {
		creating = true;
		await tick();
		nameInput?.focus();
	}

	function onCloseForm(): void {
		creating = false;
		name = '';
		makePrivate = true;
	}

	function onCreate(event: SubmitEvent): void {
		event.preventDefault();
		if (newName.length === 0 || owner.length === 0 || connecting !== null) return;
		createGithubRepositoryCommand({ owner, name: newName, private: makePrivate }, onCloseForm);
	}
</script>

<section
	class="mx-auto flex w-4/5 flex-col gap-3"
	aria-label="Your repositories"
	data-testid="first-chat-repositories"
>
	{#if signedOut}
		<GitHubSetup nested />
	{:else}
		<div class="border-surface-50-border bg-surface-50 overflow-hidden rounded-2xl border-[0.5px]">
			{#if listing.kind !== 'loaded' || repositories.length > 0}
				<div class="border-surface-50-border border-b-[0.5px]">
					<TextInput
						bind:value={query}
						bare
						type="search"
						ariaLabel="Search repositories"
						placeholder={listing.kind === 'loaded'
							? `Search ${plural(repositories.length, 'repository', 'repositories')}`
							: 'Search repositories'}
						autocomplete="off"
						disabled={listing.kind !== 'loaded'}
						inputClass="h-9.5 pr-3 text-sm [&::-webkit-search-cancel-button]:hidden"
					>
						{#snippet icon()}
							<Icon name="search" size={14} />
						{/snippet}
					</TextInput>
				</div>
			{/if}
			{#if listing.kind === 'loading'}
				<ul
					class="h-53 overflow-hidden"
					aria-busy="true"
					aria-label="Loading your GitHub repositories"
				>
					{#each SKELETON_WIDTHS as width (width)}
						<li class="flex h-9.5 items-center gap-2.5 px-3">
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
			{:else if repositories.length > 0}
				<div
					class={[
						'styled-scrollbar overflow-y-auto',
						repositories.length > VISIBLE_ROWS ? 'h-53' : null,
					]}
				>
					{#if matches.length === 0}
						<p class="text-fg-tertiary px-3.5 py-4 text-sm">
							Nothing called “{typed}”. Make it below
						</p>
					{:else}
						<ul aria-label="Your GitHub repositories">
							{#each matches as repo (repo.fullName)}
								{@const state = rowState(repo)}
								{@const owned = repositoryOwner(repo.fullName)}
								{@const ownerPrefix = owned ? `${owned}/` : ''}
								{@const shortName = repositoryName(repo.fullName)}
								<li class="border-surface-50-border not-first:border-t-[0.5px]">
									<Button
										bare
										ariaLabel={state.kind === 'failed'
											? `Retry cloning ${repo.fullName}`
											: repo.fullName}
										disabled={state.kind === 'cloning' || state.kind === 'cloned'}
										ariaBusy={state.kind === 'cloning'}
										class="hover:bg-surface-50-hover focus-visible:bg-surface-50-hover flex h-9.5 w-full cursor-pointer items-center gap-2.5 px-3 text-left outline-none disabled:cursor-default disabled:hover:bg-transparent"
										data-testid="first-chat-repository"
										onclick={() => onPick(repo, state)}
									>
										<RepositoryAvatar fullName={repo.fullName} size={20} />
										<span class="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
											<span class="flex min-w-0">
												<span class="text-fg-tertiary shrink-0">{ownerPrefix}</span>
												<span class="text-fg-default truncate">{shortName}</span>
											</span>
											{#if repo.private}
												<Icon
													name="lock"
													size={12}
													class="text-fg-tertiary shrink-0"
													ariaLabel="Private"
												/>
											{/if}
										</span>
										<span
											class="text-fg-tertiary flex shrink-0 items-center gap-1.5 text-sm tabular-nums"
										>
											{#if state.kind === 'cloning'}
												<BusyIcon size={13} />Cloning…
											{:else if state.kind === 'cloned'}
												<span class="text-success-content flex items-center gap-1.5">
													<Icon name="check" size={14} />On this Mac
												</span>
											{:else if state.kind === 'failed'}
												<span class="text-error-content flex items-center gap-1.5">
													<Icon name="alert" size={14} />Did not clone. Retry
												</span>
											{:else}
												{pushedAgo(repo.pushedAt)}
											{/if}
										</span>
									</Button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
			{#if creating}
				<form
					class="border-surface-50-border flex flex-col gap-3 border-t-[0.5px] p-3"
					aria-label="New repository"
					onsubmit={onCreate}
				>
					<div class="flex items-center gap-2">
						<Select
							bind:value={owner}
							options={owners.map((login) => ({ value: login, label: login }))}
							ariaLabel="Owner"
							class="max-w-2/5 min-w-0 shrink"
						/>
						<span class="text-fg-tertiary" aria-hidden="true">/</span>
						<TextInput
							bind:value={name}
							bind:element={nameInput}
							ariaLabel="Repository name"
							placeholder="name"
							autocomplete="off"
							class="min-w-0 flex-1"
						/>
					</div>
					<div class="flex items-center gap-2">
						<Checkbox bind:checked={makePrivate} label="Private" />
						<span class="flex-1"></span>
						<Button variant="ghost" radius="full" onclick={onCloseForm}>Cancel</Button>
						<Button
							type="submit"
							variant="primary"
							radius="full"
							disabled={newName.length === 0 || owner.length === 0 || connecting === 'clone'}
							loading={connecting === 'create'}
						>
							{connecting === 'create' ? 'Creating…' : 'Create'}
						</Button>
					</div>
				</form>
			{:else if listing.kind === 'loaded'}
				<Button
					bare
					class={[
						'text-fg-secondary hover:bg-surface-50-hover hover:text-fg-default focus-visible:bg-surface-50-hover flex h-10 w-full cursor-pointer items-center gap-2.5 px-3 text-left text-sm outline-none',
						repositories.length > 0 ? 'border-surface-50-border border-t-[0.5px]' : null,
					]}
					onclick={onOpenForm}
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
				class="border-border-default rounded-2xl border-[0.5px] px-2"
				data-testid="repository-connect-error"
			>
				<StateBlock
					layout="inline"
					live="alert"
					tone="critical"
					heading={creating ? 'Could not create repository' : 'Could not connect repository'}
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
