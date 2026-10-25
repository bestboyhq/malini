<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, GitHubIcon, Icon } from '$hyper-ui/icons';
	import { cancelGithubSignInCommand } from '$shared/repositories/application/commands/cancel-github-sign-in.command';
	import { copyGithubSignInCodeCommand } from '$shared/repositories/application/commands/copy-github-sign-in-code.command';
	import { loadGithubAuthCommand } from '$shared/repositories/application/commands/load-github-auth.command';
	import { openGithubSignInPageCommand } from '$shared/repositories/application/commands/open-github-sign-in-page.command';
	import { signInToGithubCommand } from '$shared/repositories/application/commands/sign-in-to-github.command';
	import { watchGithubAuthHook } from '$shared/repositories/application/hooks/watch-github-auth.hook';
	import { githubAuthErrorQuery } from '$shared/repositories/application/queries/github-auth-error.query.svelte';
	import { githubAuthQuery } from '$shared/repositories/application/queries/github-auth.query.svelte';
	import { githubSignInQuery } from '$shared/repositories/application/queries/github-sign-in.query.svelte';
	import { githubSetupStatus } from '$shared/repositories/domain/github-auth';

	interface Props {
		step?: boolean;
		nested?: boolean;
	}

	let { step = false, nested = false }: Props = $props();
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	const auth = $derived(githubAuthQuery.data);
	const authError = $derived(githubAuthErrorQuery.data);
	const signIn = $derived(githubSignInQuery.data);
	const status = $derived(githubSetupStatus(auth, authError));
	const actionSize = $derived(step ? 'md' : 'sm');
	const actionRadius = $derived(step ? 'full' : 'md');
	const detail = $derived.by(() => {
		switch (signIn.kind) {
			case 'starting':
				return 'Asking GitHub for a code…';
			case 'waiting':
				return 'Paste this code on the GitHub page that opened.';
			case 'confirming':
				return 'Checking the new sign-in…';
			case 'idle':
				break;
		}
		switch (status) {
			case 'checking':
				return 'Checking your GitHub sign-in…';
			case 'missing':
				return 'Part of Malini is missing. Reinstall Malini.';
			case 'unknown':
				return `Could not check GitHub. ${authError ?? ''}`.trim();
			case 'signed-out':
				return 'Connect to work on your repositories.';
			case 'ready':
				return auth?.login ? `Signed in as ${auth.login}` : 'Signed in';
		}
	});

	function onCopy(): void {
		copyGithubSignInCodeCommand();
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1_500);
	}

	onMount(() => {
		const stopWatching = watchGithubAuthHook();
		return () => {
			stopWatching();
			clearTimeout(copiedTimer);
		};
	});
</script>

{#snippet action()}
	{#if signIn.kind !== 'idle'}
		<BusyIcon size={16} />
		{#if signIn.kind === 'starting' || signIn.kind === 'waiting'}
			<Button
				variant="secondary"
				size={actionSize}
				radius={actionRadius}
				class="shrink-0"
				ariaLabel="Cancel signing in to GitHub"
				onclick={cancelGithubSignInCommand}
			>
				Cancel
			</Button>
		{/if}
	{:else if status === 'checking'}
		<BusyIcon size={16} />
	{:else if status === 'ready'}
		{#if step}
			<span class="text-success-content flex shrink-0 items-center gap-1 text-xs font-medium">
				<Icon name="check" size={14} />
				Ready
			</span>
		{/if}
	{:else if status === 'signed-out'}
		<Button
			variant="primary"
			size={actionSize}
			radius={actionRadius}
			class="shrink-0"
			ariaLabel="Connect GitHub"
			data-testid="github-setup-action"
			onclick={signInToGithubCommand}
		>
			Connect
		</Button>
	{:else}
		<Button
			variant="secondary"
			size={actionSize}
			radius={actionRadius}
			class="shrink-0"
			ariaLabel="Check GitHub again"
			onclick={loadGithubAuthCommand}
		>
			{#snippet leading()}
				<Icon name="refresh" size={14} />
			{/snippet}
			Check again
		</Button>
	{/if}
{/snippet}

{#snippet statusLine(className: string)}
	<p class={className} role="status" data-testid="github-detail">
		<SensitiveText text={detail} />
	</p>
{/snippet}

<div
	class={step
		? undefined
		: [
				'border-surface-50-border bg-surface-50 border-[0.5px] px-4 py-3.5',
				nested ? 'rounded-xl' : 'rounded-2xl',
			]}
	data-testid="github-setup"
	data-github-status={status}
>
	{#if step}
		{@render statusLine('text-fg-tertiary text-sm leading-6')}
	{:else}
		<div class="flex items-center gap-3">
			<div
				class="bg-surface-150 text-fg-default grid h-9 w-9 shrink-0 place-items-center rounded-xl"
				aria-hidden="true"
			>
				<GitHubIcon size={17} />
			</div>
			<div class="min-w-0 flex-1">
				<h3 class="text-fg-default text-sm font-medium">GitHub</h3>
				{@render statusLine('text-fg-tertiary text-xs leading-5')}
			</div>
			{@render action()}
		</div>
	{/if}

	{#if signIn.kind === 'waiting'}
		<div
			class="border-surface-150-border bg-surface-150 mt-3 flex items-center gap-2 rounded-lg border-[0.5px] py-1 pr-1 pl-3"
		>
			<code
				class="text-fg-default min-w-0 flex-1 font-mono text-base font-medium tracking-[0.2em]"
				aria-label="One-time code"
				data-testid="github-sign-in-code"
			>
				{signIn.userCode}
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
	{/if}

	{#if step}
		<div class="mt-4 flex items-center justify-end gap-3">
			{@render action()}
		</div>
	{/if}
</div>
