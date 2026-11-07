<script lang="ts">
	import { untrack } from 'svelte';
	import type { BrainDocument } from '$contract/brain';
	import { Button } from '$hyper-ui/components/button';
	import { goto } from '$shared/router/navigation';
	import { brainHref } from '$shared/router/routes-hrefs';
	import MarkdownText from '$shared/markdown/MarkdownText.svelte';
	import { readBrainDocumentCommand } from '$lib/brain/application/commands/read-brain-document.command';
	import { setUpBrainCommand } from '$lib/brain/application/commands/set-up-brain.command';
	import { brainDocumentQuery } from '$lib/brain/application/queries/brain-document.query.svelte';
	import { brainQuery } from '$lib/brain/application/queries/brain.query.svelte';
	import {
		brainBody,
		brainCrumb,
		brainLogDayLabel,
		brainLogDayOf,
		defaultBrainPath,
		linkedLogDays,
		rewrittenLine,
		wikiLinkPath,
	} from '$lib/brain/domain/brain';

	interface Props {
		path: string | null;
		writingNotes: boolean;
		onwritenotes: () => void;
	}

	let { path, writingNotes, onwritenotes }: Props = $props();

	const brain = $derived(brainQuery.data);
	const set = $derived(brain.status?.set ?? null);
	const entries = $derived(brain.entries ?? []);
	const shown = $derived(path ?? defaultBrainPath(entries));
	const documentState = $derived(shown === null ? null : brainDocumentQuery.data(shown));

	$effect(() => {
		const reading = set ? shown : null;
		if (reading !== null) untrack(() => readBrainDocumentCommand(reading));
	});

	function openWikiLink(target: string): void {
		const linked = wikiLinkPath(target, entries);
		if (linked !== null) void goto(brainHref(linked));
	}
</script>

<div class="min-h-0 flex-1 overflow-y-auto px-16 pt-6 pb-16" data-testid="brain">
	{#if set === false}
		<section class="mx-auto w-full max-w-[720px] pt-3" aria-labelledby="brain-heading">
			<h1
				id="brain-heading"
				class="text-fg-default text-[26px] leading-9 font-medium tracking-tight"
			>
				No brain yet
			</h1>
			<p class="text-fg-tertiary mt-2 text-[15px] leading-6">
				Notes on what your chats taught you, in a private GitHub repository.
			</p>
			<Button
				class="mt-5"
				variant="primary"
				loading={brain.settingUp}
				onclick={() => setUpBrainCommand(true)}
			>
				Set up the brain
			</Button>
		</section>
	{:else if set && (shown === null || documentState?.status === 'failed')}
		<section class="mx-auto w-full max-w-[720px] pt-3" aria-labelledby="brain-heading">
			<p class="text-fg-tertiary text-sm">notes</p>
			<h1 id="brain-heading" class="text-fg-tertiary mt-1.5 text-[26px] leading-9 tracking-tight">
				Nothing here yet
			</h1>
			<p class="text-fg-secondary mt-7 text-[15px] leading-6">
				Archive a chat and it lands in the log. The weekly automation turns the log into notes.
			</p>
			<Button class="mt-4" variant="secondary" loading={writingNotes} onclick={onwritenotes}>
				Write notes now
			</Button>
		</section>
	{:else if documentState?.status === 'ready'}
		{@const opened = documentState.document}
		{@const day = brainLogDayOf(opened.path)}
		<article class="mx-auto w-full max-w-[720px] pt-3" aria-labelledby="brain-heading">
			<p class="text-fg-tertiary text-sm">{day ? 'log' : brainCrumb(opened.path)}</p>
			<h1
				id="brain-heading"
				class="text-fg-default mt-1.5 text-[26px] leading-9 font-medium tracking-tight"
			>
				{day ? brainLogDayLabel(day) : opened.title}
			</h1>
			<div class="text-fg-tertiary mt-1.5 flex flex-wrap gap-x-3.5 text-sm">
				{#if day}
					<span>Append-only. Agents never rewrite this page.</span>
				{:else}
					{@render noteMeta(opened)}
				{/if}
			</div>
			<MarkdownText
				class="text-fg-secondary mt-7 block text-[15px] leading-6 select-text"
				text={brainBody(opened.text)}
				canopenfile={() => false}
				onopenwikilink={openWikiLink}
			/>
			{#if opened.linkedFrom.length > 0}
				<section
					class="bg-surface-50 border-surface-50-border mt-9 rounded-2xl border-[0.5px] px-4.5 py-3.5"
					aria-label="Linked from"
				>
					<h2 class="text-fg-tertiary mb-1.5 text-sm">Linked from</h2>
					<ul>
						{#each opened.linkedFrom as linked (linked.path)}
							<li>
								<Button
									bare
									href={brainHref(linked.path)}
									class="text-fg-secondary hover:text-fg-default block py-0.5 text-sm"
								>
									{linked.title}
								</Button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</article>
	{/if}
</div>

{#snippet noteMeta(note: BrainDocument)}
	{@const days = linkedLogDays(note.text)}
	{@const rewritten = rewrittenLine(note.updatedAt, days.length)}
	{#if rewritten}
		<span>{rewritten}</span>
	{/if}
	{#each days as linkedDay (linkedDay)}
		<Button
			bare
			href={brainHref(`${linkedDay}.md`)}
			class="text-fg-secondary decoration-surface-150-border underline underline-offset-3"
		>
			{linkedDay}
		</Button>
	{/each}
{/snippet}
