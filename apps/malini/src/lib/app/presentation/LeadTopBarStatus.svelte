<script lang="ts">
	import { onDestroy } from 'svelte';
	import { leadProgressQuery } from '$lib/app/application/queries/lead-progress.query.svelte';
	import { leadHeadline, progressLabel } from '$lib/app/domain/lead-progress';
	import { globalTopBarGithubStatus } from '$shared/shell/global-topbar-actions.svelte';

	interface Props {
		leadId: string;
	}

	let { leadId }: Props = $props();

	const dots = $derived(leadProgressQuery.dots(leadId));

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
			action: null,
		});
	});

	onDestroy(() => globalTopBarGithubStatus.clear(leadId));
</script>
