<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { claudeSignInProgress } from '$shared/providers/domain/claude-accounts';
	import { cancelClaudeSignInCommand } from '$shared/providers/application/commands/cancel-claude-sign-in.command';
	import { signInToClaudeCommand } from '$shared/providers/application/commands/sign-in-to-claude.command';
	import { claudeCodeStatusQuery } from '$shared/providers/application/queries/claude-code-status.query.svelte';
	import { claudeSignInQuery } from '$shared/providers/application/queries/claude-sign-in.query.svelte';
	import { otherClaudeAccountsQuery } from '$shared/providers/application/queries/other-claude-accounts.query.svelte';

	interface Props {
		class?: ClassValue;
	}

	let { class: className }: Props = $props();

	const status = $derived(claudeCodeStatusQuery.data);
	const signIn = $derived(claudeSignInQuery.data);
	const others = $derived(otherClaudeAccountsQuery.data);
	const progress = $derived(claudeSignInProgress(signIn));
</script>

<div class={['flex min-w-0 flex-col text-xs', className]}>
	<ul class="space-y-px" aria-label="Claude accounts">
		{#if status.kind === 'ready'}
			<li class="flex min-h-8 min-w-0 items-center gap-2 px-1.5 py-1" aria-current="true">
				<Icon name="check" size={14} class="text-success-content shrink-0" />
				<span class="text-fg-default min-w-0 flex-1 truncate font-medium">
					{#if status.account?.email}
						<SensitiveText text={status.account.email} />
					{:else}
						Signed in
					{/if}
				</span>
				{#if status.account?.plan}
					<span class="text-2xs text-fg-tertiary shrink-0">{status.account.plan}</span>
				{/if}
			</li>
		{/if}
		{#each others as email (email)}
			<li class="flex min-h-8 min-w-0 items-center gap-2 px-1.5 py-1">
				<span class="w-3.5 shrink-0" aria-hidden="true"></span>
				<span class="text-fg-secondary min-w-0 flex-1 truncate">
					<SensitiveText text={email} />
				</span>
				<Button
					variant="secondary"
					size="xs"
					class="shrink-0"
					ariaLabel={`Switch to ${email}`}
					disabled={signIn !== 'idle'}
					onclick={() => signInToClaudeCommand(email)}
				>
					Switch
				</Button>
			</li>
		{/each}
	</ul>
	{#if progress}
		<div class="flex min-h-8 min-w-0 items-center gap-2 px-1.5 py-1">
			<BusyIcon size={14} />
			<p class="text-fg-tertiary min-w-0 flex-1 leading-4" role="status">{progress}</p>
			{#if signIn === 'waiting-for-browser'}
				<Button
					variant="secondary"
					size="xs"
					class="shrink-0"
					ariaLabel="Cancel signing in to Claude Code"
					onclick={cancelClaudeSignInCommand}
				>
					Cancel
				</Button>
			{/if}
		</div>
	{:else}
		<Button
			bare
			class="text-fg-secondary hover:text-fg-default flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-2 px-1.5 py-1 text-left"
			onclick={() => signInToClaudeCommand()}
		>
			<Icon name="plus" size={14} class="shrink-0" />
			<span class="truncate">Add account</span>
		</Button>
	{/if}
</div>
