<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatCount } from '@malini/extension-api';

	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';

	import ExtensionPanelIcon from './ExtensionPanelIcon.svelte';
	import { GUTTER_ROW_CLASS, type GutterRow } from '$shared/extensions/inspector-gutter-row';

	interface Props {
		workstreamId: string;
		rows: readonly GutterRow[];
		disabled?: boolean;
		renderIcon?: Snippet<[icon: string, size: number]> | undefined;
		footer?: Snippet | undefined;
		onopen: (panelId: string) => void;
		onaction?: ((actionId: string) => void) | undefined;
		oncontextmenu?: ((event: MouseEvent, panelId: string) => void) | undefined;
		onshow?: (() => void) | undefined;
	}

	let {
		workstreamId,
		rows,
		disabled = false,
		renderIcon,
		footer,
		onopen,
		onaction,
		oncontextmenu,
		onshow,
	}: Props = $props();
</script>

<div
	class="flex max-h-full min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto p-1.5"
	data-testid="extension-inspector-gutter"
	data-navigation-workstream-id={workstreamId}
>
	{#if onshow}
		<div class="flex h-7 shrink-0 items-center justify-end pr-0.5">
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
		</div>
	{/if}

	{#snippet rowIcon(icon: string)}
		<span class="text-fg-tertiary grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
			{#if renderIcon}{@render renderIcon(icon, 13)}{:else}<ExtensionPanelIcon
					{icon}
					size={13}
				/>{/if}
		</span>
	{/snippet}

	{#each rows as row (`${row.kind}:${row.id}`)}
		{#if row.kind === 'action'}
			<Button
				bare
				class={[GUTTER_ROW_CLASS, 'text-fg-secondary']}
				{disabled}
				data-testid="extension-inspector-gutter-action"
				data-action-id={row.id}
				onclick={() => onaction?.(row.id)}
			>
				{@render rowIcon(row.icon)}
				<span class="min-w-0 flex-1 truncate">{row.label}</span>
				{#if row.count === null}
					<span class="text-fg-tertiary shrink-0" aria-hidden="true">
						<Icon name="plus" size={11} />
					</span>
				{:else}
					<span
						class="text-2xs text-fg-tertiary shrink-0 font-mono tabular-nums"
						aria-label={`${formatCount(row.count)} ${row.count === 1 ? 'file' : 'files'}`}
					>
						{formatCount(row.count)}
					</span>
				{/if}
			</Button>
		{:else}
			<Button
				bare
				class={[GUTTER_ROW_CLASS, row.closed ? 'text-fg-tertiary' : 'text-fg-secondary']}
				{disabled}
				data-testid="extension-inspector-gutter-row"
				data-panel-id={row.id}
				data-panel-closed={row.closed ? 'true' : 'false'}
				data-navigation-local-target="extension-inspector-panel"
				data-navigation-path-id="expected-path:extension-inspector.open-panel"
				data-navigation-target-workstream-id={workstreamId}
				data-navigation-panel-id={row.id}
				onclick={() => onopen(row.id)}
				oncontextmenu={(event: MouseEvent) => oncontextmenu?.(event, row.id)}
			>
				{@render rowIcon(row.icon)}
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
					{:else if !row.closed}
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
		{/if}
	{/each}

	{#if footer}
		<div class="border-surface-50-border -mx-1.5 mt-1.5 border-t-[0.5px] px-1.5 pt-1.5">
			{@render footer()}
		</div>
	{/if}
</div>
