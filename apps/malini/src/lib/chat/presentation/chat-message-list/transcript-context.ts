import { getContext, setContext, type Snippet } from 'svelte';
import type { AgentModel } from '$shared/providers/providers.api';
import type { AgentRunProfile } from '$shared/providers/providers.api';
import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { BackgroundWork } from '$lib/chat/domain/background-work';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import type { TranscriptAnchor } from '$lib/chat/domain/transcript-anchor';
import type { FileMentionTarget } from '../file-mention-links';
import type { RunGroup, ToolAggregate } from '../render-state';
import type { EarlierTurn, RunPick } from '../turn-result';
import type { CheckpointEditor } from './checkpoint-edit.svelte';
import type { DestructiveConfirm, RunUndoTarget } from './destructive-confirm.svelte';
import type { PromptArrivalAction, RowArrivalAction } from './row-arrival';
import type { TimelineDerivations } from './timeline-derivations.svelte';
import type { TranscriptWindow } from './transcript-window.svelte';

const TRANSCRIPT_CONTEXT = Symbol('chat-transcript');

export type TranscriptComposerControls = {
	readonly model: AgentModel;
	readonly profile: AgentRunProfile;
	readonly envelopes: readonly EventEnvelope[];
	readonly backendSelectionDisabled: boolean;
	onbackendchange(model: AgentModel): void;
	onprofilechange(profile: AgentRunProfile): void;
};

export type TranscriptContext = {
	readonly workstreamId: string;
	readonly sessionId: SessionId;
	readonly workstreamsCard: Snippet<[readonly string[]]>;
	readonly stageEnter: RowArrivalAction;
	transcriptSettled(): boolean;
	readonly promptArrival: PromptArrivalAction;
	timelineKey(run: RunGroup, key: string): string;
	firstUserKey(run: RunGroup): string | null;
	readonly submittedRunId: string | null;
	readonly checkpointEdit: CheckpointEditor;
	readonly composerControls: TranscriptComposerControls | null;
	readonly runUndo: DestructiveConfirm;
	readonly workstreamRunInFlight: boolean;
	readonly chatRunInFlight: boolean;
	readonly waitingForUser: boolean;
	readonly pullRequestShipped: boolean;
	readonly copiedErrorKey: string | null;
	copyErrorText(key: string, error: string): void;
	readonly expandedActivityGroups: Record<string, boolean>;
	readonly implementationModelLabel: string;
	readonly latestImplementablePlanKey: string | null;
	readonly implementingPlanKey: string | null;
	implementPlan(runId: string, itemKey: string, plan: string): void;
	runShellCommand(command: string, language: string | null): void;
	liveInputJsonForRunningTool(runId: string, tool: ToolAggregate): string | null;
	openFileMention(target: FileMentionTarget, mention: HTMLElement): void;
	readonly canOpenFileMention: ((path: string) => boolean) | undefined;
	readonly markdownImageSource: (path: string) => string | null;
	openImageGallery(id: string): void;
	openAttachment(attachment: StagedAgentAttachment): void;
	earlierTurns(runId: string): readonly EarlierTurn[];
	variantPick(runId: string): RunPick | null;
	promptPick(runId: string): RunPick | null;
	sendFollowUp(prompt: string, subject: string): void;
	shipInFork(prompt: string, subject: string, atSeq: number): void;
	readonly saveToScratchpad: ((idea: string) => void) | undefined;
	undoTarget(runId: string): RunUndoTarget | null;
	readonly window: TranscriptWindow;
	readonly timelines: TimelineDerivations;
	readonly openingAnchor: TranscriptAnchor | null;
	openingBudget(runId: string): number;
	listRendered(): boolean;
	readonly backgroundWork: BackgroundWork | null;
	glideRowLayout(container: HTMLElement): () => void;
	rebaseRowLayout(): void;
	showOlderTimeline(runId: string, reference: HTMLElement | null): Promise<void>;
	copyRunResponse(run: RunGroup): void;
};

export function setTranscriptContext(context: TranscriptContext): void {
	setContext(TRANSCRIPT_CONTEXT, context);
}

export function transcriptContext(): TranscriptContext {
	return getContext<TranscriptContext>(TRANSCRIPT_CONTEXT);
}
