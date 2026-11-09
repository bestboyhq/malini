<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { Button } from '$hyper-ui/components/button';
	import { DownloadProgress } from '$hyper-ui/components/download-progress';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { BusyIcon, GitHubIcon, Icon } from '$hyper-ui/icons';
	import { cancelGithubSignInCommand } from '$shared/repositories/application/commands/cancel-github-sign-in.command';
	import { installGithubCliCommand } from '$shared/repositories/application/commands/install-github-cli.command';
	import { loadGithubAuthCommand } from '$shared/repositories/application/commands/load-github-auth.command';
	import { signInToGithubCommand } from '$shared/repositories/application/commands/sign-in-to-github.command';
	import { watchGithubAuthHook } from '$shared/repositories/application/hooks/watch-github-auth.hook';
	import { githubAuthErrorQuery } from '$shared/repositories/application/queries/github-auth-error.query.svelte';
	import { githubAuthQuery } from '$shared/repositories/application/queries/github-auth.query.svelte';
	import { githubCliInstallQuery } from '$shared/repositories/application/queries/github-cli-install.query.svelte';
	import { githubSignInQuery } from '$shared/repositories/application/queries/github-sign-in.query.svelte';
	import { githubSetupStatus } from '$shared/repositories/domain/github-auth';
	import GitHubDeviceCode from './GitHubDeviceCode.svelte';

	interface Props {
		step?: boolean;
		nested?: boolean;
		marker?: Snippet;
	}

	let { step = false, nested = false, marker }: Props = $props();

	const auth = $derived(githubAuthQuery.data);
	const authError = $derived(githubAuthErrorQuery.data);
	const signIn = $derived(githubSignInQuery.data);
	const install = $derived(githubCliInstallQuery.data);
	const status = $derived(githubSetupStatus(auth, authError));
	const download = $derived(
		status === 'missing' && install.kind === 'installing' ? install.progress : null,
	);
	const downloaded = $derived(
		download !== null && download.total !== null && download.received >= download.total,
	);
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
				return missingDetail();
			case 'unknown':
				return `Could not check GitHub. ${authError ?? ''}`.trim();
			case 'signed-out':
				return 'Connect to work on your repositories.';
			case 'ready':
				return auth?.login ? `Signed in as ${auth.login}` : 'Signed in';
		}
	});

	function missingDetail(): string {
		switch (install.kind) {
			case 'installing':
				return downloaded ? 'Setting up the GitHub CLI…' : 'Downloading the GitHub CLI…';
			case 'failed':
				return install.message;
			case 'idle':
				return 'The GitHub CLI is not on this Mac.';
		}
	}

	onMount(() => watchGithubAuthHook());
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
			onclick={() => signInToGithubCommand()}
		>
			Connect
		</Button>
	{:else if status === 'missing' && install.kind === 'installing'}
		{#if !download || downloaded}
			<BusyIcon size={16} />
		{/if}
	{:else if status === 'missing' && install.kind === 'failed'}
		<Button
			variant="secondary"
			size={actionSize}
			radius={actionRadius}
			class="shrink-0"
			ariaLabel="Try installing the GitHub CLI again"
			onclick={installGithubCliCommand}
		>
			{#snippet leading()}
				<Icon name="refresh" size={14} />
			{/snippet}
			Try again
		</Button>
	{:else if status === 'missing'}
		<Button
			variant="primary"
			size={actionSize}
			radius={actionRadius}
			class="shrink-0"
			ariaLabel="Install the GitHub CLI"
			onclick={installGithubCliCommand}
		>
			Install
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

{#snippet downloadBar(className: ClassValue)}
	{#if download}
		<DownloadProgress
			class={className}
			received={download.received}
			total={download.total}
			ariaLabel="GitHub CLI download"
		/>
	{/if}
{/snippet}

{#snippet statusLine(className: ClassValue)}
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
	<div class="flex items-center gap-3">
		{#if marker}
			{@render marker()}
		{:else}
			<div
				class="bg-surface-150 text-fg-default grid h-9 w-9 shrink-0 place-items-center rounded-xl"
				aria-hidden="true"
			>
				<GitHubIcon size={17} />
			</div>
		{/if}
		<div class="min-w-0 flex-1">
			<svelte:element
				this={step ? 'h2' : 'h3'}
				class={['text-fg-default font-medium', step ? 'text-[15px]' : 'text-sm']}
			>
				GitHub
			</svelte:element>
			{@render statusLine(['text-fg-tertiary leading-5', step ? 'text-[13px]' : 'text-xs'])}
		</div>
		{@render action()}
	</div>
	<div class={step ? 'pl-10' : undefined}>
		{@render downloadBar('mt-3')}
		{#if signIn.kind === 'waiting'}
			<GitHubDeviceCode userCode={signIn.userCode} />
		{/if}
	</div>
</div>
