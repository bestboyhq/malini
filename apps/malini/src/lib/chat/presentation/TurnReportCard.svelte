<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import type { TurnReport } from '$lib/chat/domain/turn-report';
	import type { FileMentionTarget } from './file-mention-links';
	import MarkdownText from './MarkdownText.svelte';

	interface Props {
		report: TurnReport;
		needsOpen?: boolean;
		onopenfile?: ((target: FileMentionTarget, mention: HTMLElement) => void) | undefined;
		canopenfile?: ((path: string) => boolean) | undefined;
		imagesrc?: ((path: string) => string | null) | undefined;
		onopenimage?: ((id: string) => void) | undefined;
	}

	let {
		report,
		needsOpen = true,
		onopenfile,
		canopenfile,
		imagesrc,
		onopenimage,
	}: Props = $props();

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
			class={[
				'rounded-md px-2.5 py-2',
				needsOpen ? 'bg-brand/10' : 'border-surface-150-border border-[0.5px]',
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
						<span class="min-w-0">{need}</span>
					</li>
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
