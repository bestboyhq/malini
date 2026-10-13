<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import type { TurnReport } from '$lib/chat/domain/turn-report';
	import type { FileMentionTarget } from './file-mention-links';
	import MarkdownText from './MarkdownText.svelte';

	interface Props {
		report: TurnReport;
		onopenfile?: ((target: FileMentionTarget, mention: HTMLElement) => void) | undefined;
		canopenfile?: ((path: string) => boolean) | undefined;
		imagesrc?: ((path: string) => string | null) | undefined;
		onopenimage?: ((id: string) => void) | undefined;
	}

	let { report, onopenfile, canopenfile, imagesrc, onopenimage }: Props = $props();

	const needsHeadingId = $props.id();
	const images = $derived(report.images.map(({ alt, src }) => `![${alt}](${src})`).join('\n\n'));
	const shipped = $derived(report.commit !== null || report.pullRequest !== null);
</script>

<article
	class="bg-surface-50 flex w-full flex-col gap-2.5 rounded-md px-3 py-2.5"
	aria-label="Turn result"
	data-testid="turn-report-card"
>
	{#if images}
		<div class="turn-report-images">
			<MarkdownText text={images} mode="prose" {imagesrc} {onopenimage} />
		</div>
	{/if}

	<p
		class="text-fg-agent-message-strong text-base leading-snug font-medium select-text"
		data-testid="turn-report-outcome"
	>
		{report.outcome}
	</p>

	{#if report.needs.length > 0}
		<section
			class="border-warning-content/25 bg-warning text-warning-content rounded-md border-[0.5px] px-2.5 py-2"
			aria-labelledby={needsHeadingId}
		>
			<h3 id={needsHeadingId} class="text-2xs font-medium tracking-wider uppercase">Needs you</h3>
			<ul class="mt-1 flex flex-col gap-0.5 text-sm leading-relaxed select-text">
				{#each report.needs as need, index (index)}
					<li>{need}</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if report.details}
		<details class="group/details text-fg-tertiary w-full text-sm">
			<summary
				class="hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
			>
				<span class="grid h-3.5 w-3.5 shrink-0 place-items-center" aria-hidden="true">
					<Icon
						name="chevron-right"
						size={10}
						class="transition-transform duration-150 group-open/details:rotate-90"
					/>
				</span>
				<span>Details</span>
			</summary>
			<div
				class="text-fg-agent-message pt-1 pb-1 pl-[1.375rem] leading-relaxed select-text"
				data-testid="turn-report-details"
			>
				<MarkdownText
					text={report.details}
					mode="prose"
					{onopenfile}
					{canopenfile}
					{imagesrc}
					{onopenimage}
				/>
			</div>
		</details>
	{/if}

	{#if shipped}
		<p
			class="border-surface-150-border text-2xs text-fg-tertiary flex flex-wrap gap-x-3 gap-y-0.5 border-t pt-2.5 select-text"
			data-testid="turn-report-shipping"
		>
			{#if report.commit}
				<span>
					Commit <span class="text-fg-secondary">{report.commit}</span>
				</span>
			{/if}
			{#if report.pullRequest}
				<span>
					Pull request <span class="text-fg-secondary">{report.pullRequest}</span>
				</span>
			{/if}
		</p>
	{/if}
</article>

<style>
	.turn-report-images :global(img) {
		display: block;
		max-height: 28rem;
		border-radius: 0.375rem;
	}
</style>
