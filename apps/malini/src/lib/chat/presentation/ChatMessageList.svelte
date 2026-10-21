<script lang="ts">
	import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
	import { copyTextCommand } from '$lib/chat/application/commands/copy-text.command';
	import { forkToNewChatCommand } from '$lib/chat/application/commands/fork-to-new-chat.command';
	import { implementPlanCommand } from '$lib/chat/application/commands/implement-plan.command';
	import { openAttachmentFileCommand } from '$lib/chat/application/commands/open-attachment-file.command';
	import { redoCheckpointCommand } from '$lib/chat/application/commands/redo-checkpoint.command';
	import { sendCommandPromptCommand } from '$lib/chat/application/commands/send-command-prompt.command';
	import { rememberTranscriptAnchorCommand } from '$lib/chat/application/commands/remember-transcript-anchor.command';
	import { rememberTranscriptHeightsCommand } from '$lib/chat/application/commands/remember-transcript-heights.command';
	import { syncInteractionsCommand } from '$lib/chat/application/commands/sync-interactions.command';
	import { keepWorkstreamFilesFreshHook } from '$lib/chat/application/hooks/keep-workstream-files-fresh.hook';
	import { openFileMentionHook } from '$lib/chat/application/hooks/open-file-mention.hook';
	import { workstreamImageSourceHook } from '$lib/chat/application/hooks/workstream-image-source.hook.svelte';
	import { fileMentionIndexQuery } from '$lib/chat/application/queries/file-mention-index.query.svelte';
	import { resolveFileMention } from '$lib/chat/domain/file-mention-index';
	import { finalizeStreamingHook } from '$lib/chat/application/hooks/finalize-streaming.hook';
	import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
	import { implementationModelLabelQuery } from '$lib/chat/application/queries/implementation-model-label.query.svelte';
	import { liveToolInputQuery } from '$lib/chat/application/queries/live-tool-input.query.svelte';
	import { liveToolInputsQuery } from '$lib/chat/application/queries/live-tool-inputs.query.svelte';
	import { workstreamChatsQuery } from '$lib/chat/application/queries/workstream-chats.query.svelte';
	import { workstreamRunEndsQuery } from '$lib/chat/application/queries/workstream-run-ends.query.svelte';
	import { sessionDisplayNameQuery } from '$lib/chat/application/queries/session-display-name.query.svelte';
	import { sessionWaitingForUserQuery } from '$lib/chat/application/queries/session-waiting-for-user.query.svelte';
	import { backgroundWorkQuery } from '$lib/chat/application/queries/background-work.query.svelte';
	import { streamingBlocksQuery } from '$lib/chat/application/queries/streaming-blocks.query.svelte';
	import { transcriptAnchorQuery } from '$lib/chat/application/queries/transcript-anchor.query.svelte';
	import { transcriptHeightsQuery } from '$lib/chat/application/queries/transcript-heights.query.svelte';
	import { newChatRequestId, type ChatRequestId } from '$lib/chat/domain/chat-request';
	import { redoFailureOffersBranch } from '$lib/chat/domain/checkpoint-requests';
	import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
	import { shellCommandPrompt } from '$lib/chat/domain/shell-command-prompt';
	import type { EventEnvelope } from '$lib/chat/domain/events';
	import type { SessionId } from '$lib/chat/domain/session';
	import type { TranscriptAnchor } from '$lib/chat/domain/transcript-anchor';
	import { Button } from '$hyper-ui/components/button';
	import { resizableSplitInset } from '$hyper-ui/components/resizable-split';
	import { JobRunCards } from '$lib/jobs/jobs.api';
	import {
		firstPromptKey,
		stableToolKey,
		type RenderItem,
		type RenderState,
		type RunGroup,
		type ToolAggregate,
	} from './render-state';
	import { runProjectionVersion } from './render-projector';
	import ImageContextMenu from './ImageContextMenu.svelte';
	import ImageGallery from './ImageGallery.svelte';
	import {
		isGalleryAttachment,
		transcriptGalleryImages,
		type GalleryImage,
	} from './transcript-gallery';
	import { exposeArrivalMotionForTuning } from './arrival-motion';
	import type { FinalizedStreamingThought } from '$lib/chat/domain/streaming-block';
	import { summarizeLiveToolInput } from './tool-display-name';
	import FileMentionChooser, {
		type FileMentionChoice,
	} from './chat-message-list/FileMentionChooser.svelte';
	import type { FileMentionTarget } from './file-mention-links';
	import { createCheckpointEditor } from './chat-message-list/checkpoint-edit.svelte';
	import { createDestructiveConfirm } from './chat-message-list/destructive-confirm.svelte';
	import { createOpenRunGuard } from './chat-message-list/open-run-guard.svelte';
	import { pendingPromptQuery } from '$lib/chat/application/queries/pending-prompt.query.svelte';
	import { createRowArrivals } from './chat-message-list/row-arrival';
	import { sessionProjectorCache } from './chat-message-list/session-projectors';
	import { blockKey, toolInputKey } from './chat-message-list/streaming-finalization';
	import { createTimelineDerivations } from './chat-message-list/timeline-derivations.svelte';
	import {
		setTranscriptContext,
		type TranscriptComposerControls,
	} from './chat-message-list/transcript-context';
	import { createTranscriptScroll } from './chat-message-list/transcript-scroll.svelte';
	import { createTranscriptSettleGate } from './chat-message-list/transcript-settle';
	import { openingBudgets } from './chat-message-list/transcript-estimates';
	import {
		createTranscriptWindow,
		runWindowKey,
	} from './chat-message-list/transcript-window.svelte';
	import TranscriptRun, { type LiveRunBlocks } from './chat-message-list/TranscriptRun.svelte';

	interface Props {
		workstreamId: string;
		sessionId: SessionId;
		envelopes: readonly EventEnvelope[];
		composerControls?: TranscriptComposerControls | null;
		pullRequestShipped?: boolean;
		spaceBelow?: number;
		overlayBelow?: number;
		contentBelow?: boolean;
		newContentBelow?: boolean;
		empty: Snippet;
	}

	let {
		workstreamId,
		sessionId,
		envelopes,
		composerControls = null,
		pullRequestShipped = false,
		spaceBelow = 0,
		overlayBelow = 0,
		contentBelow = $bindable(false),
		newContentBelow = $bindable(false),
		empty,
	}: Props = $props();

	const splitInset = resizableSplitInset();

	const requestOutcome = $derived(chatRequestQuery.data);
	const implementationModelLabel = $derived(implementationModelLabelQuery.data);

	const sessionProjectors = $derived(sessionProjectorCache.acquire(sessionId));
	const renderState = $derived<RenderState>(sessionProjectors.render.project(envelopes));
	const pendingPrompt = $derived(pendingPromptQuery.data(sessionId));
	const rememberedAnchor = $derived(transcriptAnchorQuery.data(sessionId));
	const rememberedHeights = $derived(transcriptHeightsQuery.data(sessionId));
	const waitingForUser = $derived(sessionWaitingForUserQuery.data(sessionId));
	const backgroundWork = $derived(backgroundWorkQuery.data(sessionId));

	let showUndone = $state(false);

	const visibleRuns = $derived(
		showUndone ? renderState.runs : renderState.runs.filter((run) => !run.superseded),
	);
	const runs = $derived.by(() => {
		const visible = visibleRuns;
		const runId = pendingPrompt?.runId;
		if (!pendingPrompt || !runId) return visible;
		if (visible.some((run) => run.runId === runId)) return visible;
		const opening: RenderItem = {
			kind: 'user',
			key: firstPromptKey(runId),
			seq: 0,
			text: pendingPrompt.text,
			...(pendingPrompt.attachments.length
				? { attachments: pendingPrompt.attachments.map((attachment) => ({ ...attachment })) }
				: {}),
		};
		return [
			...visible,
			{
				runId,
				items: [opening],
				terminal: null,
				terminalText: '',
				superseded: false,
				obsoleted: false,
			},
		];
	});

	const runIds = $derived(runs.map((run) => run.runId));

	const branchedFromSessionId = $derived(renderState.facts.branchedFromSessionId);
	const branchedFrom = $derived(
		branchedFromSessionId === null
			? null
			: (sessionDisplayNameQuery.data(branchedFromSessionId) ?? 'another chat'),
	);

	const hasTranscriptContent = $derived(
		runs.some((run) => run.items.length > 0 || run.terminal !== null),
	);
	const hasSupersededRuns = $derived(renderState.runs.some((run) => run.superseded));

	const redoCheckpointTarget = $derived(renderState.facts.redoCheckpointTarget);

	const isEmpty = $derived(
		(envelopes.length === 0 || !hasTranscriptContent) &&
			!pendingPrompt &&
			!hasSupersededRuns &&
			!redoCheckpointTarget,
	);

	const latestRun = $derived(runs[runs.length - 1] ?? null);
	const isLatestRunOpen = $derived(latestRun !== null && latestRun.terminal === null);

	const latestImplementablePlanKey = $derived.by(() => {
		const run = runs.at(-1);
		if (!run || run.terminal !== 'completed') return null;
		for (let itemIndex = run.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
			const item = run.items[itemIndex];
			if (item?.kind === 'plan') return `${run.runId}:${item.key}`;
		}
		return null;
	});

	let copyResponseRequest = $state<Readonly<{ runId: string; requestId: ChatRequestId }> | null>(
		null,
	);
	let copyErrorRequest = $state<Readonly<{ key: string; requestId: ChatRequestId }> | null>(null);
	const copyResponseOutcome = $derived(requestOutcome(copyResponseRequest?.requestId ?? null));
	const copyErrorOutcome = $derived(requestOutcome(copyErrorRequest?.requestId ?? null));
	const copiedResponseRunId = $derived(
		copyResponseOutcome?.status === 'accepted' ? (copyResponseRequest?.runId ?? null) : null,
	);
	const copiedErrorKey = $derived(
		copyErrorOutcome?.status === 'accepted' ? (copyErrorRequest?.key ?? null) : null,
	);
	let implementRequest = $state<Readonly<{ key: string; requestId: ChatRequestId }> | null>(null);
	const implementOutcome = $derived(requestOutcome(implementRequest?.requestId ?? null));
	const implementingPlanKey = $derived(
		implementRequest && implementOutcome?.status === 'pending' ? implementRequest.key : null,
	);
	let expandedActivityGroups = $state<Record<string, boolean>>({});
	let reducedMotion = false;

	const openFileMentionTarget = openFileMentionHook(() => workstreamId);
	const fileMentionIndex = $derived(fileMentionIndexQuery.data(workstreamId));
	const canOpenFileMention = $derived.by(() => {
		const index = fileMentionIndex;
		if (index === null) return undefined;
		return (path: string): boolean => resolveFileMention(index, { path, line: null }).length > 0;
	});
	let fileMentionChoice = $state<FileMentionChoice | null>(null);
	let fileMentionChooserOpen = $state(false);
	const finalizeStreaming = finalizeStreamingHook();

	$effect(() => keepWorkstreamFilesFreshHook(workstreamId));

	const transcriptImageSource = workstreamImageSourceHook(() => workstreamId);
	const markdownImageSource = $derived(transcriptImageSource());

	let gallery = $state.raw<Readonly<{ images: readonly GalleryImage[]; startId: string }> | null>(
		null,
	);

	function openImageGallery(id: string): void {
		gallery = { images: transcriptGalleryImages(runs, workstreamId), startId: id };
	}

	function openAttachment(attachment: StagedAgentAttachment): void {
		if (isGalleryAttachment(attachment)) openImageGallery(attachment.relativePath);
		else openAttachmentFileCommand(workstreamId, attachment);
	}

	function openFileMention(target: FileMentionTarget, mention: HTMLElement): void {
		openFileMentionTarget(target, (targets) => {
			fileMentionChoice = { mention: target, anchor: mention, targets };
			fileMentionChooserOpen = true;
		});
	}

	function onChooseFileMention(target: FileMentionTarget): void {
		fileMentionChooserOpen = false;
		openFileMentionTarget(target, () => undefined);
	}

	const settle = createTranscriptSettleGate();
	const transcriptScroll = createTranscriptScroll({
		prefersReducedMotion: () => reducedMotion,
		remember: rememberTranscriptAnchorCommand,
	});
	const { releaseScrollPin } = transcriptScroll;
	const rowArrivals = createRowArrivals({
		settle,
		opening: () => transcriptScroll.opening,
		prefersReducedMotion: () => reducedMotion,
	});
	const { stageEnter, promptArrival, glideRowLayout, rebaseRowLayout } = rowArrivals;
	const transcriptWindow = createTranscriptWindow();
	let listRendered = false;
	let openingAnchor: TranscriptAnchor | null = null;
	const OPENING_TAIL_VIEWPORTS = 2.5;
	let openingBudgetByRun: ReadonlyMap<string, number> | null = null;

	function openingBudget(runId: string): number {
		openingBudgetByRun ??= openingAnchor
			? new Map()
			: openingBudgets(
					untrack(() => runs),
					(id) => transcriptWindow.heightOf(runWindowKey(id)),
					globalThis.innerHeight * OPENING_TAIL_VIEWPORTS,
				);
		return openingBudgetByRun.get(runId) ?? 0;
	}

	let viewportEl: HTMLDivElement | null = $state(null);
	let messageListEl: HTMLOListElement | null = $state(null);

	const timelines = createTimelineDerivations({
		runs: () => runs,
		projectRun: (run) =>
			sessionProjectors.timeline.project(run, finalizedThinkingForRun(run.runId)),
		retainRuns: (runIds) => sessionProjectors.timeline.retainRuns(runIds),
		thoughtsForRun: (runId) => finalizedThinkingForRun(runId),
	});
	const { timelineItems } = timelines;

	function firstUserKey(run: RunGroup): string | null {
		return timelineItems(run).find((item) => item.kind === 'user')?.key ?? null;
	}

	function timelineKey(run: RunGroup, key: string): string {
		return blockKey(sessionId, run.runId, key);
	}

	function stageLatestRunEnter(node: HTMLElement, key: string): { destroy: () => void } {
		const latestRunId = runs.at(-1)?.runId;
		if (!latestRunId || !key.startsWith(blockKey(sessionId, latestRunId, ''))) {
			return { destroy: () => undefined };
		}
		return stageEnter(node, key);
	}

	function showOlderTimeline(runId: string, reference: HTMLElement | null): Promise<void> {
		return transcriptScroll.revealOlderContent(reference, async () => {
			rebaseRowLayout();
			timelines.revealOlderTimeline(runId);
			await tick();
		});
	}

	const latestVisibleRun = $derived(visibleRuns.at(-1) ?? null);
	const openRunId = $derived(latestVisibleRun?.terminal === null ? latestVisibleRun.runId : null);

	const persistedStreamingMembership = $derived(sessionProjectors.streaming.project(envelopes));

	const liveBlocksForOpenRun = $derived(
		openRunId ? streamingBlocksQuery.data(sessionId, openRunId) : [],
	);
	const liveAssistantBlocks = $derived(
		liveBlocksForOpenRun.filter(
			(block) =>
				block.kind === 'assistant' &&
				!persistedStreamingMembership.finalizedBlockKeys.has(
					blockKey(sessionId, block.runId, block.contentId),
				),
		),
	);
	const liveThinkingBlocks = $derived(
		liveBlocksForOpenRun.filter(
			(block) =>
				block.kind === 'thinking' &&
				!persistedStreamingMembership.finalizedBlockKeys.has(
					blockKey(sessionId, block.runId, block.contentId),
				),
		),
	);
	const livePendingToolInputs = $derived(
		openRunId
			? liveToolInputsQuery
					.data(sessionId, openRunId)
					.filter(
						(entry) =>
							!persistedStreamingMembership.startedToolInputKeys.has(
								toolInputKey(openRunId, entry.toolCallId),
							),
					)
			: [],
	);

	const livePendingToolItems = $derived(
		openRunId
			? livePendingToolInputs.map((pending) => ({
					kind: 'tool' as const,
					key: stableToolKey(openRunId, pending.name, pending.toolCallId, 0),
					seq: Number.MAX_SAFE_INTEGER,
					tool: {
						name: pending.name,
						toolCallId: pending.toolCallId,
						startedAt: null,
						completedAt: null,
						input: summarizeLiveToolInput(pending.json),
						output: undefined,
						status: 'running' as const,
					},
				}))
			: [],
	);

	const liveRun = $derived<LiveRunBlocks>({
		pendingToolItems: livePendingToolItems,
		thinking: liveThinkingBlocks,
		assistant: liveAssistantBlocks,
	});

	let finalizedThinkingRevision = $state(0);

	function finalizedThinkingForRun(runId: string): readonly FinalizedStreamingThought[] {
		persistedStreamingMembership.thoughtRevision;
		finalizedThinkingRevision;
		return sessionProjectors.streaming.finalizedThoughtsForRun(runId);
	}

	function liveInputJsonForRunningTool(runId: string, tool: ToolAggregate): string | null {
		return tool.toolCallId ? liveToolInputQuery.data(sessionId, runId, tool.toolCallId) : null;
	}

	function assistantTextForRun(run: RunGroup): string {
		return run.items
			.filter((item) => item.kind === 'assistant')
			.map((item) => (item.kind === 'assistant' ? item.text : ''))
			.join('\n\n')
			.trim();
	}

	function copyRunResponse(run: RunGroup): void {
		const text = assistantTextForRun(run);
		if (!text) return;
		const requestId = newChatRequestId();
		copyResponseRequest = { runId: run.runId, requestId };
		copyTextCommand({ requestId, text });
	}

	function copyErrorText(key: string, error: string): void {
		const requestId = newChatRequestId();
		copyErrorRequest = { key, requestId };
		copyTextCommand({ requestId, text: error });
	}

	$effect(() => {
		if (copiedResponseRunId === null) return;
		const reset = setTimeout(() => {
			copyResponseRequest = null;
		}, 1600);
		return () => clearTimeout(reset);
	});

	$effect(() => {
		if (copiedErrorKey === null) return;
		const reset = setTimeout(() => {
			copyErrorRequest = null;
		}, 1600);
		return () => clearTimeout(reset);
	});

	function implementPlan(runId: string, itemKey: string, plan: string): void {
		if (implementingPlanKey) return;
		const requestId = newChatRequestId();
		implementRequest = { key: `${runId}:${itemKey}`, requestId };
		implementPlanCommand({
			requestId,
			workstreamId,
			plan,
			sourceSessionId: sessionId,
			sourceRunId: runId,
		});
	}

	function runShellCommand(command: string, language: string | null): void {
		sendCommandPromptCommand({
			workstreamId,
			sessionId,
			prompt: shellCommandPrompt(command, language),
		});
	}

	const checkpointEdit = createCheckpointEditor({
		outcomeOf: (requestId) => requestOutcome(requestId),
		runs: () => runs,
		blocked: () => workstreamRunInFlight,
		workstreamId: () => workstreamId,
		openEditor: (row, mutate) => {
			if (row) return transcriptScroll.holdRowTop(row, mutate);
			releaseScrollPin();
			return Promise.resolve(mutate());
		},
	});

	const runUndo = createDestructiveConfirm({ outcomeOf: (requestId) => requestOutcome(requestId) });

	const locallyVisibleRunInFlight = $derived(
		isLatestRunOpen ||
			workstreamChatsQuery
				.data(workstreamId)
				.some(
					(candidate) =>
						candidate.status === 'running' || candidate.status === 'waiting_for_approval',
				),
	);

	const nativeOpenRun = createOpenRunGuard({
		workstreamId: () => workstreamId,
		revalidateOn: () => [locallyVisibleRunInFlight, workstreamRunEndsQuery.data(workstreamId)],
	});

	const workstreamRunInFlight = $derived(locallyVisibleRunInFlight || nativeOpenRun.inFlight);

	let redoRequest = $state<Readonly<{ requestId: ChatRequestId; toSeq: number }> | null>(null);
	let redoForkRequestId = $state<ChatRequestId | null>(null);
	const redoOutcome = $derived(requestOutcome(redoRequest?.requestId ?? null));
	const redoForkOutcome = $derived(requestOutcome(redoForkRequestId));
	const redoSubmitting = $derived(redoOutcome?.status === 'pending');
	const redoFailure = $derived(redoOutcome?.status === 'failed' ? redoOutcome.error : null);
	const redoForkAtSeq = $derived(
		redoRequest && redoFailureOffersBranch(redoFailure) ? redoRequest.toSeq : null,
	);
	const redoError = $derived(
		redoForkOutcome?.status === 'failed'
			? redoForkOutcome.error
			: redoForkAtSeq !== null
				? null
				: redoFailure,
	);

	function redoCheckpoint(): void {
		const target = redoCheckpointTarget;
		if (!target || workstreamRunInFlight || redoSubmitting) return;
		const requestId = newChatRequestId();
		redoRequest = { requestId, toSeq: target.toSeq };
		redoForkRequestId = null;
		redoCheckpointCommand({ requestId, restoreSeq: target.restoreSeq });
	}

	function forkInsteadOfRedo(): void {
		const atSeq = redoForkAtSeq;
		if (atSeq === null) return;
		const requestId = newChatRequestId();
		redoForkRequestId = requestId;
		forkToNewChatCommand({ requestId, atSeq });
	}

	setTranscriptContext({
		get workstreamId() {
			return workstreamId;
		},
		get sessionId() {
			return sessionId;
		},
		stageEnter: stageLatestRunEnter,
		transcriptSettled: settle.isSettled,
		promptArrival,
		timelineKey,
		firstUserKey,
		get submittedRunId() {
			return pendingPrompt?.runId ?? null;
		},
		checkpointEdit,
		get composerControls() {
			return composerControls;
		},
		runUndo,
		get workstreamRunInFlight() {
			return workstreamRunInFlight;
		},
		get chatRunInFlight() {
			return isLatestRunOpen;
		},
		get waitingForUser() {
			return waitingForUser;
		},
		get pullRequestShipped() {
			return pullRequestShipped;
		},
		get copiedErrorKey() {
			return copiedErrorKey;
		},
		copyErrorText,
		get expandedActivityGroups() {
			return expandedActivityGroups;
		},
		get implementationModelLabel() {
			return implementationModelLabel;
		},
		get latestImplementablePlanKey() {
			return latestImplementablePlanKey;
		},
		get implementingPlanKey() {
			return implementingPlanKey;
		},
		implementPlan,
		runShellCommand,
		liveInputJsonForRunningTool,
		openFileMention,
		get canOpenFileMention() {
			return canOpenFileMention;
		},
		get markdownImageSource() {
			return markdownImageSource;
		},
		openImageGallery,
		openAttachment,
		earlierTurns: (runId) => renderState.earlierTurns.get(runId) ?? [],
		undoTarget: (runId) => renderState.undoTargets.get(runId) ?? null,
		window: transcriptWindow,
		timelines,
		get openingAnchor() {
			return openingAnchor;
		},
		openingBudget,
		listRendered: () => listRendered,
		get backgroundWork() {
			return backgroundWork;
		},
		glideRowLayout,
		rebaseRowLayout,
		showOlderTimeline,
		copyRunResponse,
	});

	function isInteractionLifecycleEnvelope(envelope: EventEnvelope): boolean {
		return (
			envelope.event.type === 'approval.requested' ||
			envelope.event.type === 'question.requested' ||
			envelope.event.type === 'run.completed' ||
			envelope.event.type === 'run.failed'
		);
	}

	let syncedInteractionSessionId: string | null = null;
	let syncedInteractionSource: readonly EventEnvelope[] | null = null;
	let syncedInteractionLength = 0;

	$effect(() => {
		const currentSessionId = sessionId;
		const currentEnvelopes = envelopes;
		const currentLength = currentEnvelopes.length;
		untrack(() => {
			const requiresFullSync =
				syncedInteractionSessionId !== currentSessionId ||
				syncedInteractionSource !== currentEnvelopes ||
				currentLength < syncedInteractionLength;
			const suffixStart = requiresFullSync ? 0 : syncedInteractionLength;
			let containsInteractionLifecycle = requiresFullSync;
			for (
				let index = suffixStart;
				!containsInteractionLifecycle && index < currentLength;
				index += 1
			) {
				const envelope = currentEnvelopes[index];
				containsInteractionLifecycle = Boolean(
					envelope && isInteractionLifecycleEnvelope(envelope),
				);
			}

			syncedInteractionSessionId = currentSessionId;
			syncedInteractionSource = currentEnvelopes;
			syncedInteractionLength = currentLength;
			if (containsInteractionLifecycle) {
				syncInteractionsCommand(currentSessionId, currentEnvelopes);
			}
		});
	});

	$effect(() => {
		const currentEnvelopes = envelopes;
		const currentStreamingProjector = sessionProjectors.streaming;
		const projectionRevision = persistedStreamingMembership.revision;
		currentEnvelopes.length;
		untrack(() => {
			void projectionRevision;
			if (
				finalizeStreaming(currentStreamingProjector.takePendingEffects(), currentStreamingProjector)
			) {
				finalizedThinkingRevision += 1;
			}
		});
	});

	let windowedSessionId = $state<SessionId | null>(null);
	let followedRun: RunGroup | null = null;
	let followedRunVersion: number | null = null;
	let settlingSessionId: SessionId | null = null;
	let anchoredSessionId: SessionId | null = null;
	let anchoredFirstSeq: number | null = null;

	$effect.pre(() => {
		const currentSessionId = sessionId;
		const firstSeq = envelopes[0]?.seq ?? null;
		untrack(() => {
			const prepended =
				currentSessionId === anchoredSessionId &&
				anchoredFirstSeq !== null &&
				firstSeq !== null &&
				firstSeq < anchoredFirstSeq;
			anchoredSessionId = currentSessionId;
			anchoredFirstSeq = firstSeq;
			if (!prepended) return;
			transcriptScroll.holdBottomAnchor();
			rebaseRowLayout();
		});
	});

	$effect.pre(() => {
		const currentSessionId = sessionId;
		if (currentSessionId === settlingSessionId) return;
		untrack(() => {
			if (settlingSessionId) {
				rememberHeights(settlingSessionId);
				transcriptScroll.leave();
			}
			settlingSessionId = currentSessionId;
			listRendered = false;
			openingAnchor = rememberedAnchor;
			openingBudgetByRun = null;
			transcriptWindow.open(rememberedHeights);
			settle.resettleTranscript();
		});
	});

	function rememberHeights(heightsSessionId: SessionId): void {
		rememberTranscriptHeightsCommand(heightsSessionId, transcriptWindow.heights());
	}

	$effect(() => {
		const currentSessionId = sessionId;
		untrack(() => {
			if (currentSessionId === windowedSessionId) return;
			windowedSessionId = currentSessionId;
			anchoredPromptToken = latestPromptToken;
			followLatestRun(visibleRuns.at(-1) ?? null);
			transcriptScroll.open(currentSessionId, rememberedAnchor);
			listRendered = true;
		});
	});

	const latestPersistedPromptKey = $derived.by(() => {
		const latestRun = runs.at(-1);
		return latestRun ? firstUserKey(latestRun) : null;
	});
	const latestPromptToken = $derived(pendingPrompt ?? latestPersistedPromptKey);
	let anchoredPromptToken = $state<unknown>(null);

	$effect(() => {
		const token = latestPromptToken;
		untrack(() => {
			if (!token || token === anchoredPromptToken) return;
			const pending = token === pendingPrompt ? pendingPrompt : null;
			if (pending && !pending.runId) return;
			anchoredPromptToken = token;
			transcriptScroll.showNewPrompt(pending?.origin === 'composer');
		});
	});

	$effect(() => {
		const viewport = viewportEl;
		const messageList = messageListEl;
		if (!viewport || !messageList) return;
		return untrack(() => {
			const stopScroll = transcriptScroll.observe(viewport, messageList);
			const stopWindow = transcriptWindow.observe(viewport);
			return () => {
				stopWindow();
				stopScroll();
			};
		});
	});

	$effect(() => {
		const space = spaceBelow;
		const overlay = overlayBelow;
		untrack(() => transcriptScroll.followSpaceBelowChange(space, overlay));
	});

	function followLatestRun(run: RunGroup | null): boolean {
		const version = run ? runProjectionVersion(run) : null;
		const changed = run !== followedRun || version !== followedRunVersion;
		followedRun = run;
		followedRunVersion = version;
		return changed;
	}

	$effect(() => {
		const latest = visibleRuns.at(-1) ?? null;
		untrack(() => {
			if (followLatestRun(latest)) transcriptScroll.followNewContent();
		});
	});

	onMount(() => {
		settle.resettleTranscript();
		const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
		reducedMotion = motionQuery?.matches ?? false;
		const onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
			reducedMotion = event.matches;
			if (reducedMotion) transcriptScroll.cancelGlide();
		};
		motionQuery?.addEventListener('change', onMotionPreferenceChange);
		const releaseMotionHandle = import.meta.env.DEV ? exposeArrivalMotionForTuning(window) : null;
		const onPageHide = (): void => rememberHeights(sessionId);
		window.addEventListener('pagehide', onPageHide);
		return () => {
			window.removeEventListener('pagehide', onPageHide);
			motionQuery?.removeEventListener('change', onMotionPreferenceChange);
			releaseMotionHandle?.();
		};
	});

	$effect(() => {
		contentBelow = !isEmpty && transcriptScroll.contentBelow;
		newContentBelow = transcriptScroll.newContentBelow;
	});

	export function jumpToLatest(): void {
		transcriptScroll.jumpToLatest();
	}

	onDestroy(() => {
		rememberHeights(sessionId);
		transcriptScroll.leave();
		settle.destroy();
		rowArrivals.destroy();
		transcriptScroll.destroy();
	});
