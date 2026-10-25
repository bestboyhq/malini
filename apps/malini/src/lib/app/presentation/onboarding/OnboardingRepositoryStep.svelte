<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import {
		CloneRepositoryDialog,
		openRepositoryFolderCommand,
		repositoryConnectErrorQuery,
		repositoryConnectingQuery,
	} from '$shared/repositories/repositories.api';

	let cloneDialogOpen = $state(false);

	const connecting = $derived(repositoryConnectingQuery.data);
	const connectError = $derived(repositoryConnectErrorQuery.data);
</script>

{#snippet tile(
	icon: IconName,
	title: string,
	detail: string,
	busy: boolean,
	onclick: () => void,
	testId: string,
	ariaLabel: string,
)}
	<Button
		bare
		disabled={connecting !== null}
		ariaBusy={busy}
		{ariaLabel}
		class={[
			'group/tile bg-surface-root hover:bg-surface-root-hover border-border-default flex flex-1 flex-col items-start gap-6 rounded-[18px] border-[0.5px] p-4 text-left',
			'focus-visible:ring-border-default outline-0 focus-visible:ring-2',
			'transition-[scale,opacity] duration-150 ease-out active:scale-[0.985] disabled:not-aria-busy:opacity-60 aria-busy:cursor-progress motion-reduce:transition-none',
		]}
		data-testid={testId}
		{onclick}
	>
		<span
			class="bg-surface-150 text-fg-default grid size-9 place-items-center rounded-xl"
			aria-hidden="true"
		>
			{#if busy}
				<BusyIcon size={16} />
			{:else}
				<Icon name={icon} size={17} />
			{/if}
		</span>
		<span class="flex flex-col gap-0.5">
			<span class="text-fg-default text-sm font-medium">{title}</span>
			<span class="text-fg-tertiary text-xs leading-5">{detail}</span>
		</span>
	</Button>
{/snippet}

<div class="flex flex-col gap-3">
	<div class="flex gap-3">
		{@render tile(
			'folder-open',
			'Open a folder',
			connecting === 'folder' ? 'Opening…' : 'A git repository on this Mac',
			connecting === 'folder',
			openRepositoryFolderCommand,
			'repository-open-folder',
			'Open a local repository folder',
		)}
		{@render tile(
			'link',
			'Clone a repository',
			connecting === 'clone' ? 'Cloning…' : 'From GitHub, or any URL git can clone',
			connecting === 'clone',
			() => (cloneDialogOpen = true),
			'repository-clone-open',
			'Clone a GitHub repository',
		)}
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
				heading="Could not connect repository"
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
</div>

{#if cloneDialogOpen}
	<CloneRepositoryDialog onclose={() => (cloneDialogOpen = false)} />
{/if}
