<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
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
	let badge: HTMLSpanElement | null = $state(null);

	const relativePath = $derived(relativizeWorkstreamPath(path));
	const fileName = $derived(relativePath.slice(relativePath.lastIndexOf('/') + 1));
</script>

<div class="w-full text-sm">
	<div class="text-fg-tertiary flex min-h-6 items-center gap-2">
		<ExpandMark {live}>
			<Icon name={icon} size={icon === 'pencil' ? 13 : 14} class="shrink-0" />
		</ExpandMark>
		<span class="shrink-0">{verb}</span>
		<span class="flex min-w-0" bind:this={badge}>
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
						{#if diffstat.removed > 0}<span class="text-error-content">
								−{diffstat.removed}
							</span>{/if}
					</span>
				{/if}
			</Button>
		</span>
		{#if durationLabel}
			<span class="text-3xs text-fg-tertiary/70 ml-auto shrink-0 font-mono tabular-nums">
				{durationLabel}
			</span>
		{/if}
	</div>
	<DropdownLayer
		{open}
		anchor={badge}
		onclose={() => (open = false)}
		side="bottom"
		align="start"
		offset={6}
		role={null}
		panelClass="border-surface-elevated-border bg-surface-elevated w-[44rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border-[0.5px]"
		testId="tool-file-preview"
		owner="agent-chat-file-preview"
	>
		{@render preview(relativePath)}
	</DropdownLayer>
</div>
