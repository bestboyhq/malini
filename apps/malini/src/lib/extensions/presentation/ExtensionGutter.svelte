<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatCount } from '@malini/extension-api';

	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';

	import ExtensionPanelIcon from './ExtensionPanelIcon.svelte';
	import type { GutterRow } from '$shared/extensions/inspector-gutter-row';

	interface Props {
		workstreamId: string;
		workstreamName?: string | null;
		rows: readonly GutterRow[];
		disabled?: boolean;
		renderIcon?: Snippet<[icon: string, size: number]>;
		onopen: (panelId: string) => void;
		onshow: () => void;
	}

	let {
		workstreamId,
		workstreamName = null,
		rows,
		disabled = false,
		renderIcon,
		onopen,
		onshow,
	}: Props = $props();
</script>

<div
	class="extension-gutter flex max-h-full min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto py-1.5 pr-2 pl-1"
	data-testid="extension-inspector-gutter"
	data-navigation-workstream-id={workstreamId}
>
	<div class="flex h-7 shrink-0 items-center gap-1 pr-0.5 pl-2">
		<span class="text-fg-tertiary min-w-0 flex-1 truncate text-xs font-medium">
			{#if workstreamName}On {workstreamName}{/if}
		</span>
		<span class="extension-gutter__show shrink-0">
			<Tooltip content="Show inspector" placement="left">
				<IconButton
					ariaLabel="Show inspector"
					variant="ghost"
					size="sm"
					ariaExpanded={false}
					data-testid="extension-inspector-show"
					onclick={onshow}
				>
					<Icon name="chevron-left" size={12} />
				</IconButton>
			</Tooltip>
		</span>
	</div>

	{#each rows as row (row.panelId)}
		<Button
			bare
			class={[
				'hover:bg-surface-100-hover hover:text-fg-default focus-visible:bg-surface-100-hover focus-visible:ring-border-default/50 flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40',
				row.closed ? 'text-fg-tertiary' : 'text-fg-secondary',
			]}
			{disabled}
			data-testid="extension-inspector-gutter-row"
			data-panel-id={row.panelId}
			data-panel-closed={row.closed ? 'true' : 'false'}
			data-navigation-local-target="extension-inspector-panel"
			data-navigation-path-id="expected-path:extension-inspector.open-panel"
			data-navigation-target-workstream-id={workstreamId}
			data-navigation-panel-id={row.panelId}
			onclick={() => onopen(row.panelId)}
		>
			<span class="text-fg-tertiary grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
				{#if renderIcon}{@render renderIcon(row.icon, 13)}{:else}<ExtensionPanelIcon
						icon={row.icon}
						size={13}
					/>{/if}
			</span>
			<span class="min-w-0 flex-1 truncate">{row.label}</span>
			{#if row.changeTotals}
				{@const { additions, deletions } = row.changeTotals}
				{#if additions > 0 || deletions > 0}
					<span
						class="text-2xs shrink-0 font-mono tabular-nums"
						aria-label={`${formatCount(additions)} additions, ${formatCount(deletions)} deletions`}
						data-testid="extension-inspector-gutter-diffstat"
					>
						{#if additions > 0}<span class="text-success-content">
								+{formatCount(additions)}
							</span>{/if}
						{#if deletions > 0}<span class="text-error-content ml-1">
								−{formatCount(deletions)}
							</span>{/if}
					</span>
				{:else}
					<span
						class="text-2xs text-fg-tertiary shrink-0 font-mono tabular-nums"
						aria-label="No changes"
						data-testid="extension-inspector-gutter-diffstat"
					>
						—
					</span>
				{/if}
			{/if}
			{#if row.closed}
				<span
					class="text-fg-tertiary shrink-0"
					aria-label="Closed"
					data-testid="extension-inspector-gutter-closed"
				>
					<Icon name="plus" size={11} />
				</span>
			{/if}
		</Button>
	{/each}
</div>

<style>
	.extension-gutter__show {
		opacity: 0;

		transition: opacity var(--default-transition-duration) ease;
	}

	.extension-gutter:hover .extension-gutter__show,
	.extension-gutter:focus-within .extension-gutter__show {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.extension-gutter__show {
			transition: none;
		}
	}
</style>
