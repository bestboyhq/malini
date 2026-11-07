<script lang="ts">
	import type { ShipFailure } from '$contract/pull-requests';
	import { Button } from '$hyper-ui/components/button';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import { Icon } from '$hyper-ui/icons';
	import { sendShipIntentCommand } from '$lib/pull-requests/application/commands/send-ship-intent.command';
	import { pullRequestBusyQuery } from '$lib/pull-requests/application/queries/pull-request-busy.query.svelte';
	import { codeSpans, failureNextTry, failureTries } from '$lib/pull-requests/domain/ship-failure';
	import {
		allowGithubWorkflowChangesCommand,
		cancelGithubSignInCommand,
		GitHubDeviceCode,
		githubSignInQuery,
	} from '$shared/repositories/repositories.api';

	interface Props {
		workstreamId: string;
		failure: ShipFailure;
	}

	let { workstreamId, failure }: Props = $props();

	let githubSaidOpen = $state(false);

	const busy = $derived(pullRequestBusyQuery.data);
	const reason = $derived(codeSpans(failure.reason));
	const signIn = $derived(githubSignInQuery.data);
	const allowing = $derived(signIn.kind !== 'idle' && signIn.flow === 'workflow-access');
</script>

<section {@attach avoidedByToasts} aria-label={failure.title} data-testid="ship-failure">
	<div class="px-3 py-2.5 text-xs">
		<p class="text-fg-default leading-5 break-words select-text" data-testid="ship-failure-reason">
			{#each reason as span, index (index)}{#if span.code}<code class="ship-failure-code">
						{span.text}
					</code>{:else}{span.text}{/if}{/each}
		</p>
		<p class="text-2xs text-fg-tertiary mt-1 tabular-nums">
			{failureTries(failure)} so far · {failureNextTry(failure)} · your agent reads this note too
		</p>
		{#if failure.githubSaid}
			<Button
				variant="ghost"
				size="auto"
				class="text-2xs text-fg-tertiary hover:text-fg-secondary mt-1 -ml-1 h-5 gap-1 px-1"
				ariaExpanded={githubSaidOpen}
				onclick={() => (githubSaidOpen = !githubSaidOpen)}
			>
				What GitHub said
				<Icon
					name="chevron-down"
					size={10}
					class={['transition-transform', githubSaidOpen && 'rotate-180']}
				/>
			</Button>
			{#if githubSaidOpen}
				<p
					class="text-2xs text-fg-tertiary mt-1 font-mono leading-relaxed break-words whitespace-pre-wrap select-text"
					data-testid="ship-failure-github-said"
				>
					{failure.githubSaid}
				</p>
			{/if}
		{/if}
		{#if allowing && signIn.kind === 'waiting'}
			<GitHubDeviceCode userCode={signIn.userCode} />
		{/if}
	</div>
	<div
		class="border-surface-50-border flex h-9 items-center gap-2 border-t-[0.5px] pr-1.5 pl-3 text-xs"
	>
		<span class="text-warning-content flex min-w-0 items-center gap-1.5">
			<Icon name="alert" size={12} class="shrink-0" />
			<span class="truncate">{failure.label}</span>
			<span class="text-fg-tertiary shrink-0 tabular-nums">· {failure.since}</span>
		</span>
		<div class="ml-auto flex shrink-0 items-center gap-1">
			{#if failure.stage === 'draft' && !allowing}
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onclick={() => sendShipIntentCommand('cancel-draft', workstreamId)}
				>
					Cancel draft
				</Button>
			{/if}
			{#if allowing}
				{#if signIn.kind !== 'confirming'}
					<Button variant="ghost" size="sm" onclick={cancelGithubSignInCommand}>Cancel</Button>
				{/if}
			{:else}
				<Button
					variant={failure.waitsFor === 'workflow-scope' ? 'ghost' : 'primary'}
					size="sm"
					disabled={busy}
					ariaBusy={busy}
					onclick={() => sendShipIntentCommand('retry-now', workstreamId)}
				>
					Retry now
				</Button>
			{/if}
			{#if failure.waitsFor === 'workflow-scope'}
				<Button
					variant="primary"
					size="sm"
					disabled={busy || allowing}
					loading={allowing}
					ariaBusy={allowing}
					onclick={allowGithubWorkflowChangesCommand}
				>
					Allow workflow changes
				</Button>
			{/if}
		</div>
	</div>
</section>

<style>
	.ship-failure-code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		padding: 0.1em 0.4em;
		border-radius: 0.375em;
		background: var(--color-surface-100);
		color: var(--color-fg-default);
		overflow-wrap: anywhere;
		box-decoration-break: clone;
	}
</style>
