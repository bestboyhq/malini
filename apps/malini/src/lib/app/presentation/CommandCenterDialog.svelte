<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Checkbox } from '$hyper-ui/components/checkbox';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { Modal } from '$hyper-ui/components/modal';
	import { Select } from '$hyper-ui/components/select';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { page } from '$shared/router/state';
	import {
		GitHubSetup,
		clearRepositoryConnectErrorCommand,
		connectRepositoryCommand,
		connectedRepositoriesQuery,
		createGithubRepositoryCommand,
		githubAuthQuery,
		githubOwnersQuery,
		githubRepositoriesQuery,
		githubRepositoryName,
		githubRepositoryState,
		isCloneUrl,
		loadGithubAuthCommand,
		loadGithubOwnersCommand,
		loadGithubRepositoriesCommand,
		pickGithubRepositoryCommand,
		reloadGithubRepositoriesOnSignInHook,
		repositoryConnectErrorQuery,
		repositoryConnectingKeyQuery,
		repositoryConnectingQuery,
		repositoryConnectionFor,
		repositoryPreparationQuery,
		type GithubRepository,
		type GithubRepositoryState,
		type RepositoryConnectOptions,
	} from '$shared/repositories/repositories.api';
	import { plural } from '$lib/stats/stats.api';
	import { closeCommandCenterCommand } from '$lib/app/application/commands/close-command-center.command';
	import { openCommandCenterCommand } from '$lib/app/application/commands/open-command-center.command';
	import { runMenuChoiceCommand } from '$lib/app/application/commands/run-menu-choice.command';
	import {
		COMMAND_CENTER_COMMANDS,
		commandCenterGroups,
		type CommandCenterCommand,
		type CommandCenterEntry,
		type CommandCenterMode,
	} from '$lib/app/domain/command-center';
	import { firstChatWaits } from './first-chat';
	import GithubRepositoryLabel from './GithubRepositoryLabel.svelte';

	interface Props {
		mode: CommandCenterMode;
	}

	let { mode }: Props = $props();

	const CLOCK_MS = 30_000;
	const SKELETON_WIDTHS = ['38%', '30%', '44%', '26%', '34%'];
	const KEY =
		'border-chip-border bg-chip text-2xs text-fg-tertiary rounded border px-1.5 py-0.5 font-sans';
	const COMMAND_ICONS: Readonly<Record<CommandCenterCommand['id'], IconName>> = {
		clone: 'cloud-download',
		'new-repository': 'folder-plus',
		'open-folder': 'folder-open',
		'new-chat': 'chat',
		settings: 'settings',
	};
	const INPUT_LABELS: Readonly<Record<CommandCenterMode, string>> = {
		commands: 'Command or repository',
		clone: 'Search repositories',
		'new-repository': 'Repository name',
	};
	const HINTS: Readonly<Record<CommandCenterMode, readonly (readonly [string, string])[]>> = {
		commands: [
			['↵', 'Open'],
			['↑↓', 'Move'],
		],
		clone: [
			['↵', 'Clone'],
			['⌫', 'All commands'],
		],
		'new-repository': [
			['↵', 'Create'],
			['⌫', 'All commands'],
		],
	};

	const uid = $props.id();
	const listId = `${uid}-list`;
	let query = $state('');
	let makePrivate = $state(true);
	let input: HTMLInputElement | null = $state(null);
	let list: HTMLElement | null = $state(null);
	let nowMs = $state(Date.now());

	const listing = $derived(githubRepositoriesQuery.data);
	const auth = $derived(githubAuthQuery.data);
	const ownerLogins = $derived(githubOwnersQuery.data);
	const connected = $derived(connectedRepositoriesQuery.data);
	const preparationOf = $derived(repositoryPreparationQuery.data);
	const connecting = $derived(repositoryConnectingQuery.data);
	const connectingKey = $derived(repositoryConnectingKeyQuery.data);
	const connectError = $derived(repositoryConnectErrorQuery.data);
	const workstreamId = $derived(page.params.workstreamId ?? '');
	const stayInFirstChat = $derived(firstChatWaits(workstreamId));
	const connectOptions: RepositoryConnectOptions = $derived({
		open: !stayInFirstChat,
		onConnected: closeCommandCenterCommand,
	});
	const repositories = $derived(listing.kind === 'loaded' ? listing.repositories : null);
	const groups = $derived(
		commandCenterGroups({ mode, query, repositories, inWorkstream: workstreamId !== '' }),
	);
	const entries = $derived(groups.flatMap((group) => group.entries));
	let selectedIndex = $derived.by(() => {
		void mode;
		void query;
		return 0;
	});
	const selected = $derived(entries[selectedIndex]);
	const chip = $derived(COMMAND_CENTER_COMMANDS.find((command) => command.id === mode));
	const needsGithub = $derived(
		auth?.authenticated === false &&
			(mode === 'new-repository' || (mode === 'clone' && !isCloneUrl(query))),
	);
	const owners = $derived.by((): readonly string[] => {
		if (ownerLogins.length > 0) return ownerLogins;
		return auth?.login ? [auth.login] : [];
	});
	let owner: string = $derived(owners[0] ?? '');
	const newName = $derived(githubRepositoryName(query));
	const placeholder = $derived.by((): string => {
		if (mode === 'commands') return 'Type a command or a repository';
		if (mode === 'new-repository') return 'Name it';
		if (repositories === null) return 'Search repositories or paste a URL';
		return `Search ${plural(repositories.length, 'repository', 'repositories')} or paste a URL`;
	});

	onMount(() => {
		clearRepositoryConnectErrorCommand();
		loadGithubAuthCommand();
		loadGithubRepositoriesCommand();
		loadGithubOwnersCommand();
		void focusInput();
		const clock = setInterval(() => (nowMs = Date.now()), CLOCK_MS);
		const stopReloading = reloadGithubRepositoriesOnSignInHook();
		return () => {
			clearInterval(clock);
			stopReloading();
			clearRepositoryConnectErrorCommand();
		};
	});

	async function focusInput(): Promise<void> {
		await tick();
		input?.focus();
	}

	async function revealSelected(): Promise<void> {
		await tick();
		list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
	}

	function stateOf(repository: GithubRepository): GithubRepositoryState {
		return githubRepositoryState(repository, connectingKey, connected, preparationOf);
	}

	function optionId(index: number): string {
		return `${uid}-option-${index}`;
	}

	function entryKey(entry: CommandCenterEntry): string {
		if (entry.kind === 'command') return `command:${entry.command.id}`;
		if (entry.kind === 'repository') return `repository:${entry.repository.fullName}`;
		if (entry.kind === 'clone-url') return `url:${entry.url}`;
		return 'create';
	}

	function entryDisabled(entry: CommandCenterEntry): boolean {
		if (entry.kind !== 'repository') return false;
		const state = stateOf(entry.repository);
		return state.kind === 'cloning' || (state.kind === 'cloned' && stayInFirstChat);
	}

	function cloningUrl(url: string): boolean {
		return connectingKey === repositoryConnectionFor({ kind: 'clone-url', url }).key;
	}

	function run(entry: CommandCenterEntry | undefined): void {
		if (!entry || entryDisabled(entry)) return;
		if (entry.kind === 'repository') {
			pickGithubRepositoryCommand(entry.repository, stateOf(entry.repository), connectOptions);
			return;
		}
		if (entry.kind === 'clone-url') {
			connectRepositoryCommand({ kind: 'clone-url', url: entry.url }, connectOptions);
			return;
		}
		if (entry.kind === 'create') {
			openCommandCenterCommand('new-repository');
			return;
		}
		const { id } = entry.command;
		if (id === 'clone' || id === 'new-repository') {
			query = '';
			openCommandCenterCommand(id);
			return;
		}
		closeCommandCenterCommand();
		runMenuChoiceCommand(id);
	}

	function create(): void {
		if (newName.length === 0 || owner.length === 0 || connecting !== null) return;
		createGithubRepositoryCommand({ owner, name: newName, private: makePrivate }, connectOptions);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (entries.length === 0) return;
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			selectedIndex = (selectedIndex + step + entries.length) % entries.length;
			void revealSelected();
			return;
		}
		if (event.key === 'Enter') {
			if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
			event.preventDefault();
			if (mode === 'new-repository') create();
			else run(selected);
			return;
		}
		if (event.key === 'Backspace' && query === '' && mode !== 'commands') {
			event.preventDefault();
			openCommandCenterCommand('commands');
		}
	}
