<script lang="ts">
	import { onDestroy, onMount, tick, type Snippet } from 'svelte';
	import { quartOut } from 'svelte/easing';
	import { fly, slide, type SlideParams } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { resizableSplitInset } from '$hyper-ui/components/resizable-split';
	import { Icon } from '$hyper-ui/icons';
	import type { JobRunRecord } from '$contract/jobs';
	import { cancelRunCommand } from '$lib/chat/application/commands/cancel-run.command';
	import { closeFreshChatCommand } from '$lib/chat/application/commands/close-fresh-chat.command';
	import { openChangedFileCommand } from '$lib/chat/application/commands/open-changed-file.command';
	import { pausePromptQueueCommand } from '$lib/chat/application/commands/pause-prompt-queue.command';
	import { removeQueuedPromptCommand } from '$lib/chat/application/commands/remove-queued-prompt.command';
	import { selectModelCommand } from '$lib/chat/application/commands/select-model.command';
	import { selectRunProfileCommand } from '$lib/chat/application/commands/select-run-profile.command';
	import { sendQueuedPromptCommand } from '$lib/chat/application/commands/send-queued-prompt.command';
	import { startFreshChatCommand } from '$lib/chat/application/commands/start-fresh-chat.command';
	import { stopBackgroundTaskCommand } from '$lib/chat/application/commands/stop-background-task.command';
	import { updateQueuedPromptCommand } from '$lib/chat/application/commands/update-queued-prompt.command';
	import { followChatRouteHook } from '$lib/chat/application/hooks/follow-chat-route.hook.svelte';
	import { followChildRequestsHook } from '$lib/chat/application/hooks/follow-child-requests.hook.svelte';
	import { followLeadDecisionsHook } from '$lib/chat/application/hooks/follow-lead-decisions.hook.svelte';
	import {
		closeLeadDecisionViewerCommand,
		focusLeadDecisionCommand,
		setLeadDecisionsAsideCommand,
	} from '$lib/chat/application/commands/focus-lead-decision.command';
	import { leadDecisionsQuery } from '$lib/chat/application/queries/lead-decisions.query.svelte';
	import { preloadOpenChatsHook } from '$lib/chat/application/hooks/preload-open-chats.hook.svelte';
	import { watchAgentLifecycleHook } from '$lib/chat/application/hooks/watch-agent-lifecycle.hook.svelte';
	import { watchSessionChangesHook } from '$lib/chat/application/hooks/watch-session-changes.hook.svelte';
	import { watchShellRunsHook } from '$lib/chat/application/hooks/watch-shell-runs.hook';
	import { activeModelQuery } from '$lib/chat/application/queries/active-model.query.svelte';
	import { activeSessionQuery } from '$lib/chat/application/queries/active-session.query.svelte';
	import { askingChildrenQuery } from '$lib/chat/application/queries/asking-children.query.svelte';
	import { backgroundWorkQuery } from '$lib/chat/application/queries/background-work.query.svelte';
	import { chatPreparingQuery } from '$lib/chat/application/queries/chat-preparing.query.svelte';
	import { chatRunningQuery } from '$lib/chat/application/queries/chat-running.query.svelte';
	import { childRequestsQuery } from '$lib/chat/application/queries/child-requests.query.svelte';
	import { composerDraftQuery } from '$lib/chat/application/queries/composer-draft.query.svelte';
	import { emptySessionModeQuery } from '$lib/chat/application/queries/empty-session-mode.query.svelte';
	import { freshChatReturnQuery } from '$lib/chat/application/queries/fresh-chat-return.query.svelte';
	import { freshSessionRequestedQuery } from '$lib/chat/application/queries/fresh-session-requested.query.svelte';
	import { openingChangedFileQuery } from '$lib/chat/application/queries/opening-changed-file.query.svelte';
	import { pendingPromptQuery } from '$lib/chat/application/queries/pending-prompt.query.svelte';
	import { pendingQuestionsQuery } from '$lib/chat/application/queries/pending-questions.query.svelte';
	import { presentedTranscriptQuery } from '$lib/chat/application/queries/presented-transcript.query.svelte';
	import { queueErrorsQuery } from '$lib/chat/application/queries/queue-errors.query.svelte';
	import { queuePausedQuery } from '$lib/chat/application/queries/queue-paused.query.svelte';
	import { queueSendingQuery } from '$lib/chat/application/queries/queue-sending.query.svelte';
	import { queuedPromptsQuery } from '$lib/chat/application/queries/queued-prompts.query.svelte';
	import { requestedSessionQuery } from '$lib/chat/application/queries/requested-session.query.svelte';
	import { restoringSessionQuery } from '$lib/chat/application/queries/restoring-session.query.svelte';
	import { runProfileQuery } from '$lib/chat/application/queries/run-profile.query.svelte';
	import { sessionBootErrorQuery } from '$lib/chat/application/queries/session-boot-error.query.svelte';
	import { sessionChangesTargetQuery } from '$lib/chat/application/queries/session-changes-target.query.svelte';
	import { sessionChangesQuery } from '$lib/chat/application/queries/session-changes.query.svelte';
	import { sessionEnvelopesQuery } from '$lib/chat/application/queries/session-envelopes.query.svelte';
	import { waitingElsewhereQuery } from '$lib/chat/application/queries/waiting-elsewhere.query.svelte';
	import { isUncheckedApproval } from '$lib/chat/domain/child-requests';
	import { agentDraftScopeKey } from '$lib/chat/domain/draft';
	import type { AgentElementReference } from '$lib/chat/domain/element-reference';
	import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
	import { WorkstreamDocument } from '$lib/extensions/extensions.api';
	import { SecretRequestCard } from '$lib/secrets/secrets.api';
	import { focusIsUnclaimed, overlayIsOpen } from '$shared/shell/unclaimed-focus';
	import { workstreamTabs } from '$shared/shell/workstream-tabs.store.svelte';
	import { loadModelDefaultsCommand } from '$shared/providers/providers.api';
	import {
		DependencyInstallBanner,
		WorkstreamProvisioningBanner,
		type AgentSessionChangedFile,
	} from '$shared/repositories/repositories.api';
	import AgentProcessDiedBanner from './AgentProcessDiedBanner.svelte';
	import AgentQuestionPanel from './AgentQuestionPanel.svelte';
	import BackgroundTaskList from './BackgroundTaskList.svelte';
	import ChatChangedFiles from './ChatChangedFiles.svelte';
	import ChatColdShell from './ChatColdShell.svelte';
	import ChatComposer from './ChatComposer.svelte';
	import ChatEmptySession from './ChatEmptySession.svelte';
	import ChatMessageList from './ChatMessageList.svelte';
	import ChatSessionError from './ChatSessionError.svelte';
	import ChatTabs from './ChatTabs.svelte';
	import ChildRequestQueue from './ChildRequestQueue.svelte';
	import LeadDecisionQueue from './LeadDecisionQueue.svelte';
	import LeadDecisionViewer from './LeadDecisionViewer.svelte';
	import LeadTimeline from './LeadTimeline.svelte';
	import { childRequestSteps } from './child-request-steps';
	import FreshChatSuggestions from './FreshChatSuggestions.svelte';
	import QueuedPromptList from './QueuedPromptList.svelte';
	import RequestsWaiting from './RequestsWaiting.svelte';
	import type { TranscriptComposerControls } from './chat-message-list/transcript-context';
	import { chatStage } from './chat-stage';

	interface Props {
		workstreamId: string;
		pullRequestShipped?: boolean;
		jobRuns?: readonly JobRunRecord[];
		timeline?: boolean;
		oncloseworkstream: () => void;
		onsavetoscratchpad?: ((idea: string) => void) | undefined;
		header: Snippet<[string]>;
		workstreamsCard: Snippet<[readonly string[]]>;
		notice?: Snippet | undefined;
		jobs?: Snippet | undefined;
	}

	let {
		workstreamId,
		pullRequestShipped = false,
		jobRuns = [],
		timeline = false,
		oncloseworkstream,
		onsavetoscratchpad,
		header,
		workstreamsCard,
		notice,
		jobs,
	}: Props = $props();

	const splitInset = resizableSplitInset();

	const releaseChatRoute = followChatRouteHook();
	const stopPreloadingOpenChats = preloadOpenChatsHook();
	const releaseSessionChanges = watchSessionChangesHook();
	const releaseShellRuns = watchShellRunsHook();
	const releaseAgentLifecycle = watchAgentLifecycleHook();
	const releaseChildRequests = followChildRequestsHook(() =>
		[...askingChildren, ...waitingElsewhere].map((child) => child.sessionId),
	);
	const releaseLeadDecisions = followLeadDecisionsHook(() => (timeline ? sessionId : null));

	onMount(() => {
		loadModelDefaultsCommand();
	});

	onDestroy(() => {
		releaseSessionChanges();
		releaseShellRuns();
		releaseAgentLifecycle();
		releaseChatRoute();
		stopPreloadingOpenChats();
		releaseChildRequests();
		releaseLeadDecisions();
	});

	const sessionId = $derived(activeSessionQuery.data);
	const requestedSessionId = $derived(requestedSessionQuery.data);
	const restoringSessionId = $derived(restoringSessionQuery.data);
	const bootError = $derived(sessionBootErrorQuery.data);
	const emptySessionMode = $derived(emptySessionModeQuery.data);
	const forceFreshSession = $derived(freshSessionRequestedQuery.data);
	const selection = $derived(activeModelQuery.data);
	const profile = $derived(runProfileQuery.data);
	const backgroundWork = $derived(backgroundWorkQuery.data(sessionId));
	const handsOffBackgroundWork = $derived(
		backgroundWork?.waiting === true && !(sessionId && pendingPromptQuery.data(sessionId)),
	);
	const isRunning = $derived(chatRunningQuery.data && !handsOffBackgroundWork);
	const preparing = $derived(chatPreparingQuery.data);
	const presentedTranscript = $derived(presentedTranscriptQuery.data);
	const presentedWorkstreamId = $derived(presentedTranscript.workstreamId);
	const presentedSessionId = $derived(presentedTranscript.sessionId);
	const envelopes = $derived(sessionEnvelopesQuery.data(sessionId));
	const closeFreshNavigationTarget = $derived(freshChatReturnQuery.data);
	const queuedPrompts = $derived(queuedPromptsQuery.data);
	const queuePaused = $derived(queuePausedQuery.data);
	const queueSendingId = $derived(queueSendingQuery.data);
	const queueErrorById = $derived(queueErrorsQuery.data);
	const sessionChanges = $derived(
		sessionChangesQuery.data(presentedWorkstreamId === workstreamId ? presentedSessionId : null),
	);
	const sessionChangesTargetId = $derived(sessionChangesTargetQuery.data);
	const openingChangedFilePath = $derived(openingChangedFileQuery.data);
	const pendingQuestions = $derived(pendingQuestionsQuery.data(presentedSessionId));
	const askingChildren = $derived(askingChildrenQuery.data(workstreamId, sessionId, jobRuns));
	const childSteps = $derived(
		childRequestSteps(askingChildren, childRequestsQuery.approvals, childRequestsQuery.questions),
	);
	const waitingElsewhere = $derived(waitingElsewhereQuery.data(sessionId, askingChildren));
	const uncheckedSteps = $derived(
		childRequestSteps(
			waitingElsewhere,
			(waitingSessionId) =>
				childRequestsQuery.approvals(waitingSessionId).filter(isUncheckedApproval),
			() => [],
		),
	);
	const leadDecisions = $derived(leadDecisionsQuery.data(timeline ? sessionId : null));
	const decisionFocus = $derived(leadDecisionsQuery.focus);
	const openDecisions = $derived(leadDecisions.filter((decision) => !decision.answer));
	const changingDecision = $derived(
		leadDecisions.find(
			(decision) => decision.id === decisionFocus.focusedId && decision.answer !== null,
		) ?? null,
	);
	const viewedDecision = $derived(
		leadDecisions.find((decision) => decision.id === decisionFocus.viewing?.decisionId) ?? null,
	);
	const draftScope = $derived(agentDraftScopeKey(workstreamId, sessionId));
	const scopedDraft = $derived(composerDraftQuery.data(draftScope));

	let footerSize: ResizeObserverSize[] | undefined = $state();
	let traySize: ResizeObserverSize[] | undefined = $state();
	const exactFooterHeight = $derived(footerSize?.[0]?.blockSize ?? 0);
	const footerHeight = $derived(Math.round(exactFooterHeight));
	const composerHeight = $derived(Math.round(exactFooterHeight - (traySize?.[0]?.blockSize ?? 0)));
	const trayHeight = $derived(footerHeight - composerHeight);
	let transcript: ChatMessageList | null = $state(null);
	let timelineView: LeadTimeline | null = $state(null);
	let contentBelow = $state(false);
	let newContentBelow = $state(false);
	const nudgeMotion = (): { y: number; duration: number } => ({
		y: 4,
		duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140,
	});
	let presentationChanging = false;
	const foldMotion = (): SlideParams => ({
		duration:
			presentationChanging || window.matchMedia('(prefers-reduced-motion: reduce)').matches
				? 0
				: 240,
		easing: quartOut,
	});

	const documentActive = $derived(workstreamTabs.for(workstreamId).activeDocumentId !== null);

	const freshChat = $derived(
		sessionId === null &&
			bootError === null &&
			restoringSessionId === null &&
			(emptySessionMode === 'fresh' || requestedSessionId === null),
	);
	const pendingSessionId = $derived(
		requestedSessionId && requestedSessionId !== sessionId
			? requestedSessionId
			: restoringSessionId,
	);
	const sessionSwitching = $derived(pendingSessionId !== null && bootError === null);
	const presentsRoutedChat = $derived(
		freshChat ||
			(sessionId !== null &&
				presentedWorkstreamId === workstreamId &&
				presentedSessionId === sessionId),
	);
	const presentationPending = $derived(
		sessionSwitching ||
			(!presentsRoutedChat && (preparing || (sessionId !== null && bootError === null))),
	);
	const retainingSourcePresentation = $derived(
		presentedSessionId !== null && (presentedWorkstreamId !== workstreamId || presentationPending),
	);
	const stage = $derived(
		chatStage({ freshChat, presentedSessionId, bootError, presentationPending }),
	);
	const asking = $derived(
		stage === 'transcript' &&
			!presentationPending &&
			presentedSessionId === sessionId &&
			pendingQuestions.length > 0,
	);
	let answerLaterKeys = $state<ReadonlySet<string>>(new Set());
	const childRequestsAside = $derived(
		childSteps.length > 0 && childSteps.every((step) => answerLaterKeys.has(step.key)),
	);
	const answeringChildren = $derived(childSteps.length > 0 && !childRequestsAside && !asking);
	let answeringUnchecked = $state(false);
	const showsUncheckedQueue = $derived(
		answeringUnchecked && uncheckedSteps.length > 0 && !asking && !answeringChildren,
	);
	const composerHidden = $derived(asking || answeringChildren || showsUncheckedQueue);
	const decisionsAside = $derived(
		openDecisions.length > 0 &&
			openDecisions.every((decision) => decisionFocus.asideIds.has(decision.id)),
	);
	const showsDecisions = $derived(
		timeline &&
			stage === 'transcript' &&
			!composerHidden &&
			(changingDecision !== null || (openDecisions.length > 0 && !decisionsAside)),
	);
	const decisionsWaiting = $derived(
		timeline && decisionsAside && changingDecision === null && !composerHidden,
	);
	const secretsSessionId = $derived(
		stage === 'transcript' &&
			!presentationPending &&
			presentedSessionId === sessionId &&
			!composerHidden
			? sessionId
			: null,
	);
	const childRequestsWaiting = $derived(childRequestsAside && !asking);
	const uncheckedCallsWaiting = $derived(uncheckedSteps.length > 0 && !showsUncheckedQueue);

	$effect(() => {
		if (uncheckedSteps.length === 0) answeringUnchecked = false;
	});
	let composerSlot: HTMLElement | null = $state(null);
	let wasHidden = false;

	$effect(() => {
		const now = composerHidden;
		if (now === wasHidden) return;
		wasHidden = now;
		if (!now) void returnToComposer();
	});

	async function returnToComposer(): Promise<void> {
		await tick();
		if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			composerSlot?.animate(
				[
					{ opacity: 0, transform: 'translateY(6px)' },
					{ opacity: 1, transform: 'none' },
				],
				{ duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
			);
		}
		if (focusIsUnclaimed()) composer?.focus({ scrollIntoView: false });
	}

	const showsSessionChanges = $derived(
		!freshChat && sessionChanges !== null && sessionChanges.files.length > 0,
	);

	const editorComposerControls = $derived<TranscriptComposerControls>({
		selection,
		profile,
		envelopes,
		backendSelectionDisabled: bootError !== null || presentationPending,
		onbackendchange: selectModelCommand,
		onprofilechange: selectRunProfileCommand,
	});

	let transcriptReferences = $state<AgentTranscriptReference[]>([]);
	let elementReferences = $state<AgentElementReference[]>([]);
	let referencesLoadedFor: string | null = null;

	$effect(() => {
		const scope = draftScope;
		if (referencesLoadedFor === scope) return;
		referencesLoadedFor = scope;
		transcriptReferences = scopedDraft.transcriptReferences.map((reference) => ({ ...reference }));
		elementReferences = scopedDraft.elementReferences.map((reference) => ({
			...reference,
			rect: { ...reference.rect },
		}));
	});

	let composer: {
		focus(options?: { scrollIntoView?: boolean }): boolean;
		typeKey(event: KeyboardEvent): void;
		paste(event: ClipboardEvent): void;
	} | null = $state(null);
	const presentationKey = $derived(`${workstreamId}::${presentedSessionId ?? 'fresh'}`);
	let focusedPresentationKey: string | null = null;
	const sessionChangesLoaded = $derived(sessionChanges !== null);

	$effect.pre(() => {
		void presentationKey;
		void presentationPending;
		void sessionChangesLoaded;
		void skipFoldUntilPresented();
	});

	async function skipFoldUntilPresented(): Promise<void> {
		presentationChanging = true;
		await tick();
		presentationChanging = false;
	}

	$effect(() => {
		const key = presentationKey;
		const presentable = !presentationPending && !retainingSourcePresentation && bootError === null;
		if (!presentable || key === focusedPresentationKey) return;
		focusedPresentationKey = key;
		void focusComposerForPresentation(key);
	});

	async function focusComposerForPresentation(key: string): Promise<void> {
		await tick();
		if (presentationKey !== key || !composerMayTakeFocus()) return;
		composer?.focus({ scrollIntoView: false });
	}

	function composerMayTakeFocus(): boolean {
		return document.hasFocus() && focusIsUnclaimed();
	}

	function onWindowKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || !/^\S$/u.test(event.key)) {
			return;
		}
		if (composerMayClaimInput()) composer?.typeKey(event);
	}

	function onWindowPaste(event: ClipboardEvent): void {
		if (!event.defaultPrevented && composerMayClaimInput()) composer?.paste(event);
	}

	function composerMayClaimInput(): boolean {
		return !composerHidden && !documentActive && focusIsUnclaimed() && !overlayIsOpen();
	}

	function onOpenChangedFile(file: AgentSessionChangedFile): void {
		openChangedFileCommand({ workstreamId, targetSessionId: sessionChangesTargetId, file });
	}
