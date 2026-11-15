<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { Button } from '$hyper-ui/components/button';
	import { DownloadProgress } from '$hyper-ui/components/download-progress';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { installGitCommand } from '$shared/repositories/application/commands/install-git.command';
	import { gitSetupQuery } from '$shared/repositories/application/queries/git-setup.query.svelte';

	interface Props {
		class?: ClassValue;
	}

	let { class: className }: Props = $props();

	const setup = $derived(gitSetupQuery.data);
</script>

{#if setup.kind === 'installing'}
	<div
		class={['text-fg-tertiary flex items-center gap-2 text-xs', className]}
		role="status"
		data-testid="git-install-status"
	>
		<BusyIcon size={12} />
		<span class="shrink-0">Installing Git for Windows. Clones wait for it</span>
		{#if setup.progress}
			<DownloadProgress
				class="min-w-0 flex-1"
				received={setup.progress.received}
				total={setup.progress.total}
				ariaLabel="Git for Windows download"
			/>
		{/if}
	</div>
{:else if setup.kind === 'failed'}
	<div
		class={['text-fg-tertiary flex items-center gap-2 text-xs', className]}
		role="alert"
		data-testid="git-install-status"
	>
		<Icon name="warning" size={12} class="text-warning-content shrink-0" />
		<span class="min-w-0 break-words">{setup.message}</span>
		<Button
			bare
			class="text-fg-secondary hover:text-fg-default ml-auto shrink-0 cursor-pointer underline-offset-2 hover:underline"
			onclick={installGitCommand}
		>
			Try again
		</Button>
	</div>
{/if}
