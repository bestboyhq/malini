<script lang="ts">
	interface Props {
		workstreamId: string;
		pendingSessionId: string | null;
	}

	let { workstreamId, pendingSessionId }: Props = $props();
</script>

<div
	class="min-h-0 flex-1"
	data-testid="chat-cold-shell"
	data-navigation-cold-shell="true"
	data-navigation-workstream-id={workstreamId}
	data-navigation-agent-session-id={pendingSessionId ?? undefined}
	aria-label="Chat transcript unavailable until its local projection is verified"
></div>
