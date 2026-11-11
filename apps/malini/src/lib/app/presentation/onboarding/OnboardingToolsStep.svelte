<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import {
		ONBOARDING_TOOLS,
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

	function signedIn(name: string | null): string {
		return name ? `Signed in as ${name}` : 'Signed in';
	}

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

{#snippet number(index: number)}
	<span
		class="border-surface-50-border text-fg-secondary grid size-7 shrink-0 place-items-center rounded-full border-[0.5px] text-xs tabular-nums"
		aria-hidden="true"
	>
		{index + 1}
	</span>
{/snippet}

<ol
	class="border-surface-50-border divide-surface-50-border divide-y-[0.5px] rounded-2xl border-[0.5px]"
	aria-label="Tools"
>
	{#each ONBOARDING_TOOLS as tool, index (tool)}
		<li>
			{#if statuses[tool] === 'ready'}
				<h2 class="flex min-h-15 items-center gap-3 px-4">
					<span
						class="bg-success text-success-content grid size-7 shrink-0 place-items-center rounded-full"
						aria-hidden="true"
					>
						<Icon name="check" size={14} />
					</span>
					<span class="text-fg-default text-[15px] font-medium">{TITLES[tool]}</span>
					<span class="text-fg-tertiary ml-auto min-w-0 truncate text-sm">
						<SensitiveText text={details[tool]} />
					</span>
				</h2>
			{:else}
				<div class="px-4 py-3.5">
					{#if tool === 'claude-code'}
						<ClaudeCodeSetup step>
							{#snippet marker()}
								{@render number(index)}
							{/snippet}
						</ClaudeCodeSetup>
					{:else}
						<GitHubSetup step>
							{#snippet marker()}
								{@render number(index)}
							{/snippet}
						</GitHubSetup>
					{/if}
				</div>
			{/if}
		</li>
	{/each}
</ol>
