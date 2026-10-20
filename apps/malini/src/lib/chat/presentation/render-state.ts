import { isCancellationError } from '$contract/agent-state-machine';
import type { AgentPermissionDescriptor, AgentQuestion } from '$lib/chat/domain/agent-interaction';
import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import {
	sanitizeAgentElementReferences,
	type AgentElementReference,
} from '$lib/chat/domain/element-reference';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
import {
	undoTargetsByRun,
	type RunUndoTarget,
} from './chat-message-list/destructive-confirm.svelte';
import {
	CONTEXT_HANDOFF_CONTENT_ID_PREFIX,
	isContextHandoffContentId,
} from './session-runtime-metadata';
import { TranscriptFactsProjector, type TranscriptFacts } from './transcript-facts';
import { earlierTurnsByRun, type EarlierTurn } from './turn-result';

export type ToolAggregate = {
	name: string;
	toolCallId?: string;
	startedAt: number | null;
	completedAt: number | null;
	input: unknown;
	output: unknown;
	outputTruncated?: true;
	outputLength?: number;
	status: 'running' | 'completed' | 'failed';
	error?: string;
};

export function stableToolKey(
	runId: string,
	name: string,
	toolCallId: string | undefined,
	seq: number,
): string {
	return toolCallId ? `tool-${runId}-${toolCallId}` : `tool-${runId}-${name}-${seq}`;
}

export function firstPromptKey(runId: string): string {
	return `user-${runId}`;
}

export { CONTEXT_HANDOFF_CONTENT_ID_PREFIX, isContextHandoffContentId };

export function toolDurationMs(
	tool: Pick<ToolAggregate, 'startedAt' | 'completedAt'>,
): number | null {
	if (tool.startedAt === null || tool.completedAt === null) return null;
	return Math.max(0, tool.completedAt - tool.startedAt);
}

export function formatToolDuration(
	durationMs: number | null,
	status: 'running' | 'completed',
): string {
	if (durationMs === null) return status === 'running' ? 'running…' : '—';
	if (durationMs < 1_000) return `${durationMs}ms`;
	const seconds = durationMs / 1_000;
	return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
}

type OpenToolAggregate = ToolAggregate & { ownerRunId: string; startedSeq: number };

export type RenderItem =
	| {
			kind: 'user';
			key: string;
			seq: number;
			text: string;
			checkpointId?: string;
			contextFiles?: string[];
			attachments?: StagedAgentAttachment[];
			transcriptReferences?: AgentTranscriptReference[];
			elementReferences?: AgentElementReference[];
	  }
	| { kind: 'plan'; key: string; seq: number; text: string }
	| { kind: 'assistant'; key: string; seq: number; text: string; contentId?: string }
	| { kind: 'handoff'; key: string; seq: number }
	| { kind: 'tool'; key: string; seq: number; tool: ToolAggregate }
	| { kind: 'file'; key: string; seq: number; path: string }
	| {
			kind: 'command';
			key: string;
			seq: number;
			command: string;
			exitCode: number;
			description?: string;
	  }
	| {
			kind: 'terminal';
			key: string;
			seq: number;
			terminal: 'completed' | 'failed';
			text: string;
	  }
	| {
			kind: 'usage';
			key: string;
			seq: number;
			inputTokens: number | null;
			outputTokens: number | null;
			costUsd: number | null;
	  }
	| {
			kind: 'approval';
			key: string;
			seq: number;
			sessionId: string;
			runId: string;
			approvalId: string;
			reason: string;
			toolName?: string;
			input?: unknown;
			permission?: AgentPermissionDescriptor;
	  }
	| {
			kind: 'question';
			key: string;
			seq: number;
			sessionId: string;
			runId: string;
			questionId: string;
			questions: readonly AgentQuestion[];
			toolName?: string;
			toolCallId?: string;
			answerOutput?: string;
	  }
	| { kind: 'unknown'; key: string; seq: number; raw: unknown };

export type RunGroup = {
	runId: string;
	items: RenderItem[];
	terminal: 'completed' | 'failed' | 'cancelled' | null;
	terminalText: string;
	superseded: boolean;
	obsoleted: boolean;
};

export type RenderState = {
	runs: RunGroup[];
	terminal: 'completed' | 'failed' | null;
	facts: TranscriptFacts;
	undoTargets: ReadonlyMap<string, RunUndoTarget>;
	earlierTurns: ReadonlyMap<string, readonly EarlierTurn[]>;
};

