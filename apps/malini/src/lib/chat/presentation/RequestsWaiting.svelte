<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		count: number;
		unchecked?: boolean;
		onanswer: () => void;
	}

	let { count, unchecked = false, onanswer }: Props = $props();

	const requests = $derived(
		unchecked
			? `${count} ${count === 1 ? 'call' : 'calls'} waiting`
			: `${count} ${count === 1 ? 'request needs' : 'requests need'} you`,
	);
	const source = $derived(
		unchecked ? "auto mode's safety check is down (Anthropic)" : 'from work this chat started',
	);
</script>

<div class="p-1" data-testid={unchecked ? 'unchecked-calls-waiting' : 'child-requests-waiting'}>
	<Button
		bare
		ariaLabel={`Answer: ${requests}`}
		class="hover:bg-surface-50-hover focus-visible:ring-border-default/50 flex h-7 w-full cursor-pointer items-center gap-2 rounded-xl pr-2 pl-2 text-left text-xs outline-none focus-visible:ring-2"
		onclick={onanswer}
	>
		<span class="text-warning-content grid size-4 shrink-0 place-items-center" aria-hidden="true">
			<Icon name={unchecked ? 'shield-alert' : 'alert'} size={13} />
		</span>
		<span class="min-w-0 flex-1 truncate">
			<span class="text-fg-default font-medium">{requests}</span>
			<span class="text-fg-tertiary">· {source}</span>
		</span>
		<span class="text-fg-secondary shrink-0">Answer</span>
	</Button>
</div>
