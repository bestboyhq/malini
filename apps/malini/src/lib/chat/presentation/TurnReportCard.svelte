<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import {
		isVideoPath,
		turnStatus,
		type TurnNoteKind,
		type TurnReport,
		type TurnReportImage,
		type TurnStatus,
		type TurnVariant,
	} from '$lib/chat/domain/turn-report';
	import type { VariantPick } from '$lib/chat/domain/variant-pick';
	import type { FileMentionTarget } from './file-mention-links';
	import ImageCompare from './ImageCompare.svelte';
	import MarkdownText from './MarkdownText.svelte';
	import NextSteps from './NextSteps.svelte';
	import PickStep from './PickStep.svelte';
	import ReportNotes from './ReportNotes.svelte';
	import type { EarlierTurn } from './turn-result';
	import VariantPicker from './VariantPicker.svelte';
	import VariantPickForm from './VariantPickForm.svelte';
	import VideoCompare from './VideoCompare.svelte';
	import { reportMediaSource } from './workstream-images';

	interface Props {
		report: TurnReport;
		workstreamId: string;
		needsOpen?: boolean;
		history?: readonly EarlierTurn[];
		pick?: VariantPick | null;
		pickOf?: ((runId: string) => VariantPick | null) | undefined;
		onopenfile?: ((target: FileMentionTarget, mention: HTMLElement) => void) | undefined;
		canopenfile?: ((path: string) => boolean) | undefined;
		imagesrc?: ((path: string) => string | null) | undefined;
		onopenimage?: ((id: string) => void) | undefined;
		onpick?: ((variant: TurnVariant, reason: string) => void) | undefined;
		onnonefit?: ((reason: string) => void) | undefined;
		onsendnext?: ((step: string) => void) | undefined;
		onscratchpad?: ((step: string) => void) | undefined;
	}

	let {
		report,
		workstreamId,
		needsOpen = true,
		history = [],
		pick = null,
		pickOf,
		onopenfile,
		canopenfile,
		imagesrc,
		onopenimage,
		onpick,
		onnonefit,
		onsendnext,
		onscratchpad,
	}: Props = $props();

	const STATUS = {
		waiting: {
			icon: 'circle-dot',
			label: 'Waiting on you',
			tone: 'text-brand-foreground',
			rail: 'border-brand-foreground/40',
		},
		done: {
			icon: 'check',
			label: 'Done',
			tone: 'text-success-content',
			rail: 'border-success-content/40',
		},
	} as const satisfies Record<TurnStatus, Readonly<Record<string, string>>>;
	const NOTE_ICONS: Readonly<Record<TurnNoteKind, IconName | null>> = {
		changed: 'delta',
		verified: 'shield-check',
		next: 'chevrons-right',
		note: null,
	};
	const MAX_THUMBNAILS = 4;

	const needsHeadingId = $props.id();
	const status = $derived(STATUS[turnStatus(report, needsOpen)]);
	const nextSteps = $derived(
		report.notes.filter((note) => note.kind === 'next').map((note) => note.text),
	);
	const picking = $derived(report.variants.length > 0 && needsOpen && pick === null);
	const defaultVariantId = $derived(pick?.picked.id ?? report.variants[0]?.id ?? '');
	let chosenId = $derived(defaultVariantId);
	const chosen = $derived(
		report.variants.find((variant) => variant.id === chosenId) ?? report.variants[0] ?? null,
	);
	let selectedSrc = $state<string | null>(null);
	const hero = $derived(
		report.images.find((image) => image.src === selectedSrc) ?? report.images[0] ?? null,
	);
	const thumbnails = $derived(
		report.images.length > 1 ? report.images.slice(0, MAX_THUMBNAILS) : [],
	);
	const imagesPastThumbnails = $derived(report.images.length - thumbnails.length);
	const heroChoices = $derived(
		report.images.slice(
			0,
			report.images.length > MAX_THUMBNAILS ? MAX_THUMBNAILS - 1 : MAX_THUMBNAILS,
		),
	);

	function imageName(image: TurnReportImage): string {
		return image.alt || image.src.split('/').filter(Boolean).pop() || image.src;
	}

	function pickThumbnail(image: TurnReportImage, more: number): void {
		if (more > 0) onopenimage?.(image.src);
		else selectedSrc = image.src;
	}
