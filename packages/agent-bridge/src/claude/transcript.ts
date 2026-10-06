import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '../types.js';
import { isRecord } from '../type-guards.js';

const FILE_EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

type StreamBlock = { readonly kind: 'text' | 'thinking' | 'tool'; readonly id: string };

export interface RunUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly contextTokens: number;
}

export class ClaudeTranscript {
	readonly #runId: string;
	readonly #emit: (event: AgentEvent) => void;
	readonly #toolNames = new Map<string, { name: string; input: unknown }>();
	readonly #streamBlocks = new Map<number, StreamBlock>();
	readonly #blockCounts = new Map<string, number>();
	#streamMessageId = '';
	#cursor: string | null = null;
	#usage: RunUsage | null = null;
	#contextWindowTokens: number | undefined;
	#stoppedByUser = false;

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

	markStoppedByUser(): void {
		this.#stoppedByUser = true;
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
				if (message.subtype === 'compact_boundary' && message.uuid) this.#cursor = message.uuid;
				return;
			default:
				return;
		}
	}

	#acceptStreamEvent(event: unknown): void {
		if (!isRecord(event)) return;
		switch (event['type']) {
			case 'message_start': {
				const message = event['message'];
				if (isRecord(message) && typeof message['id'] === 'string') {
					this.#streamMessageId = message['id'];
					this.#streamBlocks.clear();
				}
				return;
			}
			case 'content_block_start': {
				const index = event['index'];
				const block = event['content_block'];
				if (typeof index !== 'number' || !isRecord(block)) return;
				if (block['type'] === 'text' || block['type'] === 'thinking') {
					this.#streamBlocks.set(index, {
						kind: block['type'],
						id: contentId(this.#streamMessageId, index),
					});
				} else if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
					this.#streamBlocks.set(index, { kind: 'tool', id: block['id'] });
					this.#toolNames.set(block['id'], { name: String(block['name'] ?? ''), input: {} });
				}
				return;
			}
			case 'content_block_delta': {
				const index = event['index'];
				const delta = event['delta'];
				if (typeof index !== 'number' || !isRecord(delta)) return;
				const block = this.#streamBlocks.get(index);
				if (!block) return;
				if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
					this.#emit({
						type: 'assistant.delta',
						runId: this.#runId,
						contentId: block.id,
						text: delta['text'],
					});
				} else if (delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
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
		if (parentToolUseId === null) this.#recordUsage(message['usage']);
		for (const block of message['content']) {
			if (!isRecord(block)) continue;
			const index = this.#nextBlockIndex(messageId);
			if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
				const name = String(block['name'] ?? '');
				this.#toolNames.set(block['id'], { name, input: block['input'] });
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
			if (block['type'] === 'text' && typeof block['text'] === 'string' && block['text']) {
				this.#emit({
					type: 'assistant.message',
					runId: this.#runId,
					contentId: contentId(messageId, index),
					text: block['text'],
				});
			} else if (
				block['type'] === 'thinking' &&
				typeof block['thinking'] === 'string' &&
				block['thinking']
			) {
				this.#emit({
					type: 'thinking.message',
					runId: this.#runId,
					contentId: contentId(messageId, index),
					text: block['thinking'],
				});
			}
		}
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
			if (typeof toolCallId !== 'string') continue;
			if (this.#stoppedByUser && block['is_error'] === true) continue;
			const tool = this.#toolNames.get(toolCallId);
			const name = tool?.name ?? '';
			const handedOffPlan = name === 'ExitPlanMode';
			const output = handedOffPlan ? '' : toolResultText(block['content']);
			const parent = parentToolUseId ? { parentToolCallId: parentToolUseId } : {};
			if (block['is_error'] === true && !handedOffPlan) {
				this.#emit({
					type: 'tool.failed',
					runId: this.#runId,
					name,
					toolCallId,
					error: output || `${name} failed`,
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
			if (name === 'Bash' && isRecord(tool?.input)) {
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
