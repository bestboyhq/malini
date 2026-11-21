<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { ResizableSplit } from '$hyper-ui/components/resizable-split';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { startDependencyWorkstreamCommand } from '$lib/app/application/commands/start-dependency-workstream.command';
	import { startWorkstreamFromNoteCommand } from '$lib/app/application/commands/start-workstream-from-note.command';
	import { workstreamStandingQuery } from '$lib/app/application/queries/workstream-standing.query.svelte';
	import { InitiativeNotes, Initiatives } from '$lib/initiatives/initiatives.api';
	import { Scratchpad, ScratchpadEditor } from '$lib/scratchpad/scratchpad.api';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import {
		RemoveRepositoryButton,
		RepositoryAvatar,
		activeWorkstreamsQuery,
		connectedRepositoriesQuery,
		prepareRepositoryCommand,
		removeRepositoryCommand,
		repositoriesScopeLoadedQuery,
		repositoryName,
		repositoryOwner,
		repositoryPreparationQuery,
		repositoryWebUrl,
		workstreamsForRepository,
	} from '$shared/repositories/repositories.api';
	import { page } from '$shared/router/state';
	import { inGlobalTopBarBand } from '$shared/shell/global-topbar-actions.svelte';
	import OwnPullRequests from '../OwnPullRequests.svelte';
	import SavedForLater from '../SavedForLater.svelte';

	const repositoryId = $derived(page.params.repositoryId ?? '');
	const repositories = $derived(connectedRepositoriesQuery.data);
	const scopeLoaded = $derived(repositoriesScopeLoadedQuery.data);
	const repository = $derived(repositories.find(({ id }) => id === repositoryId) ?? null);
	const title = $derived(repository ? repositoryName(repository.fullName) : 'Repository');
	const preparation = $derived(repository ? repositoryPreparationQuery.data(repository) : null);

	let noted = $state<Readonly<{ repositoryId: string; id: string }> | null>(null);

	const selected = $derived(noted?.repositoryId === repositoryId ? noted.id : null);

	function select(id: string | null): void {
		noted = id === null ? null : { repositoryId, id };
	}
</script>

<svelte:head>
	<title>Malini · {title}</title>
</svelte:head>

<div class="flex h-full w-full min-w-0 flex-col" data-testid="repository-page">
	{#if repository}
		{@const repo = repository}
		{@const owner = repositoryOwner(repo.fullName)}
		{@const webUrl = repositoryWebUrl(repo.remoteUrl)}
		<div class="contents">
			<header
				class="flex h-10 min-w-0 flex-1 items-center gap-2 pl-2"
				data-native-drag-region
				data-testid="repository-bar"
				{@attach inGlobalTopBarBand}
			>
				<RepositoryAvatar fullName={repo.fullName} size={16} />
				<h1 class="text-fg-default flex min-w-0 items-center gap-1 text-sm font-medium">
					{#if owner}<span class="text-fg-tertiary shrink-0 font-normal">{owner} /</span>{/if}
					{#if webUrl}
						<Tooltip content="Open on GitHub" placement="bottom">
							<Button
								bare
								href={webUrl}
								class="group/name flex min-w-0 items-center gap-1 rounded-sm outline-none"
							>
								<span
									class="truncate underline-offset-4 group-hover/name:underline group-focus-visible/name:underline"
								>
									{title}
								</span>
								<Icon
									name="external-link"
									size={12}
									class="text-fg-tertiary group-hover/name:text-fg-default shrink-0"
								/>
							</Button>
						</Tooltip>
					{:else}
						<span class="truncate">{title}</span>
					{/if}
				</h1>
				<div class="ml-auto flex shrink-0 items-center gap-1">
					<SavedForLater repositoryId={repo.id} />
					{#if owner && preparation?.kind === 'ready'}
						<OwnPullRequests repositoryId={repo.id} />
					{/if}
				</div>
			</header>
		</div>
		<ResizableSplit
			panelId="scratchpad"
			defaultRatio={0.6}
			minSize={360}
			maxSize={1600}
			secondaryMinSize={280}
			class="min-h-0 flex-1"
			primaryUnderSecondary={false}
			handleClass="z-10"
		>
			{#snippet a()}
				<ScrollableDiv class="h-full" ariaLabel={`${title} plan`}>
					<main class="mx-auto w-full max-w-[760px] px-10 pt-6">
						{#if preparation?.kind === 'failed'}
							<div
								class="border-surface-50-border bg-surface-50 -mx-4 mb-8 rounded-2xl border-[0.5px] px-2"
								data-testid="repository-preparation-error"
							>
								<StateBlock
									layout="inline"
									live="alert"
									tone="critical"
									heading="Could not clone this repository"
									detail={preparation.failure.detail}
									remedy={preparation.failure.remedy ?? 'Workstreams start once it clones.'}
									technical={preparation.failure.technical}
								>
									{#snippet icon()}
										<Icon name="alert" size={14} />
									{/snippet}
									{#snippet action()}
										<Button
											variant="secondary"
											size="sm"
											onclick={() => prepareRepositoryCommand(repo)}
										>
											{#snippet leading()}<Icon name="refresh" size={14} />{/snippet}
											Retry
										</Button>
										<RemoveRepositoryButton
											repository={repo}
											workstreams={workstreamsForRepository(repo, activeWorkstreamsQuery.data)}
											onremove={removeRepositoryCommand}
											placement="top"
											testId="repository-preparation-remove"
										/>
									{/snippet}
								</StateBlock>
							</div>
						{/if}
						<Initiatives
							repository={repo}
							standingOf={workstreamStandingQuery.of}
							{selected}
							onselect={select}
							onstart={(initiative, dependency) =>
								startDependencyWorkstreamCommand(initiative, dependency, repo)}
						/>
					</main>
				</ScrollableDiv>
			{/snippet}
			{#snippet b()}
				<ScrollableDiv
					class="border-surface-50-border h-full border-l-[0.5px]"
					ariaLabel={`${title} notes`}
				>
					<div class="px-8 pt-8 pb-8">
						<InitiativeNotes repositoryFullName={repo.fullName} {selected} onselect={select}>
							{#snippet scratchpad()}
								{#key repo.fullName}
									<Scratchpad
										repositoryFullName={repo.fullName}
										onstartworkstream={(start) => startWorkstreamFromNoteCommand(repo, start)}
									/>
								{/key}
							{/snippet}
							{#snippet editor(note)}
								<ScratchpadEditor
									content={note.content}
									label={note.label}
									placeholder={note.placeholder}
									onchange={(content, blank) => note.onchange(blank ? null : content)}
									onstart={null}
								/>
							{/snippet}
						</InitiativeNotes>
					</div>
				</ScrollableDiv>
			{/snippet}
		</ResizableSplit>
	{:else if scopeLoaded}
		<div class="native-page-drag-strip" data-native-drag-region></div>
		<main class="mx-auto w-full max-w-[760px] px-16 pt-10">
			<StateBlock
				heading="Repository not found"
				detail="It was removed from Malini, or this link points somewhere else."
				remedy="Pick a repository in the sidebar."
				testId="repository-page-missing"
			>
				{#snippet icon()}
					<Icon name="folder-search" size={20} />
				{/snippet}
			</StateBlock>
		</main>
	{/if}
</div>
