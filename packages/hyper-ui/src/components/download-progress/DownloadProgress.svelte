<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		received: number;
		total: number | null;
		ariaLabel: string;
		class?: ClassValue;
	}

	const { received, total, ariaLabel, class: className }: Props = $props();

	const BYTES_PER_MB = 1_000_000;
	const receivedMb = $derived(Math.round(received / BYTES_PER_MB));
	const sizes = $derived(
		total === null ? `${receivedMb} MB` : `${receivedMb} of ${Math.round(total / BYTES_PER_MB)} MB`,
	);
	const percent = $derived(total ? Math.min(100, (received / total) * 100) : 0);
</script>

<div class={['flex items-center gap-3', className]}>
	<div
		class="bg-surface-150 h-1 min-w-0 flex-1 overflow-hidden rounded-full"
		role="progressbar"
		aria-label={ariaLabel}
		aria-valuemin="0"
		aria-valuemax={total ?? undefined}
		aria-valuenow={received}
		aria-valuetext={sizes}
	>
		<div
			class="bg-primary h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
			style:width={`${percent}%`}
		></div>
	</div>
	<span class="text-fg-tertiary min-w-24 shrink-0 text-right text-xs tabular-nums">{sizes}</span>
</div>
