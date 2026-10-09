<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { applyModelDefaultsCommand } from '$lib/chat/application/commands/apply-model-defaults.command';
	import { cancelRunCommand } from '$lib/chat/application/commands/cancel-run.command';
	import { closeFreshChatCommand } from '$lib/chat/application/commands/close-fresh-chat.command';
	import { openChangedFileCommand } from '$lib/chat/application/commands/open-changed-file.command';
	import { pausePromptQueueCommand } from '$lib/chat/application/commands/pause-prompt-queue.command';
	import { removeQueuedPromptCommand } from '$lib/chat/application/commands/remove-queued-prompt.command';
	import { selectModelCommand } from '$lib/chat/application/commands/select-model.command';
	import { selectRunProfileCommand } from '$lib/chat/application/commands/select-run-profile.command';
	import { sendQueuedPromptCommand } from '$lib/chat/application/commands/send-queued-prompt.command';
	import { startFreshChatCommand } from '$lib/chat/application/commands/start-fresh-chat.command';
	import { updateQueuedPromptCommand } from '$lib/chat/application/commands/update-queued-prompt.command';
	import { followChatRouteHook } from '$lib/chat/application/hooks/follow-chat-route.hook.svelte';
	import { preloadOpenChatsHook } from '$lib/chat/application/hooks/preload-open-chats.hook.svelte';
	import { watchAgentLifecycleHook } from '$lib/chat/application/hooks/watch-agent-lifecycle.hook.svelte';
	import { watchSessionChangesHook } from '$lib/chat/application/hooks/watch-session-changes.hook.svelte';
	import { activeModelQuery } from '$lib/chat/application/queries/active-model.query.svelte';
	import { activeSessionQuery } from '$lib/chat/application/queries/active-session.query.svelte';
	import { chatPreparingQuery } from '$lib/chat/application/queries/chat-preparing.query.svelte';
	import { chatRunningQuery } from '$lib/chat/application/queries/chat-running.query.svelte';
	import { composerDraftQuery } from '$lib/chat/application/queries/composer-draft.query.svelte';
	import { emptySessionModeQuery } from '$lib/chat/application/queries/empty-session-mode.query.svelte';
	import { freshChatReturnQuery } from '$lib/chat/application/queries/fresh-chat-return.query.svelte';
	import { freshSessionRequestedQuery } from '$lib/chat/application/queries/fresh-session-requested.query.svelte';
	import { openingChangedFileQuery } from '$lib/chat/application/queries/opening-changed-file.query.svelte';
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
	import { rememberedModelsQuery } from '$lib/chat/application/queries/remembered-models.query.svelte';
	import { agentDraftScopeKey } from '$lib/chat/domain/draft';
	import type { AgentElementReference } from '$lib/chat/domain/element-reference';
	import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
	import { WorkstreamDocument } from '$lib/extensions/extensions.api';
	import { workstreamTabs } from '$shared/shell/workstream-tabs.store.svelte';
	import { loadModelDefaultsCommand, modelDefaultsQuery } from '$shared/providers/providers.api';
	import {
		DependencyInstallBanner,
		type AgentSessionChangedFile,
	} from '$shared/repositories/repositories.api';
	import AgentProcessDiedBanner from './AgentProcessDiedBanner.svelte';
	import ChatChangedFiles from './ChatChangedFiles.svelte';
	import ChatColdShell from './ChatColdShell.svelte';
	import ChatComposer from './ChatComposer.svelte';
	import ChatEmptySession from './ChatEmptySession.svelte';
	import ChatMessageList from './ChatMessageList.svelte';
	import ChatSessionError from './ChatSessionError.svelte';
	import ChatTabs from './ChatTabs.svelte';
	import FreshChatSuggestions from './FreshChatSuggestions.svelte';
	import QueuedPromptList from './QueuedPromptList.svelte';
	import type { TranscriptComposerControls } from './chat-message-list/transcript-context';
	import { chatStage } from './chat-stage';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const releaseChatRoute = followChatRouteHook();
	const stopPreloadingOpenChats = preloadOpenChatsHook();
	const releaseSessionChanges = watchSessionChangesHook();
	const releaseAgentLifecycle = watchAgentLifecycleHook();

	onMount(() => {
		loadModelDefaultsCommand();
	});

	onDestroy(() => {
		releaseSessionChanges();
		releaseAgentLifecycle();
		releaseChatRoute();
		stopPreloadingOpenChats();
	});

	const sessionId = $derived(activeSessionQuery.data);
	const requestedSessionId = $derived(requestedSessionQuery.data);
	const restoringSessionId = $derived(restoringSessionQuery.data);
	const bootError = $derived(sessionBootErrorQuery.data);
	const emptySessionMode = $derived(emptySessionModeQuery.data);
	const forceFreshSession = $derived(freshSessionRequestedQuery.data);
	const model = $derived(activeModelQuery.data);
	const profile = $derived(runProfileQuery.data);
	const modelDefaults = $derived(modelDefaultsQuery.data);
	const rememberedModels = $derived(rememberedModelsQuery.data);
	const isRunning = $derived(chatRunningQuery.data);
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
	const sessionChanges = $derived(sessionChangesQuery.data);
	const sessionChangesTargetId = $derived(sessionChangesTargetQuery.data);
	const openingChangedFilePath = $derived(openingChangedFileQuery.data);
	const draftScope = $derived(agentDraftScopeKey(workstreamId, sessionId));
	const scopedDraft = $derived(composerDraftQuery.data(draftScope));

	let footerHeight = $state(0);

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
	const showsSessionChanges = $derived(
		!freshChat &&
			!presentationPending &&
			sessionChanges?.sessionId === sessionId &&
			sessionChanges.files.length > 0,
	);

	const editorComposerControls = $derived<TranscriptComposerControls>({
		model,
		profile,
		modelDefaults,
		rememberedModels,
		envelopes,
		isRunning,
		backendSelectionDisabled: bootError !== null || presentationPending,
		onbackendchange: selectModelCommand,
		onprofilechange: selectRunProfileCommand,
		onmodelsettingschange: applyModelDefaultsCommand,
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

	let composer: { focus(options?: { scrollIntoView?: boolean }): boolean } | null = $state(null);
	const presentationKey = $derived(`${workstreamId}::${presentedSessionId ?? 'fresh'}`);
	let focusedPresentationKey: string | null = null;

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
		if (!document.hasFocus()) return false;
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) return true;
		if (active.closest('[role="dialog"]')) return false;
		return !active.matches('input, textarea, [contenteditable], [role="textbox"]');
	}

	function onOpenChangedFile(file: AgentSessionChangedFile): void {
		openChangedFileCommand({ workstreamId, targetSessionId: sessionChangesTargetId, file });
	}