const ERROR_DIAGNOSTICS_SEPARATOR = '\n\nDiagnostics:\n';
const REDACTED_PROVIDER_IDENTIFIER = '[redacted]';

export type RunErrorDisplay = {
	primary: string;
	diagnostics: string | null;
};

export function coalesceAdjacentThoughts<T extends { text: string }>(thoughts: readonly T[]): T[] {
	const result: T[] = [];
	let previousText: string | null = null;

	for (const thought of thoughts) {
		const normalizedText = thought.text.trim().replaceAll('\r\n', '\n');
		if (!normalizedText || normalizedText === previousText) continue;
		result.push(thought);
		previousText = normalizedText;
	}

	return result;
}

export function splitRunErrorText(error: string): RunErrorDisplay {
	const sanitizedError = sanitizeRunErrorText(error);
	const separatorIndex = sanitizedError.indexOf(ERROR_DIAGNOSTICS_SEPARATOR);
	if (separatorIndex < 0) {
		const structuredMessage = structuredRunErrorMessage(sanitizedError);
		if (structuredMessage) {
			return {
				primary: structuredMessage,
				diagnostics: sanitizedError.trim(),
			};
		}
		return { primary: sanitizedError, diagnostics: null };
	}
	const primary = sanitizedError.slice(0, separatorIndex).trim();
	const diagnostics = sanitizedError
		.slice(separatorIndex + ERROR_DIAGNOSTICS_SEPARATOR.length)
		.trim();
	return {
		primary: primary || 'Agent run failed',
		diagnostics: diagnostics || null,
	};
}

export function sanitizeRunErrorText(error: string): string {
	return error
		.replace(
			/(\bauthorization\b["']?\s*[:=]\s*(?:\[\s*)?["']?\s*bearer\s+)[^\s"',}\]]+/giu,
			`$1${REDACTED_PROVIDER_IDENTIFIER}`,
		)
		.replace(/<(?:ak|sk)-[^>\r\n]+>/giu, REDACTED_PROVIDER_IDENTIFIER)
		.replace(/\b(?:ak|sk)-[A-Za-z0-9._~+/=-]+/giu, REDACTED_PROVIDER_IDENTIFIER)
		.replace(/\borg-[A-Za-z0-9._-]+\b/giu, REDACTED_PROVIDER_IDENTIFIER);
}

function structuredRunErrorMessage(error: string): string | null {
	const parsed = parseStructuredValue(error);
	if (parsed === null) return null;
	return findStructuredMessage(parsed, 0);
}

