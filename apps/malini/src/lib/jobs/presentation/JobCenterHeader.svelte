<script lang="ts">
	import { Button } from '$hyper-ui/components/button';

	interface Props {
		summary: string;
		onopen?: (() => void) | undefined;
	}

	let { summary, onopen }: Props = $props();
</script>

<div class="flex items-center gap-2 py-1 pr-1 pl-2">
	<p class="min-w-0 flex-1 truncate text-xs">
		<span class="text-fg-default font-medium">Jobs</span>
		<span class="text-fg-tertiary">· {summary}</span>
	</p>
	<Button href="/jobs" variant="ghost" size="xs" ariaLabel="Manage jobs" onclick={() => onopen?.()}>
		Manage
	</Button>
</div>