</script>

{#snippet statusGlyph(glyph: (typeof STATUS)[TurnStatus], dimmed: boolean)}
	<span class={['grid h-5 shrink-0 place-items-center', glyph.tone, { 'opacity-75': dimmed }]}>
		<Icon name={glyph.icon} size={14} ariaLabel={glyph.label} />
	</span>
{/snippet}

<article
	class={[
		'bg-surface-50 flex w-full flex-col gap-2.5 rounded-l-xs rounded-r-md border-l-3 px-3 py-2.5',
		status.rail,
	]}
	aria-label="Turn result"
	data-testid="turn-report-card"
>
	<div class="flex flex-col">
		{#if history.length > 0}
			<ol class="flex flex-col pb-[5px]" aria-label="Earlier turns">
				{#each history as turn (turn.runId)}
					{@const earlierPick = pickOf?.(turn.runId) ?? null}
					<li class="turn-step relative">
						<details class="group/turn">
							<summary
								class="text-fg-tertiary hover:text-fg-secondary flex cursor-pointer list-none items-start gap-2 py-[5px] text-xs leading-5 transition-[color]"
							>
								{@render statusGlyph(STATUS[turnStatus(turn.report, false)], true)}
								<span class="turn-outcome group-open/turn:text-fg-default min-w-0">
									<MarkdownText text={turn.report.outcome ?? ''} mode="prose" class="inline" />
									{#if turn.report.notes.length > 0}
										<span class="note-count ml-1 inline-block group-open/turn:hidden">
											+{turn.report.notes.length}
										</span>
									{/if}
								</span>
							</summary>
							<ul class="flex flex-col gap-1 pb-1.5 pl-[22px] text-xs leading-5">
								{#each turn.report.notes as note, index (index)}
									{@const icon = NOTE_ICONS[note.kind]}
									<li class="text-fg-secondary flex items-start gap-1.5">
										{#if icon}
											<span class="text-fg-tertiary grid h-5 shrink-0 place-items-center">
												<Icon name={icon} size={12} />
											</span>
										{/if}
										<MarkdownText text={note.text} mode="prose" class="min-w-0 select-text" />
									</li>
								{/each}
							</ul>
						</details>
					</li>
					{#if earlierPick}
						<PickStep pick={earlierPick} {imagesrc} {onopenimage} />
					{/if}
				{/each}
			</ol>
		{/if}
		<div class="flex items-start gap-2">
			{@render statusGlyph(status, false)}
			<div
				class="text-fg-agent-message-strong min-w-0 text-base leading-5 font-medium select-text"
				data-testid="turn-report-outcome"
			>
				<MarkdownText text={report.outcome ?? ''} mode="prose" {onopenfile} {canopenfile} />
			</div>
		</div>
	</div>

	{#if report.diagrams.length > 0}
		<MarkdownText text={report.diagrams.join('\n\n')} mode="prose" class="select-text" />
	{/if}

	{#if report.comparison}
		{#if isVideoPath(report.comparison.after.src)}
			<VideoCompare comparison={report.comparison} {imagesrc} />
		{:else}
			<ImageCompare {workstreamId} comparison={report.comparison} {imagesrc} {onopenimage} />
		{/if}
	{/if}

	{#if report.variants.length > 0}
		<VariantPicker variants={report.variants} {pick} bind:chosenId {imagesrc} {onopenimage} />
	{/if}

	{#if hero}
		<div class="flex flex-col gap-1.5">
			<div class="grid">
				{#each heroChoices as image (image.src)}
					<div class={['turn-report-image col-start-1 row-start-1', { invisible: image !== hero }]}>
						<MarkdownText
							text={`![${image.alt}](${image.src})`}
							mode="prose"
							{imagesrc}
							{onopenimage}
						/>
					</div>
				{/each}
			</div>
			{#if thumbnails.length > 0}
				<div class="grid grid-cols-4 gap-1.5" role="group" aria-label="Report images">
					{#each thumbnails as image, index (image.src)}
						{@const more = index === thumbnails.length - 1 ? imagesPastThumbnails : 0}
						<Button
							bare
							class="ring-offset-surface-50 bg-surface-root aria-pressed:ring-button-primary/60 relative h-20 overflow-hidden rounded-[5px] ring-offset-2 aria-pressed:ring-[1.5px]"
							ariaLabel={more > 0
								? `Open image ${imageName(image)} and ${more} more in gallery`
								: `Show image ${imageName(image)}`}
							{...more > 0 ? {} : { ariaPressed: image === hero }}
							onclick={() => pickThumbnail(image, more)}
						>
							<img
								src={reportMediaSource(image.src, imagesrc) ?? undefined}
								alt=""
								class="outline-border-subtle size-full rounded-[5px] object-cover object-top-left outline-[0.5px] -outline-offset-[0.5px]"
							/>
							{#if more > 0}
								<span
									class="bg-surface-50/70 text-fg-agent-message-strong absolute inset-0 grid place-items-center text-base font-medium"
								>
									+{more}
								</span>
							{/if}
						</Button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<ReportNotes notes={report.notes} {onopenfile} {canopenfile} {imagesrc} {onopenimage} />

	{#if picking && chosen}
		<VariantPickForm
			{chosen}
			needs={report.needs}
			{onpick}
			{onnonefit}
			{onopenfile}
			{canopenfile}
		/>
	{:else if report.needs.length > 0}
		<section
			class={[
				'rounded-md border-[0.5px] px-2.5 py-2',
				needsOpen ? 'bg-brand/10 border-transparent' : 'border-surface-150-border',
			]}
			aria-labelledby={needsHeadingId}
		>
			<h3
				id={needsHeadingId}
				class={['text-xs font-medium', needsOpen ? 'text-brand-foreground' : 'text-fg-tertiary']}
			>
				{needsOpen ? 'Your turn' : 'You were asked'}
			</h3>
			<ul
				class={[
					'mt-1.5 flex flex-col gap-1 text-sm leading-relaxed select-text',
					needsOpen ? 'text-fg-default' : 'text-fg-tertiary',
				]}
			>
				{#each report.needs as need, index (index)}
					<li class="flex items-start gap-2">
						<span
							class={[
								'grid h-[1lh] shrink-0 place-items-center',
								needsOpen ? 'text-brand-foreground' : 'text-fg-tertiary',
							]}
							aria-hidden="true"
						>
							<Icon name="circle" size={12} />
						</span>
						<MarkdownText text={need} mode="prose" class="min-w-0" {onopenfile} {canopenfile} />
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if nextSteps.length > 0}
		<NextSteps steps={nextSteps} onsend={onsendnext} {onscratchpad} {onopenfile} {canopenfile} />
	{/if}
</article>

<style>
	.turn-report-image :global(img) {
		display: block;
		width: 100%;
		height: auto;
		max-height: 28rem;
		margin: 0;
		border: none;
		background: var(--color-surface-root);
		border-radius: 0.375rem;
		outline: 0.5px solid var(--color-border-subtle);
		outline-offset: -0.5px;
	}

	.note-count {
		flex-shrink: 0;
		margin-top: 1.5px;
		padding-inline: 0.375rem;
		border: 0.5px solid var(--color-surface-150-border);
		border-radius: 9999px;
		color: var(--color-fg-tertiary);
		font-size: var(--text-2xs);
		line-height: 1rem;
	}

	.turn-outcome :global(p) {
		display: inline;
	}

	.turn-step::after {
		position: absolute;
		top: 25px;
		bottom: -5px;
		left: 6.25px;
		width: 1.5px;
		border-radius: 9999px;
		background: var(--color-surface-150-border);
		content: '';
	}
</style>
