<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { presentsBrowser } from '$lib/browser/browser.api';
	import { ChatSurface } from '$lib/chat/chat.api';
	import { announceWorkstreamLifecycleCommand } from '$lib/extensions/application/commands/announce-workstream-lifecycle.command';
	import { InspectorSplit } from '$lib/extensions/extensions.api';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { activeJobRunsQuery } from '$lib/jobs/application/queries/active-job-runs.query.svelte';
	import { JobCenter } from '$lib/jobs/jobs.api';
	import { pullRequestBadgesQuery } from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
	import {
		WorkstreamProvisioningFrame,
		WorkstreamTitle,
		archiveWorkstreamCommand,
		workstreamByIdQuery,
	} from '$shared/repositories/repositories.api';
	import { inspectorGutter } from '$shared/extensions/inspector-gutter.store.svelte';
	import { page } from '$shared/router/state';
	import {
		WORKSTREAM_BROWSER_RATIO_KEY,
		WORKSTREAM_TRANSCRIPT_RATIO_KEY,
	} from '$shared/storage/panel-storage-keys';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	const workstreamId = $derived(page.params.workstreamId ?? '');
	const workstream = $derived(workstreamByIdQuery.data(workstreamId));
	const browserFirst = $derived(presentsBrowser(inspectorGutter.presentedPanelFor(workstreamId)));
	const split = $derived(
		browserFirst
			? { storageKey: WORKSTREAM_BROWSER_RATIO_KEY, defaultRatio: 0.38, minSize: 400 }
			: { storageKey: WORKSTREAM_TRANSCRIPT_RATIO_KEY, defaultRatio: 0.62, minSize: 480 },
	);
	const jobRuns = $derived(
		activeJobRunsQuery.data.filter((run) => run.workstreamId === workstreamId),
	);

	onMount(() => {
		loadJobsCommand();
		return watchJobsHook();
	});

	const pullRequestShipped = $derived(
		['queued', 'merged'].includes(pullRequestBadgesQuery.data(workstreamId).phase),
	);

	function closeWorkstream(): void {
		if (workstream) archiveWorkstreamCommand(workstream, announceWorkstreamLifecycleCommand);
	}
</script>

<WorkstreamTitle {workstreamId} />

<WorkstreamProvisioningFrame {workstreamId}>
	<InspectorSplit {workstreamId} {...split}>
		{#snippet primary()}
			<ChatSurface
				{workstreamId}
				{pullRequestShipped}
				{jobRuns}
				oncloseworkstream={closeWorkstream}
			/>
		{/snippet}
		{#snippet secondary()}
			<div class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
				{@render children()}
				<JobCenter docked />
			</div>
		{/snippet}
	</InspectorSplit>
</WorkstreamProvisioningFrame>
