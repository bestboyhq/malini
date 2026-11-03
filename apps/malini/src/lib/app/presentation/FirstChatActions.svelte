<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
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

<div class="flex flex-col items-center gap-3" data-testid="first-chat-actions">
	<div class="flex items-center justify-center gap-2">
		<Button
			variant="ghost"
			radius="full"
			bordered
			class="h-8"
			disabled={connecting === 'folder'}
			loading={connecting === 'clone'}
			ariaHasPopup="dialog"
			ariaLabel="Clone a GitHub repository"
			data-testid="repository-clone-open"
			onclick={() => (cloneDialogOpen = true)}
		>
			{#snippet leading()}
				<Icon name="cloud-download" size={15} />
			{/snippet}
			{connecting === 'clone' ? 'Cloning…' : 'Clone repo'}
		</Button>
		<Button
			variant="ghost"
			radius="full"
			bordered
			class="h-8"
			disabled={connecting === 'clone'}
			loading={connecting === 'folder'}
			ariaLabel="Open a local repository folder"
			data-testid="repository-open-folder"
			onclick={openRepositoryFolderCommand}
		>
			{#snippet leading()}
				<Icon name="folder-open" size={15} />
			{/snippet}
			{connecting === 'folder' ? 'Opening…' : 'Open folder'}
		</Button>
	</div>
	{#if connectError}
		<div
			class="border-border-default w-full rounded-2xl border-[0.5px] px-2"
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
