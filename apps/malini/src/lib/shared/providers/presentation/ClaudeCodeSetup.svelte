<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { onMount } from 'svelte';
	import { CLAUDE_INSTALL_COMMAND } from '$contract/agent';
	import { Button } from '$hyper-ui/components/button';
	import { CodeTokens } from '$hyper-ui/components/code-tokens';
	import { Dropdown } from '$hyper-ui/components/dropdown';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { ClaudeIcon, Icon } from '$hyper-ui/icons';
	import type { ClaudeSignInState } from '$shared/providers/domain/claude-accounts';
	import { setupStepFor, type ClaudeCodeStatus } from '$shared/providers/domain/claude-code-status';
	import { cancelClaudeSignInCommand } from '$shared/providers/application/commands/cancel-claude-sign-in.command';
	import { copyClaudeInstallCommandCommand } from '$shared/providers/application/commands/copy-claude-install-command.command';
	import { installClaudeCodeCommand } from '$shared/providers/application/commands/install-claude-code.command';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/application/commands/load-provider-capabilities.command';
	import { signInToClaudeCommand } from '$shared/providers/application/commands/sign-in-to-claude.command';
	import { watchClaudeCodeSetupHook } from '$shared/providers/application/hooks/watch-claude-code-setup.hook';
	import { claudeCodeStatusQuery } from '$shared/providers/application/queries/claude-code-status.query.svelte';
	import { claudeSignInQuery } from '$shared/providers/application/queries/claude-sign-in.query.svelte';
	import { otherClaudeAccountsQuery } from '$shared/providers/application/queries/other-claude-accounts.query.svelte';
	import ClaudeAccountSwitchItems from './ClaudeAccountSwitchItems.svelte';

	interface Props {
		step?: boolean;
		nested?: boolean;
	}

	let { step = false, nested = false }: Props = $props();
	let copied = $state(false);
	let switchOpen = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	const status = $derived(claudeCodeStatusQuery.data);
	const signIn = $derived(claudeSignInQuery.data);
	const otherAccounts = $derived(otherClaudeAccountsQuery.data);
	const setupStep = $derived(setupStepFor(status));
	const detail = $derived(signInDetail(signIn) ?? statusDetail(status));
	const actionSize = $derived(step ? 'md' : 'sm');
	const actionRadius = $derived(step ? 'full' : 'md');

	function signInDetail(current: ClaudeSignInState): string | null {
		if (current === 'switching') return 'Switching accounts…';
		if (current === 'waiting-for-browser') return 'Continue in your browser to finish signing in.';
		if (current === 'confirming') return 'Checking the new sign-in…';
		return null;
	}

	function statusDetail(current: ClaudeCodeStatus): string {
		switch (current.kind) {
			case 'checking':
				return 'Looking for Claude Code…';
			case 'missing':
				return 'Not installed on this Mac yet.';
			case 'signed-out':
				return 'Installed. Sign in with your Claude account.';
			case 'ready':
				return [
					current.account?.email ? `Signed in as ${current.account.email}` : 'Signed in',
					current.account?.plan,
					current.version ? `v${current.version}` : null,
				]
					.filter(Boolean)
					.join(' · ');
			case 'unknown':
				return `Could not check Claude Code. ${current.message}`;
		}
	}

	function onCopy(): void {
		copyClaudeInstallCommandCommand();
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1_500);
	}

	function onSwitch(email: string | null): void {
		switchOpen = false;
		signInToClaudeCommand(email);
	}

	onMount(() => {
		const stopWatching = watchClaudeCodeSetupHook();
		return () => {
			stopWatching();
			clearTimeout(copiedTimer);
		};
	});
</script>

