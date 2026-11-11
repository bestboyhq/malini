<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import MarkdownText from '$shared/markdown/MarkdownText.svelte';
	import type { RunGroup } from '../render-state';
	import type { RunTimelineItem } from '../run-timeline';
	import { transcriptContext } from './transcript-context';

	interface Props {
		message: Extract<RunTimelineItem, { kind: 'assistant' }>;
		run: RunGroup;
	}

	let { message, run }: Props = $props();

	const transcript = transcriptContext();
	const { stageEnter, timelineKey } = transcript;
</script>

<div
	class="text-fg-secondary flex w-full items-start gap-2 text-sm leading-6"
	use:stageEnter={timelineKey(run, message.contentId ?? message.key)}
	data-message-kind="activity-message"
	data-testid="chat-activity-message"
>
	<span class="text-fg-tertiary grid h-6 w-3.5 shrink-0 place-items-center" aria-hidden="true">
		<Icon name="chat" size={13} />
	</span>
	<div class="min-w-0 flex-1 select-text">
		<MarkdownText
			text={message.text}
			onopenfile={transcript.openFileMention}
			canopenfile={transcript.canOpenFileMention}
		/>
	</div>
</div>