</script>

<svelte:window onkeydown={onWindowKeydown} onpaste={onWindowPaste} />

<div
	data-testid="chat-surface"
	class="flex h-full min-h-0 w-full flex-col overflow-hidden"
	style:width={splitInset.extent > 0 ? `${splitInset.extent}px` : undefined}
	style:padding-right="{splitInset.secondarySize}px"
>
	<AgentProcessDiedBanner />
	<WorkstreamProvisioningBanner {workstreamId} />
	<DependencyInstallBanner {workstreamId} />
	<div class="min-h-0 flex-1">
		<div
			class="relative h-full min-h-0"
			data-testid="workstream-runtime-surface"
			data-navigation-workstream-id={workstreamId}
			data-navigation-presented-workstream-id={presentedWorkstreamId}
			data-navigation-agent-session-id={presentedSessionId ?? undefined}
			aria-busy={presentationPending}
		>
			<div class="h-full min-h-0">
				<section
					class="text-fg-default flex h-full min-h-0 flex-col select-none"
					data-testid="transcript-pane"
					data-workstream-id={workstreamId}
					data-presented-workstream-id={presentedWorkstreamId}
					data-navigation-retained={retainingSourcePresentation ? 'true' : undefined}
				>
					<ChatTabs
						{workstreamId}
						activeSessionId={freshChat ? null : (pendingSessionId ?? sessionId)}
						fresh={freshChat}
						planMode={profile.mode === 'plan'}
						onnewchat={startFreshChatCommand}
						onclosefresh={closeFreshChatCommand}
						{oncloseworkstream}
						freshCloseNavigationTarget={closeFreshNavigationTarget}
					/>

					<div
						class="transcript-stage relative min-h-0 flex-1"
						aria-busy={presentationPending}
						data-session-switching={presentationPending ? 'true' : undefined}
					>
						<div
							class="absolute inset-0 z-0 flex min-h-0 flex-col"
							inert={documentActive || undefined}
						>
							{#if stage === 'fresh'}
								<FreshChatSuggestions
									{workstreamId}
									{draftScope}
									footerInset={footerHeight}
									bind:transcriptReferences
								/>
							{:else if stage === 'transcript' && presentedSessionId && timeline}
								<div
									class="contents"
									inert={retainingSourcePresentation ? true : undefined}
									data-navigation-retained={retainingSourcePresentation ? 'true' : undefined}
									data-presented-workstream-id={presentedWorkstreamId}
								>
									<LeadTimeline
										bind:this={timelineView}
										bind:contentBelow
										bind:newContentBelow
										workstreamId={presentedWorkstreamId}
										sessionId={presentedSessionId}
										envelopes={presentedTranscript.envelopes}
										running={isRunning}
										spaceBelow={footerHeight}
									/>
								</div>
							{:else if stage === 'transcript' && presentedSessionId}
								<div
									class="contents"
									inert={retainingSourcePresentation ? true : undefined}
									data-navigation-retained={retainingSourcePresentation ? 'true' : undefined}
									data-presented-workstream-id={presentedWorkstreamId}
								>
									<ChatMessageList
										bind:this={transcript}
										bind:contentBelow
										bind:newContentBelow
										workstreamId={presentedWorkstreamId}
										sessionId={presentedSessionId}
										envelopes={presentedTranscript.envelopes}
										composerControls={editorComposerControls}
										{pullRequestShipped}
										{onsavetoscratchpad}
										spaceBelow={footerHeight}
										overlayBelow={trayHeight}
										{header}
										{workstreamsCard}
									>
										{#snippet empty()}
											<FreshChatSuggestions
												{workstreamId}
												{draftScope}
												footerInset={footerHeight}
												bind:transcriptReferences
											/>
										{/snippet}
									</ChatMessageList>
								</div>
							{:else if stage === 'error' && bootError}
								<ChatSessionError
									{workstreamId}
									{sessionId}
									error={bootError}
									footerInset={footerHeight}
								/>
							{:else if stage === 'cold'}
								<ChatColdShell {workstreamId} pendingSessionId={pendingSessionId ?? sessionId} />
							{:else}
								<ChatEmptySession footerInset={footerHeight} />
							{/if}
						</div>

						<div
							class="chat-footer-scrim absolute inset-x-0 bottom-0 z-20 pr-[var(--scrollbar-gutter)]"
							bind:borderBoxSize={footerSize}
							inert={documentActive || undefined}
							data-testid="chat-footer-stack"
						>
							{#if stage === 'transcript' && contentBelow && !presentationPending}
								<div
									class="chat-stage-inset pointer-events-none absolute inset-x-0 bottom-full flex justify-center pr-[var(--scrollbar-gutter)] pb-3"
									transition:fly={nudgeMotion()}
								>
									<Button
										variant="secondary"
										size="sm"
										radius="full"
										bordered
										class="shadow-popup pointer-events-auto gap-1.5 pr-3.5 pl-3"
										data-testid="chat-jump-to-latest"
										onclick={() =>
											timeline ? timelineView?.jumpToLatest() : transcript?.jumpToLatest()}
									>
										<Icon name="arrow-down" size={14} />
										{newContentBelow ? 'New messages below' : 'Jump to latest'}
									</Button>
								</div>
							{/if}
							<div class="chat-stage-inset flex flex-col">
								<div bind:borderBoxSize={traySize}>
									{#if notice || (showsSessionChanges && sessionChanges) || childRequestsWaiting || uncheckedCallsWaiting || decisionsWaiting || backgroundWork || jobs || queuedPrompts.length > 0}
										<div class="chat-column px-7" transition:slide={foldMotion()}>
											<div
												class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] overflow-hidden rounded-t-xl border-x-[0.5px] border-t-[0.5px]"
												data-testid="chat-composer-tray"
											>
												{#if notice}
													<div transition:slide={foldMotion()}>
														{@render notice()}
													</div>
												{/if}

												{#if childRequestsWaiting}
													<div transition:slide={foldMotion()}>
														<RequestsWaiting
															count={childSteps.length}
															onanswer={() => (answerLaterKeys = new Set())}
														/>
													</div>
												{/if}

												{#if decisionsWaiting}
													<div transition:slide={foldMotion()}>
														<RequestsWaiting
															count={openDecisions.length}
															decisions
															onanswer={() =>
																focusLeadDecisionCommand(openDecisions[0]?.id ?? null)}
														/>
													</div>
												{/if}

												{#if uncheckedCallsWaiting}
													<div transition:slide={foldMotion()}>
														<RequestsWaiting
															count={uncheckedSteps.length}
															unchecked
															onanswer={() => (answeringUnchecked = true)}
														/>
													</div>
												{/if}

												{#if showsSessionChanges && sessionChanges}
													<div transition:slide={foldMotion()}>
														<ChatChangedFiles
															changes={sessionChanges}
															openingPath={openingChangedFilePath}
															onopen={onOpenChangedFile}
														/>
													</div>
												{/if}

												{#if jobs}
													<div transition:slide={foldMotion()}>
														{@render jobs()}
													</div>
												{/if}

												{#if backgroundWork && sessionId}
													<div transition:slide={foldMotion()}>
														<BackgroundTaskList
															work={backgroundWork}
															onstop={(taskId) => stopBackgroundTaskCommand(sessionId, taskId)}
														/>
													</div>
												{/if}

												{#if queuedPrompts.length > 0}
													<div transition:slide={foldMotion()}>
														<QueuedPromptList
															{workstreamId}
															items={queuedPrompts}
															{isRunning}
															paused={queuePaused}
															sendingId={queueSendingId}
															errorById={queueErrorById}
															onupdate={updateQueuedPromptCommand}
															onremove={removeQueuedPromptCommand}
															onsendnext={sendQueuedPromptCommand}
															onpausechange={pausePromptQueueCommand}
														/>
													</div>
												{/if}
											</div>
										</div>
									{/if}
								</div>

								{#if asking}
									<AgentQuestionPanel requests={pendingQuestions} />
								{:else if answeringChildren}
									<ChildRequestQueue
										steps={childSteps}
										onlater={() => (answerLaterKeys = new Set(childSteps.map(({ key }) => key)))}
									/>
								{:else if showsUncheckedQueue}
									<ChildRequestQueue
										steps={uncheckedSteps}
										onlater={() => (answeringUnchecked = false)}
									/>
								{/if}
								{#if showsDecisions}
									<LeadDecisionQueue
										decisions={changingDecision ? [changingDecision] : openDecisions}
										focusedId={changingDecision?.id ?? decisionFocus.focusedId}
										onlater={() =>
											changingDecision
												? focusLeadDecisionCommand(null)
												: setLeadDecisionsAsideCommand(openDecisions.map(({ id }) => id))}
									/>
								{/if}
								<SecretRequestCard sessionId={secretsSessionId} />
								<div bind:this={composerSlot} class={[composerHidden && 'hidden']}>
									<ChatComposer
										bind:this={composer}
										{sessionId}
										bind:transcriptReferences
										bind:elementReferences
										{forceFreshSession}
										{selection}
										{profile}
										{envelopes}
										{isRunning}
										disabled={bootError !== null || presentationPending}
										backendSelectionDisabled={bootError !== null || presentationPending}
										placeholder={timeline
											? openDecisions.length > 0
												? 'Answer in your own words, or ask the lead anything…'
												: 'Ask the lead anything…'
											: undefined}
										oncancel={cancelRunCommand}
										onbackendchange={selectModelCommand}
										onprofilechange={selectRunProfileCommand}
									/>
								</div>
							</div>
						</div>

						{#if viewedDecision && decisionFocus.viewing}
							<LeadDecisionViewer
								decision={viewedDecision}
								option={decisionFocus.viewing.option}
								onclose={closeLeadDecisionViewerCommand}
							/>
						{/if}

						{#if documentActive}
							<div class="bg-surface-root absolute inset-0 z-30 flex min-h-0">
								<WorkstreamDocument {workstreamId} />
							</div>
						{/if}
					</div>
				</section>
			</div>
		</div>
	</div>
</div>

<style>
	.transcript-stage {
		container-type: inline-size;
	}

	.chat-footer-scrim::before {
		position: absolute;
		bottom: 100%;
		right: var(--scrollbar-gutter);
		left: 0;
		height: 1.5rem;
		content: '';
		pointer-events: none;
		background: linear-gradient(to bottom, transparent, var(--color-surface-root));
	}

	.chat-footer-scrim::after {
		position: absolute;
		z-index: -1;
		inset: 0 var(--scrollbar-gutter) 0 0;
		content: '';
		pointer-events: none;
		background-color: var(--color-surface-root);
	}
</style>
