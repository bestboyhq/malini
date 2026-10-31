<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { goto } from '$shared/router/navigation';
	import { PROFILE_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import { turnOnPublishingCommand } from '$lib/stats/application/commands/turn-on-publishing.command';

	interface Props {
		onpublish: () => void;
	}

	let { onpublish }: Props = $props();

	function onPublish(): void {
		onpublish();
		turnOnPublishingCommand();
		void goto(PROFILE_SETTINGS_HREF);
	}
</script>

<section
	class="border-surface-elevated-border flex items-center justify-between gap-3 rounded-xl border-[0.5px] p-3"
	aria-label="Share card"
>
	<div class="min-w-0">
		<h3 class="text-fg-secondary text-xs font-medium">Share card</h3>
		<p class="text-fg-tertiary mt-0.5 text-xs">
			Your agents did the work.
			<br />
			Take the credit on bestboy.dev.
		</p>
	</div>
	<Button variant="secondary" size="sm" class="shrink-0" onclick={onPublish}>
		Publish my stats
	</Button>
</section>
