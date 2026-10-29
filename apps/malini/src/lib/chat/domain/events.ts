import type { AgentBackgroundTask, RunFailure } from '$contract/agent';
import type { WorkstreamReport } from '$contract/deliveries';
import type { MaliniEditReview } from '$contract/approvals';
import type { McpServerReport } from '$contract/mcp-servers';
import type { StagedAgentAttachment } from './composer-actions';
import type { AgentElementReference } from './element-reference';
import type { AgentTranscriptReference } from './transcript-reference';
import type {
	AgentApprovalDecision,
	AgentApprovalScope,
	AgentPermissionDescriptor,
	AgentQuestion,
} from './agent-interaction';

export type SessionStatus = 'idle' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';

export type AgentEvent =
	| { type: 'run.started'; runId: string; sessionId: string }
	| {
			type: 'user.message';
			runId: string;
			text: string;
			clientRequestId?: string;
			checkpointId?: string;
			contextFiles?: string[];
			attachments?: StagedAgentAttachment[];
			transcriptReferences?: (AgentTranscriptReference & {
				maxSeq: number;
				truncated?: boolean;
			})[];
			elementReferences?: AgentElementReference[];
			from?: string;
			reports?: WorkstreamReport[];
			decisions?: string[];
	  }
	| { type: 'assistant.message'; runId: string; text: string; contentId?: string }
	| { type: 'thinking.message'; runId: string; contentId: string; text: string }
	| { type: 'plan.updated'; runId: string; text: string }
	| {
			type: 'tool.started';
			runId: string;
			name: string;
			input?: unknown;
			toolCallId?: string;
			ts?: number;
	  }
	| {
			type: 'tool.completed';
			runId: string;
			name: string;
			output?: unknown;
			outputTruncated?: true;
			outputLength?: number;
			toolCallId?: string;
			ts?: number;
	  }
	| {
			type: 'tool.failed';
			runId: string;
			name: string;
			toolCallId?: string;
			error: string;
			autoModeReason?: string;
			ts?: number;
	  }
	| {
			type: 'command.completed';
			runId: string;
			command: string;
			description?: string;
			exitCode: number;
	  }
	| { type: 'file.changed'; runId: string; path: string }
	| {
			type: 'approval.requested';
			sessionId?: string;
			runId: string;
			approvalId: string;
			reason: string;
			toolName?: string;
			input?: unknown;
			permission?: AgentPermissionDescriptor;
			autoModeRule?: string;
			autoModeUnavailable?: boolean;
			review?: MaliniEditReview;
	  }
	| {
			type: 'approval.decided';
			runId: string;
			approvalId: string;
			decision: AgentApprovalDecision;
			scope: AgentApprovalScope;
			remembered: boolean;
			alwaysAllow?: boolean;
			reviewed?: boolean;
	  }
	| {
			type: 'question.requested';
			sessionId?: string;
			runId: string;
			questionId: string;
			questions: readonly AgentQuestion[];
			toolName?: string;
			toolCallId?: string;
	  }
	| {
			type: 'usage.updated';
			runId: string;
			inputTokens?: number;
			outputTokens?: number;
			costUsd?: number;
			contextTokens?: number;
			contextWindowTokens?: number;
			providerMetrics?: Record<string, unknown>;
			interim?: boolean;
	  }
	| {
			type: 'mcp.status';
			runId: string;
			servers: McpServerReport[];
	  }
	| {
			type: 'background.updated';
			runId: string;
			waiting: boolean;
			tasks: AgentBackgroundTask[];
			summary?: string;
			interim?: boolean;
			handedOff?: boolean;
	  }
	| { type: 'run.completed'; runId: string; summary: string; handedOff?: boolean }
	| {
			type: 'run.failed';
			runId: string;
			error: string;
			failure?: RunFailure;
			resumeAt?: string;
			handedOff?: boolean;
	  }
	| { type: 'assistant.delta'; runId: string; contentId: string; text: string }
	| { type: 'thinking.delta'; runId: string; contentId: string; text: string }
	| {
			type: 'tool.input.delta';
			runId: string;
			toolCallId: string;
			name: string;
			inputJsonDelta: string;
	  }
	| {
			type: 'stream.discarded';
			runId: string;
			contentIds: readonly string[];
			toolCallIds: readonly string[];
	  }
	| {
			type: 'checkpoint.restored';
			runId: string;
			workstreamId: string;
			checkpointId: string;
			salvageRef: string | null;
			salvageCommit: string | null;
			fromSeq: number;
			toSeq: number;
			obsoletedRunIds: readonly string[];
			at: string;
	  }
	| {
			type: 'turn.superseded';
			runId: string;
			fromSeq: number;
			toSeq: number;
			restoreSeq: number;
			at: string;
	  }
	| {
			type: 'turn.restored';
			runId: string;
			fromSeq: number;
			toSeq: number;
			restoreSeq: number;
			at: string;
	  }
	| { type: 'run.obsoleted'; runId: string; restoreSeq: number; at: string }
	| { type: 'run.restored'; runId: string; restoreSeq: number; at: string }
	| {
			type: 'session.branched';
			runId: string;
			parentSessionId: string;
			childSessionId: string;
			forkSeq: number;
			at: string;
	  }
	| { type: 'unknown'; raw: unknown };

export type AgentEventType = AgentEvent['type'];

export type EventEnvelope = {
	sessionId: string;
	runId: string;
	seq: number;
	event: AgentEvent;
	at?: number;
};