</script>

<div
	class="relative min-h-0 min-w-0 flex-1 overflow-hidden"
	style:margin-right="{-splitInset.secondarySize}px"
	data-testid="chat-message-viewport"
	data-session-id={sessionId}
	data-scroll-follow={transcriptScroll.follow}
	onwheel={transcriptScroll.handleWheel}
>
	{#if isEmpty}
		<div
			class="flex h-full min-h-0 flex-col"
			style:padding-right="{splitInset.secondarySize}px"
			data-testid="chat-empty-readiness"
		>
			{@render empty()}
		</div>
	{:else}
		<div
			bind:this={viewportEl}
			class="chat-scroller flex h-full w-full flex-col overflow-x-hidden overflow-y-auto"
			style:padding-right="{splitInset.secondarySize}px"
			aria-label="Agent chat messages"
			data-testid="chat-message-scroller"
			onscroll={(event) => transcriptScroll.handleScroll(event.currentTarget)}
		>
			<div class="chat-stage-inset flex grow flex-col">
				{#if hasSupersededRuns || redoCheckpointTarget}
					<div
						class="flex shrink-0 flex-col items-center gap-1 pb-2"
						data-testid="chat-undone-controls"
					>
						<div class="flex items-center justify-center gap-2">
							{#if hasSupersededRuns}
								<Button
									variant="ghost"
									size="sm"
									ariaPressed={showUndone}
									ariaLabel="Show undone history"
									data-testid="chat-show-undone-toggle"
									onclick={() => (showUndone = !showUndone)}
								>
									Show undone history
								</Button>
							{/if}
							{#if redoCheckpointTarget}
								<Button
									variant="ghost"
									size="sm"
									ariaLabel="Redo undo"
									ariaBusy={redoSubmitting}
									disabled={workstreamRunInFlight || redoSubmitting}
									data-testid="chat-redo-undo"
									onclick={redoCheckpoint}
								>
									Redo undo
								</Button>
							{/if}
							{#if redoForkAtSeq !== null}
								<Button
									variant="ghost"
									size="sm"
									ariaLabel="Fork to new chat"
									data-testid="chat-redo-fork"
									onclick={forkInsteadOfRedo}
								>
									Fork to new chat
								</Button>
							{/if}
						</div>
						{#if redoError}
							<span class="text-2xs text-error-content" role="alert" data-testid="chat-redo-error">
								{redoError}
							</span>
						{/if}
					</div>
				{/if}
				<ol
					bind:this={messageListEl}
					class="chat-column flex flex-col gap-8 px-7 pt-2 select-none"
					style:padding-bottom="calc(1.25rem + {spaceBelow}px + var(--chat-hold-space))"
					data-testid="chat-message-list"
					data-transcript-presentation="windowed-runs"
					data-transcript-total-runs={runs.length}
				>
					{#if branchedFrom}
						<li class="text-2xs text-fg-tertiary text-center" data-testid="chat-branched-from">
							Branched from {branchedFrom}
						</li>
					{/if}
					{#key sessionId}
						<JobRunCards
							chatSessionId={sessionId}
							afterRunId={null}
							knownRunIds={runs.length === 0 ? runIds : null}
						/>
					{/key}
					{#each runs as run, runIndex (run.runId)}
						{@const isLastRun = runIndex === runs.length - 1}
						<TranscriptRun
							{run}
							{isLastRun}
							live={run.runId === openRunId ? liveRun : null}
							copied={copiedResponseRunId === run.runId}
						/>
						<JobRunCards
							chatSessionId={sessionId}
							afterRunId={run.runId}
							knownRunIds={isLastRun ? runIds : null}
						/>
					{/each}
				</ol>
			</div>
		</div>
	{/if}
	{#if gallery}
		<ImageGallery
			{workstreamId}
			images={gallery.images}
			startId={gallery.startId}
			onclose={() => (gallery = null)}
		/>
	{/if}
	<ImageContextMenu {workstreamId} />
	<FileMentionChooser
		open={fileMentionChooserOpen}
		choice={fileMentionChoice}
		onchoose={onChooseFileMention}
		onclose={() => (fileMentionChooserOpen = false)}
	/>
</div>

<style>
	@property --chat-hold-space {
		syntax: '<length>';
		inherits: false;
		initial-value: 0px;
	}
</style>
