import { getContext, setContext } from 'svelte';
import type { AgentModel } from '$shared/providers/providers.api';
import type { ModelPreferences } from '$shared/providers/providers.api';
import type { AgentRunProfile } from '$shared/providers/providers.api';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import type { FileMentionTarget } from '../file-mention-links';
import type { RunGroup, ToolAggregate } from '../render-state';
import type { CheckpointEditor } from './checkpoint-edit.svelte';
import type { DestructiveConfirm } from './destructive-confirm.svelte';
import type { PromptArrivalAction, RowArrivalAction } from './row-arrival';

const TRANSCRIPT_CONTEXT = Symbol('chat-transcript');

export type TranscriptComposerControls = {
	readonly model: AgentModel;
	readonly profile: AgentRunProfile;
	readonly modelDefaults: ModelPreferences;
	readonly rememberedModels: ModelPreferences;
	readonly envelopes: readonly EventEnvelope[];
	readonly isRunning: boolean;
	readonly backendSelectionDisabled: boolean;
	onbackendchange(model: AgentModel): void;
	onprofilechange(profile: AgentRunProfile): void;
	onmodelsettingschange(preferences: ModelPreferences): void;
};

export type TranscriptContext = {
	readonly workstreamId: string;
	readonly sessionId: SessionId;
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
	readonly waitingForUser: boolean;
	readonly copiedErrorKey: string | null;
	copyErrorText(key: string, error: string): void;
	readonly expandedActivityGroups: Record<string, boolean>;
	readonly implementationModelLabel: string;
	readonly latestImplementablePlanKey: string | null;
	readonly implementingPlanKey: string | null;
	implementPlan(runId: string, itemKey: string, plan: string): void;
	liveInputJsonForRunningTool(runId: string, tool: ToolAggregate): string | null;
	openFileMention(target: FileMentionTarget, mention: HTMLElement): void;
	readonly canOpenFileMention: ((path: string) => boolean) | undefined;
};

export function setTranscriptContext(context: TranscriptContext): void {
	setContext(TRANSCRIPT_CONTEXT, context);
}

export function transcriptContext(): TranscriptContext {
	return getContext<TranscriptContext>(TRANSCRIPT_CONTEXT);
}
