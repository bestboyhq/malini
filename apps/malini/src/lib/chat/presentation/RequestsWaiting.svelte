<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		count: number;
		unchecked?: boolean;
		decisions?: boolean;
		onanswer: () => void;
	}

	let { count, unchecked = false, decisions = false, onanswer }: Props = $props();

	const requests = $derived(
		unchecked
			? `${count} ${count === 1 ? 'call' : 'calls'} waiting`
			: decisions
				? `${count} ${count === 1 ? 'decision waits' : 'decisions wait'} for you`
				: `${count} ${count === 1 ? 'request needs' : 'requests need'} you`,
	);
	const source = $derived(
		unchecked
			? "auto mode's safety check is down (Anthropic)"
			: decisions
				? 'the work goes on meanwhile'
				: 'from work this chat started',
	);
	const testId = $derived(
		unchecked
			? 'unchecked-calls-waiting'
			: decisions
				? 'lead-decisions-waiting'
				: 'child-requests-waiting',
	);
</script>

<div class="p-1" data-testid={testId}>
	<Button
		bare
		ariaLabel={`Answer: ${requests}`}
		class="hover:bg-surface-50-hover focus-visible:ring-border-default/50 flex h-7 w-full cursor-pointer items-center gap-2 rounded-xl pr-2 pl-2 text-left text-xs outline-none focus-visible:ring-2"
		onclick={onanswer}
	>
		<span class="text-brand-icon grid size-4 shrink-0 place-items-center" aria-hidden="true">
			<Icon name={unchecked ? 'shield-alert' : 'dot'} size={13} />
		</span>
		<span class="min-w-0 flex-1 truncate">
			<span class="text-fg-default font-medium">{requests}</span>
			<span class="text-fg-tertiary">· {source}</span>
		</span>
		<span class="text-fg-secondary shrink-0">Answer</span>
	</Button>
</div>