{#snippet action()}
	{#if signIn !== 'idle'}
		<LoadingCircle size={16} />
		{#if signIn === 'waiting-for-browser'}
			<Button
				variant="secondary"
				size={actionSize}
				radius={actionRadius}
				class="shrink-0"
				ariaLabel="Cancel signing in to Claude Code"
				onclick={cancelClaudeSignInCommand}
			>
				Cancel
			</Button>
		{/if}
	{:else if status.kind === 'checking'}
		<LoadingCircle size={16} />
	{:else if status.kind === 'ready' && step}
		<span class="text-success-content flex shrink-0 items-center gap-1 text-xs font-medium">
			<Icon name="check" size={14} />
			Ready
		</span>
	{:else if status.kind === 'ready'}
		<Dropdown
			bind:open={switchOpen}
			align="end"
			panelClass="w-72"
			testId="claude-account-menu"
			owner="claude-code-setup"
		>
			{#snippet trigger()}
				<Button
					variant="secondary"
					size="sm"
					class="shrink-0"
					active={switchOpen}
					ariaLabel="Switch Claude account"
					ariaHasPopup="menu"
					ariaExpanded={switchOpen}
				>
					Switch account
				</Button>
			{/snippet}
			{#snippet content()}
				<div role="group" aria-label="Claude accounts">
					<ClaudeAccountSwitchItems others={otherAccounts} onswitch={onSwitch} />
				</div>
			{/snippet}
		</Dropdown>
	{:else if setupStep === 'install'}
		<Button
			variant="primary"
			size={actionSize}
			radius={actionRadius}
			class="shrink-0"
			ariaLabel="Install Claude Code in Terminal"
			data-testid="claude-code-setup-action"
			onclick={installClaudeCodeCommand}
		>
			Install
		</Button>
	{:else if setupStep === 'sign-in'}
		<Button
			variant="primary"
			size={actionSize}
			radius={actionRadius}
			class="shrink-0"
			ariaLabel="Sign in to Claude Code"
			data-testid="claude-code-setup-action"
			onclick={() => signInToClaudeCommand()}
		>
			Sign in
		</Button>
	{:else}
		<Button
			variant="secondary"
			size={actionSize}
			radius={actionRadius}
			class="shrink-0"
			ariaLabel="Check Claude Code again"
			onclick={() => loadProviderCapabilitiesCommand('force')}
		>
			{#snippet leading()}
				<Icon name="refresh" size={14} />
			{/snippet}
			Check again
		</Button>
	{/if}
{/snippet}

{#snippet statusLine(className: string)}
	<p class={className} role="status" data-testid="claude-code-detail">
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
	data-testid="claude-code-setup"
	data-claude-code-status={status.kind}
>
	{#if step}
		{@render statusLine('text-fg-tertiary text-sm leading-6')}
	{:else}
		<div class="flex items-center gap-3">
			<div
				class="bg-surface-150 text-fg-default grid h-9 w-9 shrink-0 place-items-center rounded-xl"
				aria-hidden="true"
			>
				<ClaudeIcon size={16} />
			</div>
			<div class="min-w-0 flex-1">
				<h3 class="text-fg-default text-sm font-medium">Claude Code</h3>
				{@render statusLine('text-fg-tertiary text-xs leading-5')}
			</div>
			{@render action()}
		</div>
	{/if}

	{#if setupStep === 'install' && signIn === 'idle'}
		<div
			class="border-surface-150-border bg-surface-150 mt-3 flex items-center gap-2 rounded-lg border-[0.5px] py-1 pr-1 pl-3"
		>
			<code class="text-fg-secondary min-w-0 flex-1 truncate font-mono text-xs">
				<span class="text-fg-tertiary select-none">$</span>
				<CodeTokens code={CLAUDE_INSTALL_COMMAND} language="shell" />
			</code>
			<Tooltip content={copied ? 'Copied' : 'Copy command'} placement="top">
				<IconButton
					variant="ghost"
					size="sm"
					ariaLabel="Copy command"
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
		</div>
		<p class="text-fg-tertiary mt-2 text-xs leading-5">
			Install runs this in Terminal. Malini notices when it’s done.
		</p>
	{:else if setupStep === 'sign-in' && signIn === 'idle'}
		<p class="text-fg-tertiary mt-2 text-xs leading-5">
			Sign in opens your browser. Malini notices when it finishes.
		</p>
	{/if}

	{#if step}
		<div class="mt-4 flex items-center justify-end gap-3">
			{@render action()}
		</div>
	{/if}
</div>
