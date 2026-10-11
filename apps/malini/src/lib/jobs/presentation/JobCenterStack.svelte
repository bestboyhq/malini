<script lang="ts">
	import type { JobRunRecord } from '$contract/jobs';
	import JobCenterHeader from './JobCenterHeader.svelte';
	import JobRunRow from './JobRunRow.svelte';

	interface Props {
		active: readonly JobRunRecord[];
		finished: readonly JobRunRecord[];
		nowMs: number;
		summary: string;
	}

	let { active, finished, nowMs, summary }: Props = $props();

	const PEEKING = 3;
	const PEEK_OFFSET_PX = 7;
	const PEEK_SHRINK = 0.04;

	let hovered = $state(false);
	let focused = $state(false);

	const runs = $derived([...active, ...finished]);
	const expanded = $derived(hovered || focused);

	function onFocusOut(event: FocusEvent): void {
		const next = event.relatedTarget;
		if (next instanceof Node && event.currentTarget instanceof Node) {
			if (event.currentTarget.contains(next)) return;
		}
		focused = false;
	}

	function peekTransform(index: number): string | undefined {
		if (expanded || index === 0) return undefined;
		return `translateY(-${index * PEEK_OFFSET_PX}px) scale(${1 - index * PEEK_SHRINK})`;
	}
</script>

<div
	class="w-72"
	role="group"
	aria-label={`Jobs: ${summary}`}
	data-testid="job-center-stack"
	data-expanded={expanded ? 'true' : 'false'}
	onpointerenter={() => (hovered = true)}
	onpointerleave={() => (hovered = false)}
	onfocusin={() => (focused = true)}
	onfocusout={onFocusOut}
>
	{#if expanded}
		<div
			class="border-surface-elevated-border bg-surface-elevated mb-2 rounded-xl border-[0.5px] p-1 shadow-lg"
		>
			<JobCenterHeader {summary} />
		</div>
	{/if}
	<ul
		class={[
			'relative',
			expanded ? 'flex max-h-[var(--job-center-room)] flex-col-reverse gap-2 overflow-y-auto' : '',
		]}
		aria-label="Jobs"
	>
		{#each runs as run, index (run.id)}
			<li
				class={[
					'border-surface-elevated-border bg-surface-elevated origin-bottom rounded-xl border-[0.5px] p-1 shadow-lg transition-transform duration-200 ease-out motion-reduce:transition-none',
					!expanded && index > 0 ? 'absolute inset-0 overflow-hidden' : 'relative',
					!expanded && index >= PEEKING ? 'hidden' : '',
				]}
				style:transform={peekTransform(index)}
				style:z-index={runs.length - index}
				inert={!expanded && index > 0}
			>
				<div class={!expanded && index > 0 ? 'opacity-0' : ''}>
					<JobRunRow {run} {nowMs} />
				</div>
			</li>
		{/each}
	</ul>
</div>
