<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import type { PresenceStatus } from './presence-status';
	import Tooltip from '../tooltip/Tooltip.svelte';

	interface Props {
		status: PresenceStatus | null | undefined;
		class?: ClassValue;
	}

	let { status, class: className }: Props = $props();

	const label = $derived(statusLabel(status));
	const color = $derived(statusColor(status));

	function statusLabel(value: PresenceStatus | null | undefined): string {
		if (value === 'online') return 'Online';
		if (value === 'away') return 'Away';
		return 'Offline';
	}

	function statusColor(value: PresenceStatus | null | undefined): string {
		if (value === 'online') return 'bg-success-content';
		if (value === 'away') return 'bg-warning-content';
		return 'bg-status-idle';
	}
</script>

<Tooltip content={label} placement="top" class="shrink-0">
	<span
		class={['inline-block h-2 w-2 rounded-full', color, className]}
		role="img"
		aria-label={label}
	></span>
</Tooltip>
