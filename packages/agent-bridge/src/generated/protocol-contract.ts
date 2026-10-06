// Generated from packages/agent-bridge/protocol/bridge-protocol.json. Do not edit.

export const BRIDGE_CONTRACT_NAME = 'malini.agent-bridge' as const;
export const BRIDGE_PROTOCOL_VERSION = 17 as const;
export const BRIDGE_READY_TIMEOUT_MS = 10000 as const;
export const BRIDGE_HEARTBEAT_INTERVAL_MS = 1000 as const;
export const BRIDGE_HEARTBEAT_TIMEOUT_MS = 5000 as const;
export const BRIDGE_COMMAND_ACK_TIMEOUT_MS = 5000 as const;
export const BRIDGE_MAX_FRAME_BYTES = 1048576 as const;
export const BRIDGE_MAX_DIAGNOSTIC_BYTES = 16384 as const;
export const BRIDGE_AGENT_ATTACHMENTS_PATH = '.malini/agent-attachments' as const;
export const BRIDGE_SANDBOX_SCRATCH_PATH = '.malini/sandbox' as const;
export const BRIDGE_MODELS = ['default', 'opus', 'sonnet', 'haiku'] as const;
export const BRIDGE_DEFAULT_MODEL = 'default' as const;
export const BRIDGE_COMMAND_NAMES = [
	'start_session',
	'send_prompt',
	'cancel_run',
	'close_session',
	'approve',
	'answer_question',
	'refresh_capabilities',
	'refresh_mcp_status',
] as const;
export const BRIDGE_EVENT_TYPES = [
	'run.started',
	'user.message',
	'assistant.message',
	'assistant.delta',
	'thinking.message',
	'thinking.delta',
	'plan.updated',
	'tool.started',
	'tool.completed',
	'tool.failed',
	'tool.input.delta',
	'command.started',
	'command.completed',
	'file.changed',
	'approval.requested',
	'question.requested',
	'usage.updated',
	'mcp.status',
	'run.completed',
	'run.failed',
	'session.state',
] as const;
export const BRIDGE_CONTROL_TYPES = [
	'bridge.ready',
	'bridge.capabilities',
	'bridge.heartbeat',
	'bridge.command_ack',
	'bridge.protocol_error',
] as const;
