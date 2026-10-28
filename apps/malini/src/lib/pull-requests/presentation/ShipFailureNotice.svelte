<script lang="ts">
	import type { ShipFailure } from '$contract/pull-requests';
	import { Button } from '$hyper-ui/components/button';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import { Icon } from '$hyper-ui/icons';
	import { sendShipIntentCommand } from '$lib/pull-requests/application/commands/send-ship-intent.command';
	import { pullRequestBusyQuery } from '$lib/pull-requests/application/queries/pull-request-busy.query.svelte';
	import { codeSpans, failureNextTry, failureTries } from '$lib/pull-requests/domain/ship-failure';

	interface Props {
		workstreamId: string;
		failure: ShipFailure;
	}

	let { workstreamId, failure }: Props = $props();

	let githubSaidOpen = $state(false);

	const busy = $derived(pullRequestBusyQuery.data);
	const reason = $derived(codeSpans(failure.reason));
</script>

<section
	{@attach avoidedByToasts}
	class="flex items-start gap-2.5 py-2.5 pr-2 pl-3 text-xs"
	aria-label={failure.title}
	data-testid="ship-failure"
>
	<span
		class="text-warning-content mt-0.5 grid size-4 shrink-0 place-items-center"
		aria-hidden="true"
	>
		<Icon name="alert" size={13} />
	</span>
	<div class="min-w-0 flex-1">
		<p class="leading-5">
			<span class="text-fg-default font-medium">{failure.title}</span>
			<span class="text-fg-tertiary tabular-nums">· {failure.since}</span>
		</p>
		<p
			class="text-fg-secondary leading-5 break-words select-text"
			data-testid="ship-failure-reason"
		>
			{#each reason as span, index (index)}{#if span.code}<code class="ship-failure-code">
						{span.text}
					</code>{:else}{span.text}{/if}{/each}
		</p>
		<p class="text-2xs text-fg-tertiary mt-1 tabular-nums">
			{failureTries(failure)} so far · {failureNextTry(failure)} · your agent reads this note too
		</p>
		<div class="mt-2 flex items-center gap-1.5">
			<Button
				variant="secondary"
				size="sm"
				disabled={busy}
				ariaBusy={busy}
				onclick={() => sendShipIntentCommand('retry-now', workstreamId)}
			>
				Retry now
			</Button>
			{#if failure.stage === 'draft'}
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onclick={() => sendShipIntentCommand('cancel-draft', workstreamId)}
				>
					Cancel draft
				</Button>
			{/if}
			{#if failure.githubSaid}
				<Button
					variant="ghost"
					size="sm"
					class="ml-auto"
					ariaExpanded={githubSaidOpen}
					onclick={() => (githubSaidOpen = !githubSaidOpen)}
				>
					What GitHub said
					{#snippet trailing()}
						<Icon
							name="chevron-down"
							size={12}
							class={['transition-transform', githubSaidOpen && 'rotate-180']}
						/>
					{/snippet}
				</Button>
			{/if}
		</div>
		{#if failure.githubSaid && githubSaidOpen}
			<p
				class="text-2xs text-fg-tertiary mt-1.5 font-mono leading-relaxed break-words whitespace-pre-wrap select-text"
				data-testid="ship-failure-github-said"
			>
				{failure.githubSaid}
			</p>
		{/if}
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
