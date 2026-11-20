<script lang="ts">
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import type { DependencyState, WorkstreamDot } from '$lib/initiatives/domain/initiative';

	type Status = DependencyState | WorkstreamDot;

	interface Props {
		status: Status;
		size: number;
		label?: string;
	}

	let { status, size, label }: Props = $props();

	const GLYPH: Readonly<Record<Exclude<Status, 'running'>, IconName>> = {
		todo: 'circle',
		done: 'check',
		merged: 'pr-merged',
		needs: 'dot',
		failed: 'pr-failed',
		idle: 'branch',
		archived: 'archive',
	};

	const TONE: Readonly<Record<Status, string>> = {
		todo: 'text-fg-quaternary',
		done: 'text-fg-tertiary',
		merged: 'text-merged-content',
		needs: 'text-brand-icon',
		failed: 'text-error-content',
		running: 'text-fg-secondary',
		idle: 'text-fg-tertiary',
		archived: 'text-fg-tertiary',
	};

	const named = $derived(label === undefined ? {} : { ariaLabel: label });
</script>

<span class={['flex shrink-0', TONE[status]]}>
	{#if status === 'running'}
		<BusyIcon {size} {...named} />
	{:else}
		<Icon name={GLYPH[status]} {size} {...named} />
	{/if}
</span>
