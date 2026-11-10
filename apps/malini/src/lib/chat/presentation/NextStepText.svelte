<script lang="ts">
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import type { FileMentionTarget } from '$shared/markdown/file-mention-links';
	import MarkdownText from '$shared/markdown/MarkdownText.svelte';
	import { clippedText } from './clipped-text';

	interface Props {
		text: string;
		onopenfile?: ((target: FileMentionTarget, mention: HTMLElement) => void) | undefined;
		canopenfile?: ((path: string) => boolean) | undefined;
	}

	let { text, onopenfile, canopenfile }: Props = $props();

	let line: HTMLElement | undefined = $state();
	let width = $state(0);
	let rest = $state('');

	$effect(() => {
		void [text, width];
		rest = line ? clippedText(line) : '';
	});
</script>

<Tooltip content={`…${rest}`} placement="bottom" suppressed={rest === ''} class="min-w-0 flex-1">
	<span
		class="text-fg-default block min-w-0 flex-1 truncate select-text"
		bind:this={line}
		bind:clientWidth={width}
		data-testid="next-step-text"
	>
		<MarkdownText {text} mode="inline" {onopenfile} {canopenfile} />
	</span>
</Tooltip>
