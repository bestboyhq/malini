<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import {
		ONBOARDING_ACCOUNTS,
		openOnboardingAccount,
		type OnboardingAccount,
		type OnboardingAccountStatuses,
	} from '$lib/app/domain/onboarding';
	import { ClaudeCodeSetup, claudeCodeStatusQuery } from '$shared/providers/providers.api';
	import { GitHubSetup, githubAuthQuery } from '$shared/repositories/repositories.api';

	interface Props {
		statuses: OnboardingAccountStatuses;
	}

	const TITLES: Readonly<Record<OnboardingAccount, string>> = {
		'claude-code': 'Claude Code',
		github: 'GitHub',
	};

	let { statuses }: Props = $props();
	let chosen = $state<OnboardingAccount | null>(null);

	const open = $derived(openOnboardingAccount(statuses, chosen));
	const claude = $derived(claudeCodeStatusQuery.data);
	const accountNames = $derived<Readonly<Record<OnboardingAccount, string | null>>>({
		'claude-code': claude.kind === 'ready' ? (claude.account?.email ?? null) : null,
		github: githubAuthQuery.data?.login ?? null,
	});
</script>

{#snippet marker(account: OnboardingAccount, index: number)}
	{#if statuses[account] === 'ready'}
		<span
			class="bg-success text-success-content grid size-7 shrink-0 place-items-center rounded-full"
			aria-hidden="true"
		>
			<Icon name="check" size={14} />
		</span>
	{:else}
		<span
			class={[
				'border-surface-50-border grid size-7 shrink-0 place-items-center rounded-full border-[0.5px] text-xs tabular-nums',
				open === account ? 'text-fg-secondary' : 'text-fg-tertiary',
			]}
			aria-hidden="true"
		>
			{#if statuses[account] === 'checking' && open === null}
				<BusyIcon size={14} class="text-fg-secondary" />
			{:else}
				{index + 1}
			{/if}
		</span>
	{/if}
{/snippet}

<ol
	class="border-surface-50-border divide-surface-50-border divide-y-[0.5px] rounded-2xl border-[0.5px]"
	aria-label="Accounts"
>
	{#each ONBOARDING_ACCOUNTS as account, index (account)}
		{@const expanded = open === account}
		{@const ready = statuses[account] === 'ready'}
		{@const accountName = accountNames[account]}
		<li>
			<h2>
				{#if ready}
					<div class="flex min-h-15 items-center gap-3 px-4">
						{@render marker(account, index)}
						<span class="text-fg-default text-[15px] font-medium">{TITLES[account]}</span>
						<span class="text-fg-tertiary ml-auto min-w-0 truncate text-sm">
							<SensitiveText text={accountName ? `Signed in as ${accountName}` : 'Signed in'} />
						</span>
					</div>
				{:else}
					<Button
						bare
						class={[
							'group/account focus-visible:ring-border-default/50 flex min-h-15 w-full cursor-pointer items-center gap-3 rounded-2xl px-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset',
							expanded ? 'cursor-default' : undefined,
						]}
						ariaExpanded={expanded}
						ariaControls="onboarding-account-{account}"
						onclick={() => (chosen = account)}
					>
						{@render marker(account, index)}
						<span
							class={[
								'text-[15px] font-medium transition-[color] duration-150',
								expanded
									? 'text-fg-default'
									: 'text-fg-tertiary group-hover/account:text-fg-secondary',
							]}
						>
							{TITLES[account]}
						</span>
					</Button>
				{/if}
			</h2>
			<div
				id="onboarding-account-{account}"
				class={[
					'grid transition-[grid-template-rows,visibility] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
					expanded ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]',
				]}
			>
				<div class="min-h-0 overflow-hidden">
					<div class="pr-4 pb-5 pl-14">
						{#if account === 'claude-code'}
							<ClaudeCodeSetup step />
						{:else}
							<GitHubSetup step />
						{/if}
					</div>
				</div>
			</div>
		</li>
	{/each}
</ol>
