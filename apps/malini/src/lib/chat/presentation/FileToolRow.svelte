<script lang="ts">
	import type { Snippet } from 'svelte';
	import { quartOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { slide } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import type { EditDiffstat } from './edit-diffstat';
	import ExpandMark from './ExpandMark.svelte';
	import { CHIP_CLASS } from './inline-prompt-chips';
	import { relativizeWorkstreamPath } from './workstream-path';

	interface Props {
		verb: string;
		icon: 'pencil' | 'note';
		path: string;
		previewName: string;
		live?: boolean;
		diffstat?: EditDiffstat | null;
		durationLabel?: string | null;
		preview: Snippet<[string]>;
	}

	let {
		verb,
		icon,
		path,
		previewName,
		live = false,
		diffstat = null,
		durationLabel = null,
		preview,
	}: Props = $props();

	let open = $state(false);

	const relativePath = $derived(relativizeWorkstreamPath(path));
	const fileName = $derived(relativePath.slice(relativePath.lastIndexOf('/') + 1));
</script>

<div class="w-full text-sm">
	<div class="text-fg-tertiary flex min-h-6 items-center gap-2">
		<ExpandMark {live}>
			<Icon name={icon} size={icon === 'pencil' ? 13 : 14} class="shrink-0" />
		</ExpandMark>
		<span class="shrink-0">{verb}</span>
		<Button
			bare
			class={[
				CHIP_CLASS,
				'hover:bg-chip-hover aria-expanded:bg-chip-hover focus-visible:ring-button-primary/40 cursor-pointer focus-visible:ring-2 focus-visible:outline-none',
			]}
			ariaLabel={`${open ? 'Hide' : 'Show'} ${previewName} ${relativePath}`}
			ariaExpanded={open}
			data-testid="tool-file-toggle"
			onclick={() => (open = !open)}
		>
			<FileTypeIcon path={relativePath} size={12} />
			<span class="truncate"><SensitiveText text={fileName} /></span>
			{#if diffstat}
				<span
					class="text-3xs shrink-0 font-mono tabular-nums"
					data-testid="tool-card-diffstat"
					aria-label={`${diffstat.added} ${diffstat.added === 1 ? 'line' : 'lines'} added, ${diffstat.removed} ${diffstat.removed === 1 ? 'line' : 'lines'} removed`}
				>
					{#if diffstat.added > 0}<span class="text-success-content">+{diffstat.added}</span>{/if}
					{#if diffstat.removed > 0}<span class="text-error-content">−{diffstat.removed}</span>{/if}
				</span>
			{/if}
		</Button>
		{#if durationLabel}
			<span class="text-3xs text-fg-tertiary/70 ml-auto shrink-0 font-mono tabular-nums">
				{durationLabel}
			</span>
		{/if}
	</div>
	{#if open}
		<div
			class="ml-5.5 pt-1"
			transition:slide={{ duration: prefersReducedMotion.current ? 0 : 240, easing: quartOut }}
		>
			<div class="border-surface-50-border overflow-hidden rounded-lg border-[0.5px]">
				{@render preview(relativePath)}
			</div>
		</div>
	{/if}
</div>
