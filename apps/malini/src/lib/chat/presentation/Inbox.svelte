<script lang="ts">
	import { onMount } from 'svelte';
	import { Icon } from '$hyper-ui/icons';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { inboxQuery } from '$lib/chat/application/queries/inbox.query.svelte';
	import type { InboxEntry } from '$lib/chat/domain/inbox';
	import InboxRow from './InboxRow.svelte';

	const MINUTE_MS = 60_000;

	const inbox = $derived(inboxQuery.data);
	const empty = $derived(inbox.needsYou.length === 0 && inbox.done.length === 0);
	const sectionId = $props.id();
	let now = $state(Date.now());

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), MINUTE_MS);
		return () => clearInterval(timer);
	});
</script>

{#snippet section(key: string, heading: string, entries: readonly InboxEntry[])}
	{#if entries.length > 0}
		<section class="mt-8" aria-labelledby={`${sectionId}-${key}`}>
			<h2 id={`${sectionId}-${key}`} class="text-fg-default text-sm font-medium">
				{heading}
				<span class="text-fg-tertiary font-normal">({entries.length})</span>
			</h2>
			<ul
				class="border-surface-50-border bg-surface-50 divide-surface-50-border mt-3 divide-y-[0.5px] overflow-hidden rounded-2xl border-[0.5px]"
			>
				{#each entries as entry (`${entry.workstreamId}:${entry.attention.runId}:${entry.attention.kind}`)}
					<InboxRow {entry} {now} />
				{/each}
			</ul>
		</section>
	{/if}
{/snippet}

<div class="text-fg-default h-full w-full flex-1 overflow-y-auto" data-testid="inbox-page">
	<div class="mx-auto flex w-full max-w-[640px] flex-col px-6 pt-20 pb-16">
		<header>
			<h1 class="text-fg-default text-xl font-semibold tracking-tight">Inbox</h1>
			<p class="text-fg-tertiary mt-1 text-sm">
				Turns that finished while you were elsewhere, across every repository.
			</p>
		</header>

		{#if empty}
			<div
				class="border-border-subtle mt-8 flex items-center justify-center rounded-2xl border border-dashed"
			>
				<StateBlock
					heading="You're all caught up"
					detail="A turn that finishes while you look elsewhere lands here."
					testId="inbox-empty"
				>
					{#snippet icon()}
						<Icon name="inbox" size={20} />
					{/snippet}
				</StateBlock>
			</div>
		{:else}
			{@render section('needs-you', 'Needs you', inbox.needsYou)}
			{@render section('done', 'Done', inbox.done)}
		{/if}
	</div>
</div>
