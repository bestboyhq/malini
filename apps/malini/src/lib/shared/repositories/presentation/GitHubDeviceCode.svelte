<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { copyGithubSignInCodeCommand } from '$shared/repositories/application/commands/copy-github-sign-in-code.command';
	import { openGithubSignInPageCommand } from '$shared/repositories/application/commands/open-github-sign-in-page.command';

	interface Props {
		userCode: string;
	}

	let { userCode }: Props = $props();
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	function onCopy(): void {
		copyGithubSignInCodeCommand();
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1_500);
	}

	onDestroy(() => clearTimeout(copiedTimer));
</script>

<div
	class="border-surface-150-border bg-surface-150 mt-3 flex items-center gap-2 rounded-lg border-[0.5px] py-1 pr-1 pl-3"
>
	<code
		class="text-fg-default min-w-0 flex-1 font-mono text-base font-medium tracking-[0.2em]"
		aria-label="One-time code"
		data-testid="github-sign-in-code"
	>
		{userCode}
	</code>
	<Tooltip content={copied ? 'Copied' : 'Copy code'} placement="top">
		<IconButton
			variant="ghost"
			size="sm"
			ariaLabel="Copy code"
			class="text-fg-tertiary"
			onclick={onCopy}
		>
			{#if copied}
				<Icon name="check" size={14} />
			{:else}
				<Icon name="copy" size={14} />
			{/if}
		</IconButton>
	</Tooltip>
	<Button
		variant="secondary"
		size="sm"
		class="shrink-0"
		ariaLabel="Open GitHub in your browser"
		onclick={openGithubSignInPageCommand}
	>
		{#snippet trailing()}
			<Icon name="external-link" size={13} />
		{/snippet}
		Open GitHub
	</Button>
</div>
<p class="text-fg-tertiary mt-2 text-xs leading-5">
	It’s on your clipboard. Then authorize GitHub CLI, which Malini uses.
</p>
