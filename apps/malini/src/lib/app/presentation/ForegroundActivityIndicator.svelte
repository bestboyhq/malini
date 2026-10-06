<script lang="ts">
	import { FIRST_FEEDBACK_BUDGET_MS } from '$shared/performance/first-feedback-budget';
	import { monotonicNow } from '$shared/performance/runtime-diagnostics.svelte';
	import { foregroundActivity } from '$shared/shell/foreground-activity.svelte';

	const ACTIVITY_REVEAL_DELAY_MS = FIRST_FEEDBACK_BUDGET_MS;

	let revealedActivityId = $state<number | null>(null);

	const activity = $derived(foregroundActivity.current);

	$effect(() => {
		const activityId = activity?.id ?? null;
		const startedAt = activity?.startedAt ?? null;
		revealedActivityId = null;
		if (activityId === null || startedAt === null) return;

		const remainingDelay = Math.max(0, ACTIVITY_REVEAL_DELAY_MS - (monotonicNow() - startedAt));
		const timer = setTimeout(() => {
			revealedActivityId = activityId;
		}, remainingDelay);
		return () => clearTimeout(timer);
	});

	const activityVisible = $derived(activity !== null && revealedActivityId === activity.id);
	const message = $derived(activityVisible ? (activity?.message ?? null) : null);
</script>

{#if message}
	<div
		class="foreground-activity"
		role="status"
		aria-live="polite"
		data-testid="foreground-activity-status"
	>
		<span class="foreground-activity__dot foreground-activity__pulse" aria-hidden="true"></span>
		<span class="foreground-activity__label">{message}</span>
	</div>
{/if}

<style>
	.foreground-activity {
		display: flex;
		height: 26px;
		max-width: 240px;
		align-items: center;
		gap: 6px;
		border-radius: 6px;
		background: color-mix(in srgb, var(--color-surface-150) 58%, transparent);
		padding: 0 8px;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-fg-secondary);
	}

	.foreground-activity__dot {
		height: 6px;
		width: 6px;
		flex-shrink: 0;
		border-radius: 9999px;
		background: var(--color-fg-tertiary);
	}

	.foreground-activity__pulse {
		animation: foreground-activity-pulse 1.2s ease-in-out infinite;
	}

	.foreground-activity__label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@keyframes foreground-activity-pulse {
		50% {
			opacity: 0.35;
			transform: scale(0.75);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.foreground-activity__pulse {
			animation: none;
		}
	}
</style>
