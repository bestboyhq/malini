import { BRIDGE_EVENT_TYPES } from './generated/protocol-contract.js';
import type { AgentQuestion, ProviderPermissionDescriptor } from './interaction-types.js';

export type AgentEvent =
	| { type: 'run.started'; runId: string; sessionId: string }
	| { type: 'user.message'; runId: string; text: string }
	| { type: 'assistant.message'; runId: string; text: string; contentId?: string }
	| { type: 'assistant.delta'; runId: string; contentId: string; text: string }
	| { type: 'thinking.delta'; runId: string; contentId: string; text: string }
	| { type: 'thinking.message'; runId: string; contentId: string; text: string }
	| {
			type: 'tool.input.delta';
			runId: string;
			toolCallId: string;
			name: string;
			inputJsonDelta: string;
	  }
	| { type: 'plan.updated'; runId: string; text: string }
	| {
			type: 'tool.started';
			runId: string;
			name: string;
			input?: unknown;
			toolCallId?: string;
			parentToolCallId?: string;
			ts?: number;
	  }
	| {
			type: 'tool.completed';
			runId: string;
			name: string;
			output?: unknown;
			toolCallId?: string;
			parentToolCallId?: string;
			isError?: boolean;
			ts?: number;
	  }
	| {
			type: 'tool.failed';
			runId: string;
			name: string;
			toolCallId?: string;
			parentToolCallId?: string;
			error: string;
			ts?: number;
	  }
	| { type: 'command.started'; runId: string; command: string; description?: string }
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
			sessionId: string;
			runId: string;
			approvalId: string;
			reason: string;
			toolName?: string;
			input?: unknown;
			permission?: ProviderPermissionDescriptor;
	  }
	| {
			type: 'question.requested';
			sessionId: string;
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
			servers: { name: string; status: string; error?: string }[];
	  }
	| { type: 'run.completed'; runId: string; summary: string; providerCursor?: string }
	| { type: 'run.failed'; runId: string; error: string; providerCursor?: string }
	| {
			type: 'session.state';
			sessionId: string;
			status: SessionStatus;
			providerSessionId?: string;
	  };

type MissingGeneratedEvent = Exclude<AgentEvent['type'], (typeof BRIDGE_EVENT_TYPES)[number]>;
type UnknownGeneratedEvent = Exclude<(typeof BRIDGE_EVENT_TYPES)[number], AgentEvent['type']>;
const EVENT_CONTRACT_IS_EXHAUSTIVE: MissingGeneratedEvent extends never ? true : never = true;
const GENERATED_EVENTS_ARE_KNOWN: UnknownGeneratedEvent extends never ? true : never = true;
void EVENT_CONTRACT_IS_EXHAUSTIVE;
void GENERATED_EVENTS_ARE_KNOWN;

export type SessionStatus = 'idle' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';
