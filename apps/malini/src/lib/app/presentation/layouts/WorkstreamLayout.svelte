<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { browserTabsQuery } from '$lib/browser/application/queries/browser-tabs.query.svelte';
	import { activeSessionQuery } from '$lib/chat/application/queries/active-session.query.svelte';
	import { ChatSurface } from '$lib/chat/chat.api';
	import { announceWorkstreamLifecycleCommand } from '$lib/extensions/application/commands/announce-workstream-lifecycle.command';
	import { InspectorSplit } from '$lib/extensions/extensions.api';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { activeJobRunsQuery } from '$lib/jobs/application/queries/active-job-runs.query.svelte';
	import { jobRunByIdQuery } from '$lib/jobs/application/queries/job-run-by-id.query.svelte';
	import { JobCenter } from '$lib/jobs/jobs.api';
	import { mergeStoppedOnJobQuery } from '$lib/pull-requests/application/queries/merge-stopped-on-job.query.svelte';
	import { pullRequestBadgesQuery } from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
	import { shipFailureQuery } from '$lib/pull-requests/application/queries/ship-failure.query.svelte';
	import { MergeStoppedOnJob, ShipFailureNotice } from '$lib/pull-requests/pull-requests.api';
	import { addScratchpadIdeaCommand } from '$lib/scratchpad/application/commands/add-scratchpad-idea.command';
	import {
		WorkstreamTitle,
		archiveWorkstreamCommand,
		repositoryContextQuery,
		workstreamByIdQuery,
	} from '$shared/repositories/repositories.api';
	import { page } from '$shared/router/state';
	import {
		WORKSTREAM_BROWSER_RATIO_KEY,
		WORKSTREAM_TRANSCRIPT_RATIO_KEY,
	} from '$shared/storage/panel-storage-keys';
	import StartedWorkstreams from '../StartedWorkstreams.svelte';
	import WorkstreamLineage from '../WorkstreamLineage.svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	const workstreamId = $derived(page.params.workstreamId ?? '');
	const workstream = $derived(workstreamByIdQuery.data(workstreamId));
	const repositoryFullName = $derived(repositoryContextQuery.data(workstreamId)?.repo.fullName);
	const hostsBrowser = $derived(browserTabsQuery.data(workstreamId).length > 0);
	const hasInspector = $derived(!workstream?.scope || hostsBrowser);
	const split = $derived(
		hostsBrowser
			? { storageKey: WORKSTREAM_BROWSER_RATIO_KEY, defaultRatio: 0.38, minSize: 400 }
			: { storageKey: WORKSTREAM_TRANSCRIPT_RATIO_KEY, defaultRatio: 0.62, minSize: 480 },
	);
	const chatSessionId = $derived(activeSessionQuery.data);
	const jobRuns = $derived(
		activeJobRunsQuery.data.filter(
			(run) =>
				run.workstreamId === workstreamId ||
				(chatSessionId !== null && run.chatSessionId === chatSessionId),
		),
	);

	onMount(() => {
		loadJobsCommand();
		return watchJobsHook();
	});

	const pullRequestShipped = $derived(
		['queued', 'merged'].includes(pullRequestBadgesQuery.data(workstreamId).phase),
	);

	const mergeStop = $derived(mergeStoppedOnJobQuery.data(workstreamId));
	const shipFailure = $derived(shipFailureQuery.data(workstreamId));
	const stoppedHere = $derived(
		mergeStop !== null &&
			chatSessionId !== null &&
			jobRunByIdQuery.data(mergeStop.jobRunId)?.sessionId === chatSessionId,
	);

	function closeWorkstream(): void {
		if (workstream) archiveWorkstreamCommand(workstream, announceWorkstreamLifecycleCommand);
	}
</script>

<WorkstreamTitle {workstreamId} />

<InspectorSplit {workstreamId} {...split} {hasInspector}>
	{#snippet primary()}
		<ChatSurface
			{workstreamId}
			{pullRequestShipped}
			{jobRuns}
			timeline={Boolean(workstream?.scope)}
			oncloseworkstream={closeWorkstream}
			onsavetoscratchpad={repositoryFullName
				? (idea: string) => addScratchpadIdeaCommand(repositoryFullName, idea)
				: undefined}
			notice={stoppedHere || shipFailure ? workstreamNotice : undefined}
		>
			{#snippet header(presentedWorkstreamId: string)}
				<WorkstreamLineage workstreamId={presentedWorkstreamId} />
			{/snippet}
			{#snippet workstreamsCard(workstreamIds: readonly string[])}
				<StartedWorkstreams {workstreamIds} />
			{/snippet}
		</ChatSurface>
	{/snippet}
	{#snippet secondary()}
		<div class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
			{@render children()}
			<JobCenter docked />
		</div>
	{/snippet}
</InspectorSplit>

{#snippet workstreamNotice()}
	{#if stoppedHere && mergeStop}
		<MergeStoppedOnJob {workstreamId} detail={mergeStop.detail} />
	{:else if shipFailure}
		<ShipFailureNotice {workstreamId} failure={shipFailure} />
	{/if}
{/snippet}
