<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import { browserTabsQuery } from '$lib/browser/application/queries/browser-tabs.query.svelte';
	import { activeSessionQuery } from '$lib/chat/application/queries/active-session.query.svelte';
	import { workstreamChatsQuery } from '$lib/chat/application/queries/workstream-chats.query.svelte';
	import { ChatSurface } from '$lib/chat/chat.api';
	import { announceWorkstreamLifecycleCommand } from '$lib/extensions/application/commands/announce-workstream-lifecycle.command';
	import { InspectorSplit } from '$lib/extensions/extensions.api';
	import { loadAutomationsCommand } from '$lib/automations/application/commands/load-automations.command';
	import { watchAutomationsHook } from '$lib/automations/application/hooks/watch-automations.hook';
	import { automationRunByIdQuery } from '$lib/automations/application/queries/automation-run-by-id.query.svelte';
	import { automationSuggestionsQuery } from '$lib/automations/application/queries/automation-suggestions.query.svelte';
	import { workstreamLiveAutomationsQuery } from '$lib/automations/application/queries/workstream-live-automations.query.svelte';
	import { AutomationSuggestionCard } from '$lib/automations/automations.api';
	import { mergeStoppedOnAutomationQuery } from '$lib/pull-requests/application/queries/merge-stopped-on-automation.query.svelte';
	import { pullRequestBadgesQuery } from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
	import { shipFailureQuery } from '$lib/pull-requests/application/queries/ship-failure.query.svelte';
	import {
		MergeStoppedOnAutomation,
		ShipFailureNotice,
	} from '$lib/pull-requests/pull-requests.api';
	import { addScratchpadIdeaCommand } from '$lib/scratchpad/application/commands/add-scratchpad-idea.command';
	import {
		WorkstreamTitle,
		archiveWorkstreamCommand,
		changeTotalsQuery,
		leaveMissingWorkstreamCommand,
		provisioningRecordQuery,
		repositoryContextQuery,
		workstreamBranch,
		workstreamByIdQuery,
	} from '$shared/repositories/repositories.api';
	import { inspectorDrawer } from '$shared/extensions/inspector-drawer.store.svelte';
	import { page } from '$shared/router/state';
	import { inspectorDock } from '$shared/shell/inspector-dock.svelte';
	import {
		WORKSTREAM_BROWSER_RATIO_KEY,
		WORKSTREAM_TRANSCRIPT_RATIO_KEY,
	} from '$shared/storage/panel-storage-keys';
	import StartedWorkstreams from '../StartedWorkstreams.svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	const workstreamId = $derived(page.params.workstreamId ?? '');
	const workstream = $derived(workstreamByIdQuery.data(workstreamId));
	const repositoryFullName = $derived(repositoryContextQuery.data(workstreamId)?.repo.fullName);
	const hostsBrowser = $derived(browserTabsQuery.data(workstreamId).length > 0);
	const split = $derived(
		hostsBrowser
			? { storageKey: WORKSTREAM_BROWSER_RATIO_KEY, defaultRatio: 0.38, minSize: 400 }
			: { storageKey: WORKSTREAM_TRANSCRIPT_RATIO_KEY, defaultRatio: 0.62, minSize: 480 },
	);
	const chatSessionId = $derived(activeSessionQuery.data);
	const automations = $derived(workstreamLiveAutomationsQuery.data(workstreamId, chatSessionId));
	const automationRuns = $derived(automations.flatMap((entry) => (entry.run ? [entry.run] : [])));
	const gutterWaits = $derived(
		provisioningRecordQuery.madeHere(workstreamId) &&
			workstreamChatsQuery.data(workstreamId).length === 0 &&
			workstream?.branch === workstreamBranch(workstreamId) &&
			!changeTotalsQuery.data[workstreamId]?.files &&
			!hostsBrowser &&
			automations.length === 0 &&
			!inspectorDrawer.isOpen(workstreamId),
	);
	const gutterAway = new Tween(
		untrack(() => (gutterWaits ? 1 : 0)),
		{ easing: cubicOut },
	);
	let gutterAwayFor = untrack(() => workstreamId);

	$effect(() => {
		const away = gutterWaits ? 1 : 0;
		const pushes = workstreamId === gutterAwayFor && !prefersReducedMotion.current;
		gutterAwayFor = workstreamId;
		void gutterAway.set(away, { duration: pushes ? 240 : 0 });
	});

	onMount(() => {
		loadAutomationsCommand();
		const stopWatching = watchAutomationsHook();
		const letGo = inspectorDock.holdWhile(() => gutterAway.current > 0);
		return () => {
			stopWatching();
			letGo();
		};
	});

	$effect(() => {
		if (workstream === null) leaveMissingWorkstreamCommand(workstreamId);
	});

	const pullRequestShipped = $derived(
		['queued', 'merged'].includes(pullRequestBadgesQuery.data(workstreamId).phase),
	);

	const mergeStop = $derived(mergeStoppedOnAutomationQuery.data(workstreamId));
	const shipFailure = $derived(shipFailureQuery.data(workstreamId));
	const stoppedHere = $derived(
		mergeStop !== null &&
			chatSessionId !== null &&
			automationRunByIdQuery.data(mergeStop.automationRunId)?.sessionId === chatSessionId,
	);

	function closeWorkstream(): void {
		if (workstream) archiveWorkstreamCommand(workstream, announceWorkstreamLifecycleCommand);
	}
</script>

<WorkstreamTitle {workstreamId} />

<InspectorSplit {workstreamId} {...split}>
	{#snippet primary()}
		<ChatSurface
			{workstreamId}
			{pullRequestShipped}
			{automationRuns}
			gutterAway={gutterAway.current}
			oncloseworkstream={closeWorkstream}
			onsavetoscratchpad={repositoryFullName
				? (idea: string) => addScratchpadIdeaCommand(repositoryFullName, idea)
				: undefined}
			notice={stoppedHere || shipFailure ? workstreamNotice : undefined}
		>
			{#snippet workstreamsCard(workstreamIds: readonly string[])}
				<StartedWorkstreams {workstreamIds} />
			{/snippet}
			{#snippet afterRun(runId: string)}
				{@const suggestion = automationSuggestionsQuery.afterRun(runId)}
				{#if suggestion}
					<div class="-mx-3">
						<AutomationSuggestionCard {suggestion} />
					</div>
				{/if}
			{/snippet}
		</ChatSurface>
	{/snippet}
	{#snippet secondary()}
		<div
			class={[
				'relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden',
				gutterAway.current === 1 && 'invisible',
			]}
			style:left={gutterAway.current > 0 ? `${gutterAway.current * 100}%` : undefined}
		>
			{@render children()}
		</div>
	{/snippet}
</InspectorSplit>

{#snippet workstreamNotice()}
	{#if stoppedHere && mergeStop}
		<MergeStoppedOnAutomation {workstreamId} detail={mergeStop.detail} />
	{:else if shipFailure}
		<ShipFailureNotice {workstreamId} failure={shipFailure} />
	{/if}
{/snippet}
