<script lang="ts">
	interface Props {
		footerInset: number;
	}

	let { footerInset }: Props = $props();
</script>

<div
	class="chat-stage-inset grid min-h-0 flex-1 place-items-center px-6 pt-10 text-center"
	style:padding-bottom="calc(2.5rem + {footerInset}px)"
	data-testid="chat-empty-session"
>
	<div class="max-w-sm">
		<p class="text-fg-secondary text-sm">No chat yet</p>
		<p class="text-fg-tertiary mt-1 text-xs leading-5">
			Send a prompt below to start the first chat in this workstream.
		</p>
	</div>
</div>
