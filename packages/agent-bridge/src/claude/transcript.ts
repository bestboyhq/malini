import type {
	SDKBackgroundTasksChangedMessage,
	SDKCompactBoundaryMessage,
	SDKMessage,
	SDKResultMessage,
	SDKStatusMessage,
	SDKTaskNotificationMessage,
	SDKTaskProgressMessage,
	SDKTaskStartedMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, BackgroundTask, BackgroundTaskKind } from '../types.js';
import { isRecord } from '../type-guards.js';
import { AUTO_MODE_UNAVAILABLE, autoModeCategory } from './permissions.js';

export const COMPACTION_TOOL = 'Compact';

const FILE_EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const BACKGROUND_OUTPUT_FILE = /Output is being written to: (\S+\.output)/u;

type StreamBlock = { readonly kind: 'text' | 'thinking' | 'tool'; readonly id: string };
type StreamContentKind = Exclude<StreamBlock['kind'], 'tool'>;

export interface RunUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly contextTokens: number;
}

export class ClaudeTranscript {
	#runId: string;
	readonly #emit: (event: AgentEvent) => void;
	readonly #toolNames = new Map<string, { name: string; input: unknown }>();
	readonly #autoModeBlocks = new Map<string, string>();
	readonly #streamBlocks = new Map<number, StreamBlock>();
	readonly #unsettledBlocks = new Map<string, StreamBlock>();
	readonly #streamedText = new Map<string, string>();
	readonly #settledOnInterrupt = new Set<string>();
	readonly #finalizedByKind = new Map<StreamContentKind, number>();
	readonly #blockCounts = new Map<string, number>();
	readonly #backgroundAgents = new Set<string>();
	readonly #backgroundTasks = new Map<string, BackgroundTask>();
	readonly #taskToolCalls = new Map<string, string>();
	readonly #outputFiles = new Map<string, string>();
	readonly #openTools = new Set<string>();
	readonly #settledTools = new Set<string>();
	readonly #interruptedTools = new Set<string>();
	#idle = false;
	#lastBackground = '';
	#turnSummary: string | undefined;
	#streamMessageId = '';
	#streamStopReasonSeen = false;
	#cursor: string | null = null;
	#usage: RunUsage | null = null;
	#contextWindowTokens: number | undefined;
	#stoppedByUser = false;
	#compaction: string | null = null;

	constructor(runId: string, emit: (event: AgentEvent) => void) {
		this.#runId = runId;
		this.#emit = emit;
	}

	get cursor(): string | null {
		return this.#cursor;
	}

	get usage(): RunUsage | null {
		return this.#usage;
	}

	get contextWindowTokens(): number | undefined {
		return this.#contextWindowTokens;
	}

	get waiting(): boolean {
		return this.#idle && this.#backgroundTasks.size > 0;
	}

