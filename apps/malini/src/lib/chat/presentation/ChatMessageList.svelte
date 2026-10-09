<script lang="ts">
	import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
	import { copyTextCommand } from '$lib/chat/application/commands/copy-text.command';
	import { forkToNewChatCommand } from '$lib/chat/application/commands/fork-to-new-chat.command';
	import { implementPlanCommand } from '$lib/chat/application/commands/implement-plan.command';
	import { redoCheckpointCommand } from '$lib/chat/application/commands/redo-checkpoint.command';
	import { syncInteractionsCommand } from '$lib/chat/application/commands/sync-interactions.command';
	import { keepWorkstreamFilesFreshHook } from '$lib/chat/application/hooks/keep-workstream-files-fresh.hook';
	import { openFileMentionHook } from '$lib/chat/application/hooks/open-file-mention.hook';
	import { previewWorkstreamImageCommand } from '$lib/chat/application/commands/preview-workstream-image.command';
	import { releaseImagePreviewsCommand } from '$lib/chat/application/commands/release-image-previews.command';
	import { imagePreviewQuery } from '$lib/chat/application/queries/image-preview.query.svelte';
	import { fileMentionIndexQuery } from '$lib/chat/application/queries/file-mention-index.query.svelte';
	import { resolveFileMention } from '$lib/chat/domain/file-mention-index';
	import { finalizeStreamingHook } from '$lib/chat/application/hooks/finalize-streaming.hook';
	import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
	import { implementationModelLabelQuery } from '$lib/chat/application/queries/implementation-model-label.query.svelte';
	import { liveToolInputQuery } from '$lib/chat/application/queries/live-tool-input.query.svelte';
	import { liveToolInputsQuery } from '$lib/chat/application/queries/live-tool-inputs.query.svelte';
	import { workstreamChatsQuery } from '$lib/chat/application/queries/workstream-chats.query.svelte';
	import { sessionDisplayNameQuery } from '$lib/chat/application/queries/session-display-name.query.svelte';
	import { sessionWaitingForUserQuery } from '$lib/chat/application/queries/session-waiting-for-user.query.svelte';
	import { streamingBlocksQuery } from '$lib/chat/application/queries/streaming-blocks.query.svelte';
	import { newChatRequestId, type ChatRequestId } from '$lib/chat/domain/chat-request';
	import { redoFailureOffersBranch } from '$lib/chat/domain/checkpoint-requests';
	import type { EventEnvelope } from '$lib/chat/domain/events';
	import type { SessionId } from '$lib/chat/domain/session';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import {
		firstPromptKey,
		stableToolKey,
		type RenderItem,
		type RenderState,
		type RunGroup,
		type ToolAggregate,
	} from './render-state';
	import BufferedStreamingMarkdown from './BufferedStreamingMarkdown.svelte';
	import BufferedStreamingText from './BufferedStreamingText.svelte';
	import RunStatusLine from './RunStatusLine.svelte';
	import ImageGallery from './ImageGallery.svelte';
	import { transcriptGalleryImages, type GalleryImage } from './transcript-gallery';
	import { exposeArrivalMotionForTuning } from './arrival-motion';
	import type { GroupedRunTimelineItem } from './activity-group';
	import type { RunTimelineItem } from './run-timeline';
	import type { FinalizedStreamingThought } from '$lib/chat/domain/streaming-block';
	import { summarizeLiveToolInput } from './tool-display-name';
	import ChatActivityGroup from './chat-message-list/ChatActivityGroup.svelte';
	import ChatTimelineRow from './chat-message-list/ChatTimelineRow.svelte';
	import FileMentionChooser, {
		type FileMentionChoice,
	} from './chat-message-list/FileMentionChooser.svelte';
	import type { FileMentionTarget } from './file-mention-links';
	import RunTerminalBanner from './chat-message-list/RunTerminalBanner.svelte';
	import RunUndoFooter from './chat-message-list/RunUndoFooter.svelte';
	import { createCheckpointEditor } from './chat-message-list/checkpoint-edit.svelte';
	import {
		createDestructiveConfirm,
		runUndoTarget,
	} from './chat-message-list/destructive-confirm.svelte';
	import { createOpenRunGuard } from './chat-message-list/open-run-guard.svelte';
	import { pendingPromptQuery } from '$lib/chat/application/queries/pending-prompt.query.svelte';
	import { createRowArrivals } from './chat-message-list/row-arrival';
	import { sessionProjectorCache } from './chat-message-list/session-projectors';
	import { blockKey, toolInputKey } from './chat-message-list/streaming-finalization';
	import {
		createTimelineDerivations,
		RUN_TIMELINE_REVEAL_INCREMENT,
	} from './chat-message-list/timeline-derivations.svelte';
	import {
		setTranscriptContext,
		type TranscriptComposerControls,
	} from './chat-message-list/transcript-context';
	import { thinkingPreview } from './chat-message-list/transcript-labels';
	import { createTranscriptScroll } from './chat-message-list/transcript-scroll.svelte';
	import { createTranscriptSettleGate } from './chat-message-list/transcript-settle';

	interface Props {
		workstreamId: string;
		sessionId: SessionId;
		envelopes: readonly EventEnvelope[];
		composerControls?: TranscriptComposerControls | null;
		spaceBelow?: number;
		empty: Snippet;
	}

	let {
		workstreamId,
		sessionId,
		envelopes,
		composerControls = null,
		spaceBelow = 0,
		empty,
	}: Props = $props();

	const requestOutcome = $derived(chatRequestQuery.data);
	const implementationModelLabel = $derived(implementationModelLabelQuery.data);

	const sessionProjectors = $derived(sessionProjectorCache.acquire(sessionId));
	const renderState = $derived<RenderState>(sessionProjectors.render.project(envelopes));
	const pendingPrompt = $derived(pendingPromptQuery.data(sessionId));
	const waitingForUser = $derived(sessionWaitingForUserQuery.data(sessionId));

	let showUndone = $state(false);

	const runs = $derived.by(() => {
		const projected = renderState.runs;
		const visible = showUndone ? projected : projected.filter((run) => !run.superseded);
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
			...(pendingPrompt.issueReferences.length
				? {
						issueReferences: pendingPrompt.issueReferences.map((reference) => ({
							...reference,
						})),
					}
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

	const branchedFrom = $derived.by(() => {
		for (const envelope of envelopes) {
			const event = envelope.event;
			if (event.type !== 'session.branched' || event.childSessionId !== sessionId) continue;
			return sessionDisplayNameQuery.data(event.parentSessionId) ?? 'another chat';
		}
		return null;
	});

	const hasTranscriptContent = $derived(
		runs.some((run) => run.items.length > 0 || run.terminal !== null),
	);
	const hasSupersededRuns = $derived(renderState.runs.some((run) => run.superseded));

	const redoCheckpointTarget = $derived.by(() => {
		let liveTalkSeq = 0;
		for (const envelope of envelopes) {
			const type = envelope.event.type;
			if (type !== 'user.message' && type !== 'run.started') continue;
			if (envelope.seq > liveTalkSeq) liveTalkSeq = envelope.seq;
		}
		const redoneSeqs = new Set<number>();
		for (const envelope of envelopes) {
			if (envelope.event.type === 'turn.restored') redoneSeqs.add(envelope.event.restoreSeq);
		}
		let target: { restoreSeq: number; toSeq: number } | null = null;
		for (const envelope of envelopes) {
			const event = envelope.event;
			if (event.type !== 'checkpoint.restored') continue;
			if (envelope.seq < liveTalkSeq) continue;
			if (redoneSeqs.has(envelope.seq)) continue;
			if (!event.salvageCommit) continue;
			target = { restoreSeq: envelope.seq, toSeq: event.toSeq };
		}
		return target;
	});

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

	const markdownImageOwner = newChatRequestId();
	const markdownImageSource = $derived.by(() => {
		const previews = imagePreviewQuery.owned(markdownImageOwner);
		const id = workstreamId;
		return (path: string): string | null => {
			const preview = previews[path];
			if (!preview) {
				previewWorkstreamImageCommand({ owner: markdownImageOwner, workstreamId: id, path });
			}
			return preview?.status === 'ready' ? preview.src : null;
		};
	});

	$effect(() => {
		void workstreamId;
		return () => releaseImagePreviewsCommand(markdownImageOwner);
	});

	let gallery = $state.raw<Readonly<{ images: readonly GalleryImage[]; startId: string }> | null>(
		null,
	);

	function openImageGallery(id: string): void {
		gallery = { images: transcriptGalleryImages(runs), startId: id };
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
	const transcriptScroll = createTranscriptScroll({ prefersReducedMotion: () => reducedMotion });
	const { releaseScrollPin } = transcriptScroll;
	const rowArrivals = createRowArrivals({
		settle,
		prefersReducedMotion: () => reducedMotion,
	});
	const { stageEnter, promptArrival, glideRowLayout, rebaseRowLayout } = rowArrivals;

	let viewportEl: HTMLDivElement | null = $state(null);
	let messageListEl: HTMLOListElement | null = $state(null);

	const timelines = createTimelineDerivations({
		runs: () => runs,
		projectRun: (run) =>
			sessionProjectors.timeline.project(run, finalizedThinkingForRun(run.runId)),
		retainRuns: (runIds) => sessionProjectors.timeline.retainRuns(runIds),
		thoughtsForRun: (runId) => finalizedThinkingForRun(runId),
	});
	const { timelineItems, timelineWindow, groupedTimelineItems } = timelines;

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

	function hasAssistantAnswer(run: RunGroup): boolean {
		return timelineItems(run).some((item) => item.kind === 'assistant');
	}

	function showOlderTimeline(runId: string): Promise<void> {
		return transcriptScroll.revealOlderContent(async () => {
			rebaseRowLayout();
			timelines.revealOlderTimeline(runId);
			await tick();
		});
	}

	const openRunId = $derived(isLatestRunOpen && latestRun ? latestRun.runId : null);

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

	function mergePendingToolRows(
		rows: readonly GroupedRunTimelineItem[],
		pending: readonly RunTimelineItem[],
	): readonly GroupedRunTimelineItem[] {
		const drawn = new Set(rows.map((row) => row.key));
		const fresh = pending.filter((row) => !drawn.has(row.key));
		return fresh.length > 0 ? [...rows, ...fresh] : rows;
	}

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

	const checkpointEdit = createCheckpointEditor({
		outcomeOf: (requestId) => requestOutcome(requestId),
		runs: () => runs,
		blocked: () => workstreamRunInFlight,
		openEditor: (row, mutate) => {
			if (row) return transcriptScroll.holdRowTop(row, mutate);
			releaseScrollPin();
			return Promise.resolve(mutate());
		},
		resizeEditor: (row, mutate) => {
			if (row) void transcriptScroll.holdRowTop(row, mutate);
			else mutate();
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
		revalidateOn: () => locallyVisibleRunInFlight,
	});

	const workstreamRunInFlight = $derived(locallyVisibleRunInFlight || nativeOpenRun.inFlight);

	function forkAtSeq(run: RunGroup): number | null {
		let max: number | null = null;
		for (const item of run.items) {
			if (max === null || item.seq > max) max = item.seq;
		}
		return max;
	}

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
		get waitingForUser() {
			return waitingForUser;
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
		liveInputJsonForRunningTool,
		openFileMention,
		get canOpenFileMention() {
			return canOpenFileMention;
		},
		get markdownImageSource() {
			return markdownImageSource;
		},
		openImageGallery,
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
	let followedSeq = 0;
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
		settlingSessionId = currentSessionId;
		settle.resettleTranscript();
	});

	$effect(() => {
		const currentSessionId = sessionId;
		untrack(() => {
			if (currentSessionId === windowedSessionId) return;
			if (windowedSessionId) transcriptScroll.leave(windowedSessionId);
			windowedSessionId = currentSessionId;
			anchoredPromptToken = latestPromptToken;
			followedSeq = envelopes.at(-1)?.seq ?? 0;
			transcriptScroll.open(currentSessionId);
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
		return untrack(() => transcriptScroll.observe(viewport, messageList));
	});

	$effect(() => {
		void spaceBelow;
		untrack(() => transcriptScroll.followSpaceBelowChange());
	});

	$effect(() => {
		const lastSeq = envelopes.at(-1)?.seq ?? 0;
		untrack(() => {
			const arrived = lastSeq > followedSeq;
			followedSeq = lastSeq;
			if (arrived) transcriptScroll.followNewContent();
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
		return () => {
			motionQuery?.removeEventListener('change', onMotionPreferenceChange);
			releaseMotionHandle?.();
		};
	});

	onDestroy(() => {
		if (windowedSessionId) transcriptScroll.leave(windowedSessionId);
		settle.destroy();
		rowArrivals.destroy();
		transcriptScroll.destroy();
	});
</script>

<div
	class="relative min-h-0 min-w-0 flex-1 overflow-hidden"
	data-testid="chat-message-viewport"
	data-session-id={sessionId}
	data-scroll-follow={transcriptScroll.follow}
	onwheel={transcriptScroll.handleWheel}
>
	{#if isEmpty}
		<div class="flex h-full min-h-0 flex-col" data-testid="chat-empty-readiness">
			{@render empty()}
		</div>
	{:else}
		<div
			bind:this={viewportEl}
			class="chat-scroller flex h-full w-full flex-col overflow-x-hidden overflow-y-auto"
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
					style="padding-bottom: calc(1.25rem + var(--chat-footer-inset, 0px) + var(--chat-hold-space, 0px));"
					data-testid="chat-message-list"
					data-transcript-presentation="all-runs-timeline-window"
					data-transcript-total-runs={runs.length}
					data-transcript-mounted-runs={runs.length}
				>
					{#if branchedFrom}
						<li class="text-2xs text-fg-tertiary text-center" data-testid="chat-branched-from">
							Branched from {branchedFrom}
						</li>
					{/if}
					{#each runs as run, runIndex (run.runId)}
						{@const isLastRun = runIndex === runs.length - 1}
						{@const runTimelineWindow = timelineWindow(run)}
						{@const runRows = groupedTimelineItems(run, runTimelineWindow, isLastRun)}
						{@const runTimelineItems =
							run.runId === openRunId && livePendingToolItems.length > 0
								? mergePendingToolRows(runRows, livePendingToolItems)
								: runRows}
						{@const undoTarget =
							!run.superseded && !run.obsoleted ? runUndoTarget(run, runs) : null}
						{@const forkSeq = forkAtSeq(run)}
						{@const forkAvailable =
							run.terminal !== null && !run.superseded && !run.obsoleted && forkSeq !== null}
						<li
							class={[
								'group/run relative flex flex-col gap-2 transition-opacity',
								isLastRun &&
									'min-h-[calc(var(--chat-viewport-height,0px)-1.75rem-var(--chat-footer-inset,0px))]',
								!isLastRun && run.terminal !== null && 'opacity-90',
								run.superseded && 'pointer-events-none opacity-50 select-none',
							]}
							data-run-id={run.runId}
							data-run-terminal={run.terminal ?? 'open'}
							data-transcript-total-items={timelineItems(run).length}
							data-transcript-mounted-items={runTimelineWindow.items.length}
							{@attach isLastRun ? glideRowLayout : undefined}
						>
							{#if runTimelineWindow.hiddenCount > 0}
								<div class="flex justify-center pb-1">
									<Button
										variant="secondary"
										size="sm"
										bordered
										class="border-chip-border bg-chip hover:bg-chip-hover h-8 px-3"
										data-testid="chat-show-older-activity"
										data-run-id={run.runId}
										onclick={() => void showOlderTimeline(run.runId)}
									>
										Show {Math.min(RUN_TIMELINE_REVEAL_INCREMENT, runTimelineWindow.hiddenCount)} older
										events
									</Button>
								</div>
							{/if}

							{#each runTimelineItems as item (item.key)}
								{#if item.kind === 'activity-group'}
									<ChatActivityGroup group={item} {run} {isLastRun} />
								{:else}
									<ChatTimelineRow {item} {run} {isLastRun} />
								{/if}
							{/each}

							{#if isLastRun && run.terminal === null}
								{#each liveThinkingBlocks as block (block.contentId)}
									<details
										class="group/live-thought text-fg-tertiary w-full"
										use:stageEnter={blockKey(sessionId, block.runId, block.contentId)}
										data-message-kind="thinking-live"
										data-testid="thinking-live"
									>
										<summary
											class="text-fg-tertiary hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-1.5 text-xs transition-[color,border-color]"
										>
											<Icon
												name="chevron-right"
												size={12}
												class="shrink-0 transition-transform group-open/live-thought:rotate-90"
											/>
											<span class="shrink-0 font-medium">Thinking…</span>
											<span
												class="text-fg-tertiary/75 min-w-0 truncate"
												data-testid="thinking-live-preview"
											>
												{thinkingPreview(block.text)}
											</span>
										</summary>
										<div
											class="text-fg-secondary pt-0.5 pb-1 pl-[1.125rem] text-xs leading-relaxed whitespace-pre-wrap select-text"
										>
											<BufferedStreamingText text={block.text} />
										</div>
									</details>
								{/each}

								{#each liveAssistantBlocks as block (block.contentId)}
									<div
										class="text-fg-agent-message w-full text-sm leading-relaxed"
										use:stageEnter={blockKey(sessionId, block.runId, block.contentId)}
										data-message-kind="assistant-live"
										data-testid="chat-message-bubble-live"
									>
										<BufferedStreamingMarkdown
											text={block.text}
											class="select-text"
											playbackKey={blockKey(sessionId, block.runId, block.contentId)}
											revealOnMount={!settle.isSettled()}
											onopenfile={openFileMention}
											canopenfile={canOpenFileMention}
											imagesrc={markdownImageSource}
										/>
									</div>
								{/each}
							{/if}

							{#if isLastRun}
								<RunStatusLine {renderState} {waitingForUser} />
							{/if}

							{#if run.terminal !== null && run.terminal !== 'completed'}
								<RunTerminalBanner {run} />
							{/if}

							{#if run.obsoleted}
								<p class="text-2xs text-fg-tertiary" data-testid="chat-run-obsoleted-note">
									Files from this run were reverted by an undo in another chat
								</p>
							{/if}

							{#if hasAssistantAnswer(run) || undoTarget || forkAvailable}
								<div
									class="flex h-5 items-center justify-end gap-1.5"
									data-testid="chat-run-actions"
								>
									<RunUndoFooter
										{run}
										target={undoTarget}
										forkAtSeq={forkAvailable ? forkSeq : null}
									/>
									<Tooltip
										content={copiedResponseRunId === run.runId ? 'Copied' : 'Copy response'}
										placement="top"
									>
										<IconButton
											bare
											class="text-fg-tertiary hover:text-fg-secondary focus-visible:ring-border-default/50 grid h-5 w-5 cursor-pointer place-items-center rounded opacity-0 transition-opacity group-hover/run:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
											ariaLabel="Copy response"
											data-testid="chat-copy-response"
											data-copy-run-id={run.runId}
											onclick={() => copyRunResponse(run)}
										>
											<Icon name="copy" size={14} />
										</IconButton>
									</Tooltip>
								</div>
							{/if}
						</li>
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
	<FileMentionChooser
		open={fileMentionChooserOpen}
		choice={fileMentionChoice}
		onchoose={onChooseFileMention}
		onclose={() => (fileMentionChooserOpen = false)}
	/>
</div>