</script>

<div data-testid="chat-surface" class="flex h-full min-h-0 w-full flex-col overflow-hidden">
	<AgentProcessDiedBanner />
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
						freshCloseNavigationTarget={closeFreshNavigationTarget}
					/>

					<div
						class="transcript-stage relative min-h-0 flex-1"
						style={`--chat-footer-inset: ${footerHeight}px;`}
						aria-busy={presentationPending}
						data-session-switching={presentationPending ? 'true' : undefined}
					>
						<div
							class="absolute inset-0 z-0 flex min-h-0 flex-col"
							inert={documentActive || undefined}
						>
							{#if stage === 'fresh'}
								<FreshChatSuggestions {workstreamId} {draftScope} bind:transcriptReferences />
							{:else if stage === 'transcript' && presentedSessionId}
								<div
									class="contents"
									inert={retainingSourcePresentation ? true : undefined}
									data-navigation-retained={retainingSourcePresentation ? 'true' : undefined}
									data-presented-workstream-id={presentedWorkstreamId}
								>
									<ChatMessageList
										workstreamId={presentedWorkstreamId}
										sessionId={presentedSessionId}
										envelopes={presentedTranscript.envelopes}
										composerControls={editorComposerControls}
										spaceBelow={footerHeight}
									>
										{#snippet empty()}
											<FreshChatSuggestions {workstreamId} {draftScope} bind:transcriptReferences />
										{/snippet}
									</ChatMessageList>
								</div>
							{:else if stage === 'error' && bootError}
								<ChatSessionError {workstreamId} {sessionId} error={bootError} />
							{:else if stage === 'cold'}
								<ChatColdShell {workstreamId} pendingSessionId={pendingSessionId ?? sessionId} />
							{:else}
								<ChatEmptySession />
							{/if}
						</div>

						<div
							class="chat-footer-scrim absolute inset-x-0 bottom-0 z-20 pr-[var(--scrollbar-gutter)]"
							bind:clientHeight={footerHeight}
							inert={documentActive || undefined}
							data-testid="chat-footer-stack"
						>
							<div class="chat-stage-inset flex flex-col">
								{#if showsSessionChanges && sessionChanges}
									<ChatChangedFiles
										changes={sessionChanges}
										openingPath={openingChangedFilePath}
										onopen={onOpenChangedFile}
									/>
								{/if}

								{#if queuedPrompts.length > 0}
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
								{/if}

								<ChatComposer
									bind:this={composer}
									{sessionId}
									bind:transcriptReferences
									bind:elementReferences
									{forceFreshSession}
									{model}
									{profile}
									{modelDefaults}
									{rememberedModels}
									{envelopes}
									{isRunning}
									disabled={bootError !== null || presentationPending}
									backendSelectionDisabled={bootError !== null || presentationPending}
									oncancel={cancelRunCommand}
									onbackendchange={selectModelCommand}
									onprofilechange={selectRunProfileCommand}
									onmodelsettingschange={applyModelDefaultsCommand}
								/>
							</div>
						</div>

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