	releaseBackgroundWork(): void {
		this.#emit({
			type: 'background.updated',
			runId: this.#runId,
			waiting: false,
			tasks: [],
			handedOff: true,
		});
	}

	handOff(runId: string): void {
		this.#runId = runId;
		this.#idle = false;
		this.#lastBackground = '';
		this.#turnSummary = undefined;
		this.#emitBackground();
	}

	recordTurnResult(result: SDKResultMessage): void {
		this.#turnSummary =
			result.subtype === 'success' && !result.is_error ? result.result : undefined;
	}

	get hasBackgroundTasks(): boolean {
		return this.#backgroundTasks.size > 0;
	}

	get backgroundOutputFiles(): ReadonlyMap<string, string> {
		const files = new Map<string, string>();
		for (const task of this.#backgroundTasks.values()) {
			const file = task.toolCallId ? this.#outputFiles.get(task.toolCallId) : undefined;
			if (file) files.set(task.taskId, file);
		}
		return files;
	}

	markStoppedByUser(): void {
		this.#stoppedByUser = true;
		this.#settleInterruptedStream();
	}

	markUnchecked(toolCallId: string): void {
		this.#autoModeBlocks.set(toolCallId, AUTO_MODE_UNAVAILABLE);
	}

	interruptTurn(): void {
		for (const toolCallId of this.#openTools) this.#interruptedTools.add(toolCallId);
		this.#settleInterruptedStream();
	}

	recordBackgroundOutput(taskId: string, line: string): void {
		const task = this.#backgroundTasks.get(taskId);
		if (!task || !line || task.detail === line) return;
		this.#backgroundTasks.set(taskId, { ...task, detail: line });
		this.#emitBackground(true);
	}

	accept(message: SDKMessage): void {
		switch (message.type) {
			case 'stream_event':
				if (message.parent_tool_use_id === null) this.#acceptStreamEvent(message.event);
				return;
			case 'assistant':
				if (message.parent_tool_use_id === null) this.#cursor = message.uuid;
				this.#acceptAssistant(message.message, message.parent_tool_use_id);
				return;
			case 'user':
				if (message.parent_tool_use_id === null && message.uuid) this.#cursor = message.uuid;
				this.#acceptToolResults(message.message, message.parent_tool_use_id);
				return;
			case 'system':
				if (message.subtype === 'status') this.#acceptStatus(message);
				if (message.subtype === 'compact_boundary') this.#acceptCompactBoundary(message);
				if (message.subtype === 'task_started') this.#acceptTaskStarted(message);
				if (message.subtype === 'task_notification') this.#acceptTaskNotification(message);
				if (message.subtype === 'task_progress') this.#acceptTaskProgress(message);
				if (message.subtype === 'background_tasks_changed') this.#acceptBackgroundTasks(message);
				if (message.subtype === 'api_retry') this.#discardUnsettledStream();
				if (
					message.subtype === 'permission_denied' &&
					message.decision_reason_type === 'classifier'
				) {
					this.#autoModeBlocks.set(message.tool_use_id, autoModeCategory(message.decision_reason));
				}
				if (message.subtype === 'session_state_changed') {
					this.#idle = message.state === 'idle';
					this.#emitBackground();
				}
				return;
			case 'result':
				this.#discardUnsettledStream();
				return;
			default:
				return;
		}
	}

	endBackgroundWork(): void {
		this.#backgroundTasks.clear();
		this.#emitBackground();
		for (const toolCallId of this.#backgroundAgents) {
			this.#settledTools.add(toolCallId);
			this.#emit({
				type: 'tool.failed',
				runId: this.#runId,
				name: this.#toolNames.get(toolCallId)?.name ?? '',
				toolCallId,
				error: 'Background agent stopped when the run ended.',
			});
		}
		this.#backgroundAgents.clear();
	}

	#acceptStatus(message: SDKStatusMessage): void {
		if (message.status === 'compacting' && this.#compaction === null) {
			this.#compaction = `compaction-${message.uuid}`;
			this.#emit({
				type: 'tool.started',
				runId: this.#runId,
				name: COMPACTION_TOOL,
				toolCallId: this.#compaction,
			});
			return;
		}
		if (message.compact_result !== 'failed' || this.#compaction === null) return;
		this.#emit({
			type: 'tool.failed',
			runId: this.#runId,
			name: COMPACTION_TOOL,
			toolCallId: this.#compaction,
			error: message.compact_error || 'Claude Code could not compact the conversation.',
		});
		this.#compaction = null;
	}

	#acceptCompactBoundary(message: SDKCompactBoundaryMessage): void {
		this.#cursor = message.uuid;
		this.#usage = null;
		this.#emit({
			type: 'tool.completed',
			runId: this.#runId,
			name: COMPACTION_TOOL,
			toolCallId: this.#compaction ?? `compaction-${message.uuid}`,
			output: { trigger: message.compact_metadata.trigger },
		});
		this.#compaction = null;
	}

	#acceptBackgroundTasks(message: SDKBackgroundTasksChangedMessage): void {
		const live = message.tasks.filter((task) => !task.ambient);
		const previous = new Map(this.#backgroundTasks);
		this.#backgroundTasks.clear();
		for (const task of live) {
			const known = previous.get(task.task_id);
			const toolCallId = this.#taskToolCalls.get(task.task_id);
			this.#backgroundTasks.set(task.task_id, {
				taskId: task.task_id,
				kind: backgroundTaskKind(task.task_type),
				description: task.description,
				startedAt: known?.startedAt ?? Date.now(),
				...(toolCallId ? { toolCallId } : {}),
				...(known?.detail ? { detail: known.detail } : {}),
			});
		}
		this.#emitBackground();
	}

	#acceptTaskProgress(message: SDKTaskProgressMessage): void {
		this.recordBackgroundOutput(message.task_id, message.summary || message.description);
	}

	#emitBackground(interim = false): void {
		const tasks = [...this.#backgroundTasks.values()];
		const snapshot = tasks.length === 0 ? '' : JSON.stringify({ idle: this.#idle, tasks });
		if (snapshot === this.#lastBackground) return;
		this.#lastBackground = snapshot;
		const waiting = this.#idle && tasks.length > 0;
		const summary = waiting && !interim ? this.#turnSummary : undefined;
		if (summary !== undefined) this.#turnSummary = undefined;
		this.#emit({
			type: 'background.updated',
			runId: this.#runId,
			waiting,
			tasks,
			...(summary === undefined ? {} : { summary }),
			...(summary !== undefined && this.#cursor ? { providerCursor: this.#cursor } : {}),
			...(interim ? { interim } : {}),
		});
	}

	#acceptTaskStarted(message: SDKTaskStartedMessage): void {
		if (message.tool_use_id) {
			this.#taskToolCalls.set(message.task_id, message.tool_use_id);
			const task = this.#backgroundTasks.get(message.task_id);
			if (task && !task.toolCallId) {
				this.#backgroundTasks.set(message.task_id, { ...task, toolCallId: message.tool_use_id });
				this.#emitBackground();
			}
		}
		if (!message.tool_use_id || !message.is_backgrounded || message.task_type !== 'local_agent') {
			return;
		}
		if (message.ambient || message.skip_transcript) return;
		this.#backgroundAgents.add(message.tool_use_id);
	}

	#acceptTaskNotification(message: SDKTaskNotificationMessage): void {
		const toolCallId = message.tool_use_id;
		if (!toolCallId || !this.#backgroundAgents.delete(toolCallId)) return;
		this.#settledTools.add(toolCallId);
		const name = this.#toolNames.get(toolCallId)?.name ?? '';
		if (message.status === 'completed') {
			this.#emit({
				type: 'tool.completed',
				runId: this.#runId,
				name,
				toolCallId,
				output: message.summary,
			});
			return;
		}
		this.#emit({
			type: 'tool.failed',
			runId: this.#runId,
			name,
			toolCallId,
			error: message.summary || `Background agent ${message.status}`,
		});
	}

	#acceptStreamEvent(event: unknown): void {
		if (!isRecord(event)) return;
		switch (event['type']) {
			case 'message_start': {
				this.#discardUnsettledStream();
				const message = event['message'];
				if (isRecord(message) && typeof message['id'] === 'string') {
					this.#streamMessageId = message['id'];
					this.#streamBlocks.clear();
					this.#finalizedByKind.clear();
					this.#streamStopReasonSeen = false;
				}
				return;
			}
			case 'message_delta':
				this.#streamStopReasonSeen = true;
				return;
			case 'message_stop':
				if (!this.#streamStopReasonSeen) this.#discardUnsettledStream();
				return;
			case 'content_block_start': {
				const index = event['index'];
				const block = event['content_block'];
				if (typeof index !== 'number' || !isRecord(block)) return;
				if (block['type'] === 'text' || block['type'] === 'thinking') {
					const id = contentId(this.#streamMessageId, index);
					this.#openStreamBlock(index, { kind: block['type'], id });
					if (block['type'] === 'thinking') {
						this.#emit({ type: 'thinking.delta', runId: this.#runId, contentId: id, text: '' });
					}
				} else if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
					this.#openStreamBlock(index, { kind: 'tool', id: block['id'] });
					this.#toolNames.set(block['id'], { name: String(block['name'] ?? ''), input: {} });
				}
				return;
			}
			case 'content_block_delta': {
				const index = event['index'];
				const delta = event['delta'];
				if (typeof index !== 'number' || !isRecord(delta)) return;
				const block = this.#streamBlocks.get(index);
				if (!block || this.#settledOnInterrupt.has(block.id)) return;
				if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
					this.#recordStreamedText(block.id, delta['text']);
					this.#emit({
						type: 'assistant.delta',
						runId: this.#runId,
						contentId: block.id,
						text: delta['text'],
					});
				} else if (delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
					this.#recordStreamedText(block.id, delta['thinking']);
					this.#emit({
						type: 'thinking.delta',
						runId: this.#runId,
						contentId: block.id,
						text: delta['thinking'],
					});
				} else if (
					delta['type'] === 'input_json_delta' &&
					typeof delta['partial_json'] === 'string' &&
					block.kind === 'tool'
				) {
					this.#emit({
						type: 'tool.input.delta',
						runId: this.#runId,
						toolCallId: block.id,
						name: this.#toolNames.get(block.id)?.name ?? '',
						inputJsonDelta: delta['partial_json'],
					});
				}
				return;
			}
			default:
				return;
		}
	}

	#acceptAssistant(message: unknown, parentToolUseId: string | null): void {
		if (!isRecord(message) || !Array.isArray(message['content'])) return;
		const messageId = typeof message['id'] === 'string' ? message['id'] : '';
		if (parentToolUseId === null) {
			if (messageId !== this.#streamMessageId) this.#discardUnsettledStream();
			this.#recordUsage(message['usage']);
		}
		for (const block of message['content']) {
			if (!isRecord(block)) continue;
			const index = this.#nextBlockIndex(messageId);
			if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
				this.#unsettledBlocks.delete(block['id']);
				const name = String(block['name'] ?? '');
				this.#toolNames.set(block['id'], { name, input: block['input'] });
				this.#openTools.add(block['id']);
				this.#emit({
					type: 'tool.started',
					runId: this.#runId,
					name,
					input: block['input'],
					toolCallId: block['id'],
					...(parentToolUseId ? { parentToolCallId: parentToolUseId } : {}),
				});
				continue;
			}
			if (parentToolUseId !== null) continue;
			if (block['type'] === 'text') {
				const id = this.#finalContentId(messageId, 'text', index);
				if (this.#settledOnInterrupt.has(id)) continue;
				if (typeof block['text'] !== 'string' || !block['text']) continue;
				this.#settleBlock(id);
				this.#emit({
					type: 'assistant.message',
					runId: this.#runId,
					contentId: id,
					text: block['text'],
				});
			} else if (block['type'] === 'thinking') {
				const id = this.#finalContentId(messageId, 'thinking', index);
				if (this.#settledOnInterrupt.has(id)) continue;
				this.#settleBlock(id);
				this.#emit({
					type: 'thinking.message',
					runId: this.#runId,
					contentId: id,
					text: typeof block['thinking'] === 'string' ? block['thinking'] : '',
				});
			}
		}
	}

	#openStreamBlock(index: number, block: StreamBlock): void {
		this.#streamBlocks.set(index, block);
		this.#unsettledBlocks.set(block.id, block);
	}

	#recordStreamedText(id: string, text: string): void {
		this.#streamedText.set(id, (this.#streamedText.get(id) ?? '') + text);
	}

	#settleBlock(id: string): void {
		this.#unsettledBlocks.delete(id);
		this.#streamedText.delete(id);
	}

	#settleInterruptedStream(): void {
		for (const block of this.#unsettledBlocks.values()) {
			if (block.kind === 'tool') continue;
			const text = this.#streamedText.get(block.id) ?? '';
			this.#settleBlock(block.id);
			this.#settledOnInterrupt.add(block.id);
			if (block.kind === 'thinking') {
				this.#emit({ type: 'thinking.message', runId: this.#runId, contentId: block.id, text });
			} else if (text) {
				this.#emit({ type: 'assistant.message', runId: this.#runId, contentId: block.id, text });
			}
		}
	}

	#finalContentId(messageId: string, kind: StreamContentKind, index: number): string {
		if (messageId !== this.#streamMessageId) return contentId(messageId, index);
		const nth = this.#finalizedByKind.get(kind) ?? 0;
		this.#finalizedByKind.set(kind, nth + 1);
		const streamed = [...this.#streamBlocks.values()].filter((block) => block.kind === kind)[nth];
		return streamed?.id ?? contentId(messageId, index);
	}

	#discardUnsettledStream(): void {
		if (this.#unsettledBlocks.size === 0) return;
		const blocks = [...this.#unsettledBlocks.values()];
		this.#unsettledBlocks.clear();
		this.#streamedText.clear();
		this.#emit({
			type: 'stream.discarded',
			runId: this.#runId,
			contentIds: blocks.filter((block) => block.kind !== 'tool').map((block) => block.id),
			toolCallIds: blocks.filter((block) => block.kind === 'tool').map((block) => block.id),
		});
	}

	#nextBlockIndex(messageId: string): number {
		const index = this.#blockCounts.get(messageId) ?? 0;
		this.#blockCounts.set(messageId, index + 1);
		return index;
	}

	#acceptToolResults(message: unknown, parentToolUseId: string | null): void {
		if (!isRecord(message) || !Array.isArray(message['content'])) return;
		for (const block of message['content']) {
			if (!isRecord(block) || block['type'] !== 'tool_result') continue;
			const toolCallId = block['tool_use_id'];
			if (typeof toolCallId !== 'string' || this.#settledTools.has(toolCallId)) continue;
			this.#openTools.delete(toolCallId);
			const interrupted = this.#interruptedTools.delete(toolCallId) || this.#stoppedByUser;
			if (interrupted && block['is_error'] === true) continue;
			if (this.#backgroundAgents.has(toolCallId)) {
				if (block['is_error'] !== true) continue;
				this.#backgroundAgents.delete(toolCallId);
			}
			this.#settledTools.add(toolCallId);
			const tool = this.#toolNames.get(toolCallId);
			const name = tool?.name ?? '';
			const outputFile = BACKGROUND_OUTPUT_FILE.exec(toolResultText(block['content']))?.[1];
			if (outputFile) this.#outputFiles.set(toolCallId, outputFile);
			const handedOffPlan = name === 'ExitPlanMode';
			const output = handedOffPlan ? '' : toolResultText(block['content']);
			const parent = parentToolUseId ? { parentToolCallId: parentToolUseId } : {};
			const autoModeReason = this.#autoModeBlocks.get(toolCallId);
			this.#autoModeBlocks.delete(toolCallId);
			if (block['is_error'] === true && !handedOffPlan) {
				this.#emit({
					type: 'tool.failed',
					runId: this.#runId,
					name,
					toolCallId,
					error: output || `${name} failed`,
					...(autoModeReason ? { autoModeReason } : {}),
					...parent,
				});
			} else {
				this.#emit({
					type: 'tool.completed',
					runId: this.#runId,
					name,
					output,
					toolCallId,
					...parent,
				});
				const path = editedPath(name, tool?.input);
				if (path) this.#emit({ type: 'file.changed', runId: this.#runId, path });
			}
			if (name === 'Bash' && !autoModeReason && isRecord(tool?.input)) {
				const command = tool.input['command'];
				if (typeof command === 'string') {
					this.#emit({
						type: 'command.completed',
						runId: this.#runId,
						command,
						exitCode: block['is_error'] === true ? 1 : 0,
					});
				}
			}
		}
	}

	#recordUsage(usage: unknown): void {
		if (!isRecord(usage)) return;
		const input = numberField(usage, 'input_tokens');
		const cacheRead = numberField(usage, 'cache_read_input_tokens');
		const cacheCreation = numberField(usage, 'cache_creation_input_tokens');
		const output = numberField(usage, 'output_tokens');
		const contextTokens = input + cacheRead + cacheCreation + output;
		if (contextTokens === 0 || contextTokens === this.#usage?.contextTokens) return;
		this.#usage = {
			inputTokens: input + cacheRead + cacheCreation,
			outputTokens: output,
			contextTokens,
		};
		this.#emit({
			type: 'usage.updated',
			runId: this.#runId,
			inputTokens: this.#usage.inputTokens,
			outputTokens: output,
			contextTokens,
			...(this.#contextWindowTokens ? { contextWindowTokens: this.#contextWindowTokens } : {}),
			interim: true,
		});
	}

	recordContextWindow(tokens: number | undefined): void {
		if (tokens && tokens > 0) this.#contextWindowTokens = tokens;
	}
}

function backgroundTaskKind(taskType: string): BackgroundTaskKind {
	if (taskType === 'local_bash') return 'command';
	if (taskType === 'local_agent') return 'agent';
	return 'task';
}

function contentId(messageId: string, index: number): string {
	return `${messageId}:${index}`;
}

function numberField(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function toolResultText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((part) => {
			if (!isRecord(part)) return '';
			if (part['type'] === 'text' && typeof part['text'] === 'string') return part['text'];
			if (part['type'] === 'image') return '[image]';
			return '';
		})
		.filter(Boolean)
		.join('\n');
}

function editedPath(name: string, input: unknown): string | null {
	if (!FILE_EDIT_TOOLS.has(name) || !isRecord(input)) return null;
	const path = input['file_path'] ?? input['notebook_path'];
	return typeof path === 'string' && path ? path : null;
}