function parseStructuredValue(value: string): unknown | null {
	const trimmed = value.trim();
	if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return parsed;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findStructuredMessage(value: unknown, depth: number): string | null {
	if (depth > 6 || typeof value !== 'object' || value === null) return null;
	if (Array.isArray(value)) {
		for (const item of value) {
			const message = findStructuredMessage(item, depth + 1);
			if (message) return message;
		}
		return null;
	}

	if (!isRecord(value)) return null;
	const record = value;
	for (const key of ['error', 'data', 'cause'] as const) {
		const nested = record[key];
		if (typeof nested === 'string') {
			const embedded = parseStructuredValue(nested);
			if (embedded !== null) {
				const message = findStructuredMessage(embedded, depth + 1);
				if (message) return message;
			} else if (key === 'error' && isUsefulStructuredMessage(nested)) {
				return nested.trim();
			}
		} else {
			const message = findStructuredMessage(nested, depth + 1);
			if (message) return message;
		}
	}

	for (const key of ['message', 'detail', 'description', 'error_description'] as const) {
		const candidate = record[key];
		if (typeof candidate === 'string' && isUsefulStructuredMessage(candidate)) {
			return candidate.trim();
		}
	}

	for (const key of ['response', 'body', 'details'] as const) {
		const message = findStructuredMessage(record[key], depth + 1);
		if (message) return message;
	}

	return null;
}

function isUsefulStructuredMessage(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.length > 0 && !/^[A-Za-z]*Error$/u.test(trimmed);
}

function envelopeKey(env: EventEnvelope): string {
	return `${env.sessionId}-${env.runId}-${env.seq}`;
}

function toolLookupKey(name: string, toolCallId?: string): string {
	return toolCallId ? `id:${toolCallId}` : `name:${name}`;
}

function openToolLookupKey(runId: string, name: string, toolCallId?: string): string {
	return `${runId}:${toolLookupKey(name, toolCallId)}`;
}

function interactionLookupKey(
	kind: 'approval' | 'question',
	sessionId: string,
	runId: string,
	requestId: string,
): string {
	return `${kind}:${sessionId}:${runId}:${requestId}`;
}

export function truncation(
	event: Readonly<{ outputTruncated?: true; outputLength?: number }>,
): Pick<ToolAggregate, 'outputTruncated' | 'outputLength'> {
	return {
		...(event.outputTruncated ? { outputTruncated: true } : {}),
		...(event.outputLength !== undefined ? { outputLength: event.outputLength } : {}),
	};
}

export function answerOutput(output: unknown): string | undefined {
	return typeof output === 'string' ? output : undefined;
}

export function renderInteractionItem(
	envelope: EventEnvelope,
): Extract<RenderItem, { kind: 'approval' | 'question' }> | null {
	const event = envelope.event;
	if (event.type === 'approval.requested') {
		return {
			kind: 'approval',
			key: interactionLookupKey('approval', envelope.sessionId, envelope.runId, event.approvalId),
			seq: envelope.seq,
			sessionId: envelope.sessionId,
			runId: envelope.runId,
			approvalId: event.approvalId,
			reason: event.reason,
			...(event.toolName ? { toolName: event.toolName } : {}),
			...('input' in event ? { input: event.input } : {}),
			...(event.permission
				? {
						permission: {
							capability: event.permission.capability,
							resources: event.permission.resources.map((resource) => ({ ...resource })),
						},
					}
				: {}),
		};
	}
	if (event.type === 'question.requested') {
		return {
			kind: 'question',
			key: interactionLookupKey('question', envelope.sessionId, envelope.runId, event.questionId),
			seq: envelope.seq,
			sessionId: envelope.sessionId,
			runId: envelope.runId,
			questionId: event.questionId,
			questions: event.questions.map((question) => ({
				...question,
				options: question.options.map((option) => ({ ...option })),
			})),
			...(event.toolName ? { toolName: event.toolName } : {}),
			...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
		};
	}
	return null;
}

function runOpensInSupersededRange(
	run: RunGroup,
	ranges: readonly { fromSeq: number; toSeq: number }[],
): boolean {
	const openingSeq = run.items.find((item) => item.kind === 'user')?.seq;
	if (openingSeq === undefined) return false;
	return ranges.some((range) => openingSeq >= range.fromSeq && openingSeq <= range.toSeq);
}

export function foldEnvelopes(envelopes: readonly EventEnvelope[]): RenderState {
	const runs: RunGroup[] = [];
	const runById = new Map<string, RunGroup>();
	const openTools = new Map<string, OpenToolAggregate>();
	const settledTools = new Set<string>();
	const seenInteractions = new Set<string>();
	const questionTools = new Map<string, Extract<RenderItem, { kind: 'question' }>>();
	let terminal: 'completed' | 'failed' | null = null;
	const runsWithPrompt = new Set<string>();

	const supersededRanges: { fromSeq: number; toSeq: number }[] = [];
	const obsoletedRunIds = new Set<string>();
	for (const envelope of envelopes) {
		const event = envelope.event;
		switch (event.type) {
			case 'turn.superseded': {
				supersededRanges.push({ fromSeq: event.fromSeq, toSeq: event.toSeq });
				break;
			}
			case 'turn.restored': {
				const index = supersededRanges.findIndex(
					(range) => range.fromSeq === event.fromSeq && range.toSeq === event.toSeq,
				);
				if (index >= 0) supersededRanges.splice(index, 1);
				break;
			}
			case 'run.obsoleted': {
				obsoletedRunIds.add(event.runId);
				break;
			}
			case 'run.restored': {
				obsoletedRunIds.delete(event.runId);
				break;
			}
			default:
				break;
		}
	}

	function promptKey(runId: string, envelopeKey: string): string {
		if (runsWithPrompt.has(runId)) return envelopeKey;
		runsWithPrompt.add(runId);
		return firstPromptKey(runId);
	}

	function settlesFirst(lookupKey: string, toolCallId: string | undefined): boolean {
		if (settledTools.has(lookupKey)) return false;
		if (toolCallId) settledTools.add(lookupKey);
		return true;
	}

	function stableCommandKey(runId: string, seq: number): string {
		return `command-${runId}-${seq}`;
	}

	function runFor(runId: string): RunGroup {
		let group = runById.get(runId);
		if (!group) {
			group = {
				runId,
				items: [],
				terminal: null,
				terminalText: '',
				superseded: false,
				obsoleted: false,
			};
			runById.set(runId, group);
			runs.push(group);
		}
		return group;
	}

	function push(runId: string, item: RenderItem): void {
		runFor(runId).items.push(item);
	}

	function settleQuestionTool(
		runId: string,
		lookupKey: string,
		output: string | undefined,
	): boolean {
		const question = questionTools.get(lookupKey);
		if (!question) return false;
		questionTools.delete(lookupKey);
		if (output === undefined) return true;
		const items = runFor(runId).items;
		const index = items.indexOf(question);
		if (index >= 0) items[index] = { ...question, answerOutput: output };
		return true;
	}

	function discardOpenToolsForRun(runId: string): void {
		for (const [key, tool] of openTools) {
			if (tool.ownerRunId === runId) {
				openTools.delete(key);
			}
		}
	}

	for (const env of envelopes) {
		const event = env.event;
		const key = envelopeKey(env);
		const runId = env.runId;
		switch (event.type) {
			case 'run.started': {
				runFor(runId);
				break;
			}
			case 'user.message': {
				push(runId, {
					kind: 'user',
					key: promptKey(runId, key),
					seq: env.seq,
					text: event.text,
					...(event.checkpointId ? { checkpointId: event.checkpointId } : {}),
					...(event.contextFiles?.length ? { contextFiles: [...event.contextFiles] } : {}),
					...(event.attachments?.length
						? { attachments: event.attachments.map((attachment) => ({ ...attachment })) }
						: {}),
					...(event.transcriptReferences?.length
						? {
								transcriptReferences: event.transcriptReferences.map(({ sessionId, label }) => ({
									sessionId,
									label,
								})),
							}
						: {}),
					...(event.elementReferences?.length
						? { elementReferences: sanitizeAgentElementReferences(event.elementReferences) }
						: {}),
				});
				break;
			}
			case 'plan.updated': {
				push(runId, { kind: 'plan', key, seq: env.seq, text: event.text });
				break;
			}
			case 'assistant.message': {
				if (isContextHandoffContentId(event.contentId)) {
					push(runId, { kind: 'handoff', key, seq: env.seq });
					break;
				}
				push(runId, {
					kind: 'assistant',
					key,
					seq: env.seq,
					text: event.text,
					...(event.contentId ? { contentId: event.contentId } : {}),
				});
				break;
			}
			case 'tool.started': {
				openTools.set(openToolLookupKey(runId, event.name, event.toolCallId), {
					ownerRunId: runId,
					startedSeq: env.seq,
					name: event.name,
					...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
					startedAt: event.ts ?? null,
					completedAt: null,
					input: event.input,
					output: undefined,
					status: 'running',
				});
				break;
			}
			case 'tool.completed': {
				const lookupKey = openToolLookupKey(runId, event.name, event.toolCallId);
				if (!settlesFirst(lookupKey, event.toolCallId)) break;
				if (settleQuestionTool(runId, lookupKey, answerOutput(event.output))) break;
				const existing = openTools.get(lookupKey);
				if (existing) {
					existing.completedAt = event.ts ?? null;
					existing.output = event.output;
					if (event.outputTruncated) existing.outputTruncated = true;
					if (event.outputLength !== undefined) existing.outputLength = event.outputLength;
					existing.status = 'completed';
					openTools.delete(lookupKey);
					const { ownerRunId: _ownerRunId, startedSeq: _startedSeq, ...tool } = existing;
					push(runId, {
						kind: 'tool',
						key: stableToolKey(runId, event.name, event.toolCallId, existing.startedSeq),
						seq: existing.startedSeq,
						tool,
					});
				} else {
					push(runId, {
						kind: 'tool',
						key: stableToolKey(runId, event.name, event.toolCallId, env.seq),
						seq: env.seq,
						tool: {
							name: event.name,
							...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
							startedAt: null,
							completedAt: event.ts ?? null,
							input: undefined,
							output: event.output,
							...truncation(event),
							status: 'completed',
						},
					});
				}
				break;
			}
			case 'tool.failed': {
				const lookupKey = openToolLookupKey(runId, event.name, event.toolCallId);
				if (!settlesFirst(lookupKey, event.toolCallId)) break;
				if (settleQuestionTool(runId, lookupKey, undefined)) break;
				const existing = openTools.get(lookupKey);
				if (existing) {
					existing.completedAt = event.ts ?? null;
					existing.status = 'failed';
					existing.error = event.error;
					openTools.delete(lookupKey);
					const { ownerRunId: _ownerRunId, startedSeq: _startedSeq, ...tool } = existing;
					push(runId, {
						kind: 'tool',
						key: stableToolKey(runId, event.name, event.toolCallId, existing.startedSeq),
						seq: existing.startedSeq,
						tool,
					});
				} else {
					push(runId, {
						kind: 'tool',
						key: stableToolKey(runId, event.name, event.toolCallId, env.seq),
						seq: env.seq,
						tool: {
							name: event.name,
							...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
							startedAt: null,
							completedAt: event.ts ?? null,
							input: undefined,
							output: undefined,
							status: 'failed',
							error: event.error,
						},
					});
				}
				break;
			}
			case 'thinking.message':
			case 'assistant.delta':
			case 'thinking.delta':
			case 'tool.input.delta': {
				break;
			}
			case 'command.completed': {
				push(runId, {
					kind: 'command',
					key: stableCommandKey(runId, env.seq),
					seq: env.seq,
					command: event.command,
					...(event.description ? { description: event.description } : {}),
					exitCode: event.exitCode,
				});
				break;
			}
			case 'file.changed': {
				push(runId, {
					kind: 'file',
					key: `${key}-${event.path}`,
					seq: env.seq,
					path: event.path,
				});
				break;
			}
			case 'usage.updated': {
				push(runId, {
					kind: 'usage',
					key,
					seq: env.seq,
					inputTokens: event.inputTokens ?? null,
					outputTokens: event.outputTokens ?? null,
					costUsd: event.costUsd ?? null,
				});
				break;
			}
			case 'approval.requested': {
				const item = renderInteractionItem(env);
				if (item && !seenInteractions.has(item.key)) {
					seenInteractions.add(item.key);
					push(runId, item);
				}
				break;
			}
			case 'question.requested': {
				const item = renderInteractionItem(env);
				if (item && !seenInteractions.has(item.key)) {
					seenInteractions.add(item.key);
					push(runId, item);
					if (item.kind === 'question' && item.toolCallId) {
						const lookupKey = openToolLookupKey(runId, '', item.toolCallId);
						openTools.delete(lookupKey);
						questionTools.set(lookupKey, item);
					}
				}
				break;
			}
			case 'run.completed': {
				const group = runFor(runId);
				if (group.terminal !== null) {
					break;
				}
				discardOpenToolsForRun(runId);
				terminal = 'completed';
				group.terminal = 'completed';
				group.terminalText = event.summary;
				push(runId, {
					kind: 'terminal',
					key,
					seq: env.seq,
					terminal: 'completed',
					text: event.summary,
				});
				break;
			}
			case 'run.failed': {
				const group = runFor(runId);
				if (group.terminal !== null) {
					break;
				}
				discardOpenToolsForRun(runId);
				terminal = 'failed';
				const cancelled = isCancellationError(event.error);
				group.terminal = cancelled ? 'cancelled' : 'failed';
				group.terminalText = event.error;
				push(runId, {
					kind: 'terminal',
					key,
					seq: env.seq,
					terminal: 'failed',
					text: event.error,
				});
				break;
			}
			case 'checkpoint.restored':
			case 'turn.superseded':
			case 'turn.restored':
			case 'run.obsoleted':
			case 'run.restored':
			case 'session.branched': {
				break;
			}
			case 'unknown': {
				if (import.meta.env.DEV) {
					const fallbackRun = runs[runs.length - 1]?.runId ?? 'unknown';
					push(fallbackRun, { kind: 'unknown', key, seq: env.seq, raw: event.raw });
				}
				break;
			}
		}
	}

	for (const [, openTool] of openTools) {
		const { ownerRunId, startedSeq, ...tool } = openTool;
		const group = runFor(ownerRunId);
		if (group.terminal !== null) {
			continue;
		}
		push(ownerRunId, {
			kind: 'tool',
			key: stableToolKey(ownerRunId, tool.name, tool.toolCallId, startedSeq),
			seq: startedSeq,
			tool,
		});
	}

	const visibleRuns = runs
		.filter(
			(run, index) => run.items.length > 0 || run.terminal !== null || index === runs.length - 1,
		)
		.map((run) => {
			const superseded = runOpensInSupersededRange(run, supersededRanges);
			const obsoleted = obsoletedRunIds.has(run.runId);
			if (superseded === run.superseded && obsoleted === run.obsoleted) return run;
			return { ...run, superseded, obsoleted };
		});
	return {
		runs: visibleRuns,
		terminal,
		facts: new TranscriptFactsProjector().project(envelopes),
		undoTargets: undoTargetsByRun(visibleRuns),
		earlierTurns: earlierTurnsByRun(visibleRuns),
	};
}
