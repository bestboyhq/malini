<script lang="ts">
	import type { PromptChipPreview } from './prompt-chip-preview';

	interface Props {
		preview: PromptChipPreview;
	}

	let { preview }: Props = $props();

	const META_CLASS = 'truncate text-2xs text-fg-tertiary';
	const CAPTION_CLASS = 'truncate text-2xs text-fg-secondary';
</script>

{#if preview}
	<div
		data-testid="chat-composer-chip-preview"
		data-preview-kind={preview.kind}
		class="border-surface-elevated-border bg-surface-elevated shadow-popup max-w-80 overflow-hidden rounded-lg border-[0.5px] p-2"
	>
		{#if preview.kind === 'image'}
			<img
				src={preview.src}
				alt={preview.title}
				class="bg-surface-50 block max-h-[200px] w-full max-w-[320px] rounded-md object-contain"
			/>
			<div class="text-fg-default mt-1.5 truncate text-xs">{preview.title}</div>
			<div class={META_CLASS}>{preview.meta}</div>
		{:else if preview.kind === 'file'}
			<div class="text-fg-default truncate text-xs">{preview.title}</div>
			<div class={META_CLASS}>{preview.meta}</div>
		{:else if preview.kind === 'lines'}
			<div class={CAPTION_CLASS}>{preview.title}</div>
			<div class="mt-1">
				{#each preview.lines as line, index (index)}
					<div class={['text-2xs truncate', index === 0 ? 'text-fg-default' : 'text-fg-tertiary']}>
						{line}
					</div>
				{/each}
			</div>
		{:else}
			<div class={CAPTION_CLASS}>{preview.title}</div>
			<pre
				class="bg-surface-50 text-3xs leading-code text-fg-secondary mt-1 max-h-[12.4em] overflow-hidden rounded-md px-2 py-1.5 font-mono break-words whitespace-pre-wrap">{preview.code}</pre>
			{#if preview.meta}
				<div class="mt-1 {META_CLASS}">{preview.meta}</div>
			{/if}
		{/if}
	</div>
{/if}
