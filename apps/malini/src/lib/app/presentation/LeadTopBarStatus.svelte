<script lang="ts">
	import { onDestroy } from 'svelte';
	import { leadProgressQuery } from '$lib/app/application/queries/lead-progress.query.svelte';
	import { leadHeadline, progressLabel } from '$lib/app/domain/lead-progress';
	import { activeSessionQuery } from '$lib/chat/application/queries/active-session.query.svelte';
	import { globalTopBarGithubStatus } from '$shared/shell/global-topbar-actions.svelte';
	import { startedShipAction } from './started-ship-action';

	interface Props {
		leadId: string;
	}

	let { leadId }: Props = $props();

	const dots = $derived(leadProgressQuery.dots(leadId));
	const targets = $derived(leadProgressQuery.shipTargets(leadId));
	const chatSessionId = (): string | null => activeSessionQuery.data;

	$effect(() => {
		globalTopBarGithubStatus.publish(leadId, {
			reference: null,
			title: null,
			branch: null,
			checks: [],
			checksSummary: '',
			review: null,
			todos: null,
			headline: { ...leadHeadline(dots), tooltip: dots.length > 0 ? progressLabel(dots) : null },
			action: startedShipAction('merge-all', leadId, targets.merge, chatSessionId),
			secondaryAction: startedShipAction('draft-all', leadId, targets.draft, chatSessionId),
		});
	});

	onDestroy(() => globalTopBarGithubStatus.clear(leadId));
</script>