</script>

<Modal
	open
	ariaLabel="Command center"
	placement="top"
	class="w-150 max-w-[calc(100vw-2rem)] overflow-hidden"
	onclose={closeCommandCenterCommand}
>
	<div class="border-surface-elevated-border flex h-13 items-center gap-2 border-b-[0.5px] px-3.5">
		{#if chip}
			<span
				class="bg-surface-elevated-selected text-fg-default flex h-6.5 shrink-0 items-center gap-1.5 rounded-md pr-2 pl-1.5 text-sm whitespace-nowrap"
			>
				<Icon name={COMMAND_ICONS[chip.id]} size={14} class="text-fg-secondary" />
				{chip.label}
			</span>
		{:else}
			<Icon name="search" size={16} class="text-fg-tertiary shrink-0" />
		{/if}
		<TextInput
			bind:value={query}
			bind:element={input}
			bare
			role={mode === 'new-repository' ? undefined : 'combobox'}
			aria-expanded={mode === 'new-repository' ? undefined : entries.length > 0}
			aria-controls={mode === 'new-repository' ? undefined : listId}
			aria-autocomplete={mode === 'new-repository' ? undefined : 'list'}
			aria-activedescendant={selected ? optionId(selectedIndex) : undefined}
			ariaLabel={INPUT_LABELS[mode]}
			{placeholder}
			autocomplete="off"
			class="min-w-0 flex-1"
			inputClass="h-12 text-base"
			onkeydown={onKeydown}
		/>
	</div>

	{#if needsGithub}
		<div class="p-4">
			<GitHubSetup nested />
		</div>
	{:else if mode === 'new-repository'}
		<div class="flex items-center gap-2.5 px-3.5 py-3 text-sm">
			<Select
				bind:value={owner}
				options={owners.map((login) => ({ value: login, label: login }))}
				ariaLabel="Owner"
				class="max-w-2/5 min-w-0 shrink"
			/>
			<span class="text-fg-tertiary min-w-0 truncate">/ {newName || 'name'}</span>
			<span class="flex-1"></span>
			{#if connecting !== null}
				<BusyIcon size={13} class="text-fg-tertiary" />
			{/if}
			<Checkbox bind:checked={makePrivate} label="Private" />
		</div>
	{:else if entries.length > 0}
		<div
			bind:this={list}
			id={listId}
			role="listbox"
			aria-label={mode === 'clone' ? 'Your GitHub repositories' : 'Commands and repositories'}
			class="styled-scrollbar max-h-88 overflow-y-auto p-1.5"
		>
			{#each groups as group, groupIndex (group.heading ?? groupIndex)}
				<div role="group" aria-label={group.heading ?? undefined}>
					{#if group.heading}
						<div class="text-fg-tertiary px-2.5 pt-2 pb-1 text-xs" aria-hidden="true">
							{group.heading}
						</div>
					{/if}
					{#each group.entries as entry (entryKey(entry))}
						{@const index = entries.indexOf(entry)}
						<DropdownItem
							id={optionId(index)}
							role="option"
							aria-selected={index === selectedIndex}
							selected={index === selectedIndex}
							focusOnHover={false}
							tabindex={-1}
							disabled={entryDisabled(entry)}
							class="h-9.5 gap-2.5 text-sm disabled:cursor-default"
							onmousedown={(event) => event.preventDefault()}
							onmouseenter={() => (selectedIndex = index)}
							onclick={() => run(entry)}
						>
							{#if entry.kind === 'command'}
								<span class="text-fg-secondary grid size-5 place-items-center">
									<Icon name={COMMAND_ICONS[entry.command.id]} size={16} />
								</span>
								<span class="text-fg-default flex-1">{entry.command.label}</span>
								{#if entry.command.keys.length > 0}
									<kbd class={KEY}>{entry.command.keys.join('')}</kbd>
								{/if}
							{:else if entry.kind === 'repository'}
								<GithubRepositoryLabel
									repository={entry.repository}
									state={stateOf(entry.repository)}
									{nowMs}
								/>
							{:else if entry.kind === 'clone-url'}
								<span class="text-fg-secondary grid size-5 place-items-center">
									<Icon name="cloud-download" size={16} />
								</span>
								<span class="text-fg-default min-w-0 flex-1 truncate">
									Clone <SensitiveText text={entry.url} interactive={false} />
								</span>
								{#if cloningUrl(entry.url)}
									<BusyIcon size={13} class="text-fg-tertiary" />
								{/if}
							{:else}
								<span class="text-fg-secondary grid size-5 place-items-center">
									<Icon name="folder-plus" size={16} />
								</span>
								<span class="text-fg-default min-w-0 flex-1 truncate">
									{entry.name ? `New repository “${entry.name}”` : 'New repository'}
								</span>
								{#if entry.name}
									<span class="text-fg-tertiary shrink-0">Nothing called that yet</span>
								{/if}
							{/if}
						</DropdownItem>
					{/each}
				</div>
			{/each}
		</div>
	{:else if mode === 'clone' && listing.kind === 'failed'}
		<StateBlock
			layout="inline"
			tone="caution"
			class="px-3.5"
			heading="Could not load your GitHub repositories"
			detail={listing.failure.detail}
			remedy={listing.failure.remedy ?? 'Paste the repository URL instead.'}
			technical={listing.failure.technical}
			testId="command-center-repositories-error"
		>
			{#snippet icon()}
				<Icon name="alert" size={14} />
			{/snippet}
		</StateBlock>
	{:else if mode === 'clone'}
		<ul class="p-1.5" aria-busy="true" aria-label="Loading your GitHub repositories">
			{#each SKELETON_WIDTHS as width (width)}
				<li class="flex h-9.5 items-center gap-2.5 px-2.5">
					<Skeleton shape="rect" width="1.25rem" height="1.25rem" />
					<Skeleton shape="text" {width} height="0.625rem" />
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-fg-tertiary px-4 py-3 text-sm" role="status">
			Nothing called “{query.trim()}”
		</p>
	{/if}

	{#if connectError}
		<div class="border-surface-elevated-border border-t-[0.5px] px-1.5">
			<StateBlock
				layout="inline"
				live="alert"
				tone="critical"
				heading={mode === 'new-repository'
					? 'Could not create repository'
					: 'Could not clone repository'}
				detail={connectError.detail}
				remedy={connectError.remedy}
				technical={connectError.technical}
				testId="command-center-error"
			>
				{#snippet icon()}
					<Icon name="alert" size={14} />
				{/snippet}
			</StateBlock>
		</div>
	{/if}

	<div
		class="border-surface-elevated-border text-fg-tertiary flex h-9 items-center gap-4 border-t-[0.5px] px-3.5 text-xs"
		aria-hidden="true"
	>
		{#each HINTS[mode] as [keys, label] (label)}
			<span class="flex items-center gap-1.5">
				<kbd class={KEY}>{keys}</kbd>
				{label}
			</span>
		{/each}
		<span class="flex-1"></span>
		<span class="flex items-center gap-1.5">
			<kbd class={KEY}>esc</kbd>
			Close
		</span>
	</div>
</Modal>
