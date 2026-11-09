<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import {
		ONBOARDING_TOOLS,
		openOnboardingTool,
		type OnboardingTool,
		type OnboardingToolStatuses,
	} from '$lib/app/domain/onboarding';
	import { ClaudeCodeSetup, claudeCodeStatusQuery } from '$shared/providers/providers.api';
	import { GitHubSetup, githubAuthQuery } from '$shared/repositories/repositories.api';

	interface Props {
		statuses: OnboardingToolStatuses;
	}

	const TITLES: Readonly<Record<OnboardingTool, string>> = {
		'claude-code': 'Claude Code',
		github: 'GitHub',
	};

	let { statuses }: Props = $props();
	let chosen = $state<OnboardingTool | null>(null);

	function signedIn(name: string | null): string {
		return name ? `Signed in as ${name}` : 'Signed in';
	}

	const open = $derived(openOnboardingTool(statuses, chosen));
	const claude = $derived(claudeCodeStatusQuery.data);
	const claudeDetail = $derived.by(() => {
		if (claude.kind === 'ready') return signedIn(claude.account?.email ?? null);
		const version = claude.kind === 'signed-out' ? claude.version : null;
		return version ? `Installed on this Mac · v${version}` : 'Installed on this Mac';
	});
	const details = $derived<Readonly<Record<OnboardingTool, string>>>({
		'claude-code': claudeDetail,
		github: signedIn(githubAuthQuery.data?.login ?? null),
	});
</script>

{#snippet marker(tool: OnboardingTool, index: number)}
	{#if statuses[tool] === 'ready'}
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
				open === tool ? 'text-fg-secondary' : 'text-fg-tertiary',
			]}
			aria-hidden="true"
		>
			{#if statuses[tool] === 'checking' && open === null}
				<BusyIcon size={14} class="text-fg-secondary" />
			{:else}
				{index + 1}
			{/if}
		</span>
	{/if}
{/snippet}

<ol
	class="border-surface-50-border divide-surface-50-border divide-y-[0.5px] rounded-2xl border-[0.5px]"
	aria-label="Tools"
>
	{#each ONBOARDING_TOOLS as tool, index (tool)}
		{@const expanded = open === tool}
		{@const ready = statuses[tool] === 'ready'}
		<li>
			<h2>
				{#if ready}
					<div class="flex min-h-15 items-center gap-3 px-4">
						{@render marker(tool, index)}
						<span class="text-fg-default text-[15px] font-medium">{TITLES[tool]}</span>
						<span class="text-fg-tertiary ml-auto min-w-0 truncate text-sm">
							<SensitiveText text={details[tool]} />
						</span>
					</div>
				{:else}
					<Button
						bare
						class={[
							'group/tool focus-visible:ring-border-default/50 flex min-h-15 w-full cursor-pointer items-center gap-3 rounded-2xl px-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset',
							expanded ? 'cursor-default' : undefined,
						]}
						ariaExpanded={expanded}
						ariaControls="onboarding-tool-{tool}"
						onclick={() => (chosen = tool)}
					>
						{@render marker(tool, index)}
						<span
							class={[
								'text-[15px] font-medium transition-[color] duration-150',
								expanded
									? 'text-fg-default'
									: 'text-fg-tertiary group-hover/tool:text-fg-secondary',
							]}
						>
							{TITLES[tool]}
						</span>
					</Button>
				{/if}
			</h2>
			<div
				id="onboarding-tool-{tool}"
				class={[
					'grid transition-[grid-template-rows,visibility] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
					expanded ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]',
				]}
			>
				<div class="min-h-0 overflow-hidden">
					<div class="pr-4 pb-5 pl-14">
						{#if tool === 'claude-code'}
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
