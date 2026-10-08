import { randomUUID, type UUID } from 'node:crypto';
import {
	query as sdkQuery,
	type CanUseTool,
	type Options,
	type PermissionMode,
	type PermissionResult,
	type Query,
	type SDKMessage,
	type SDKResultMessage,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunProfile } from '../agent-profile.js';
import type { ProviderApprovalReply, ProviderQuestionReply } from '../interaction-types.js';
import type { ConversationHistoryMessage } from '../protocol.js';
import { ProviderInteractionBroker } from '../provider-interactions.js';
import type { ProviderContext, ProviderEventListener, ProviderHandle } from '../providers/types.js';
import { CLAUDE_LOGIN_COMMAND } from './installation.js';
import { systemPromptAppend } from './instructions.js';
import {
	claudeAnswers,
	claudeQuestions,
	disallowedTools,
	permissionDescriptor,
	permissionModeFor,
	rememberedPermissions,
	sandboxFor,
} from './permissions.js';
import { ClaudeTranscript } from './transcript.js';

const INTERRUPT_GRACE_MS = 3_000;
const PLAN_HANDOFF_MESSAGE =
	'malini now shows this plan to the user, who starts the implementation from there. End your turn without restating the plan.';

export type ClaudeQuery = AsyncIterable<SDKMessage> &
	Pick<
		Query,
		'interrupt' | 'setPermissionMode' | 'mcpServerStatus' | 'initializationResult' | 'close'
	> & {
		getContextUsage(opts: { detail: 'summary' }): Promise<{ readonly rawMaxTokens: number }>;
	};

export type QueryFunction = (params: {
	prompt: AsyncIterable<SDKUserMessage>;
	options: Options;
}) => ClaudeQuery;

export interface ClaudeSessionOptions {
	readonly context: ProviderContext;
	readonly emit: ProviderEventListener;
	readonly executable: string | null;
	readonly query?: QueryFunction;
}

interface ActiveRun {
	readonly runId: string;
	readonly query: ClaudeQuery;
	readonly abort: AbortController;
	readonly finished: Promise<void>;
	readonly transcript: ClaudeTranscript;
	cancelled: boolean;
}

export class ClaudeSession implements ProviderHandle {
	readonly #context: ProviderContext;
	readonly #emit: ProviderEventListener;
	readonly #executable: string | null;
	readonly #query: QueryFunction;
	readonly #interactions: ProviderInteractionBroker;
	#claudeSessionId: string | undefined;
	#seedHistory: readonly ConversationHistoryMessage[] | undefined;
	#active: ActiveRun | null = null;
	#requestedMode: PermissionMode = 'default';
	#initialized = false;

	constructor(options: ClaudeSessionOptions) {
		this.#context = options.context;
		this.#emit = options.emit;
		this.#executable = options.executable;
		this.#query = options.query ?? sdkQuery;
		this.#interactions = new ProviderInteractionBroker({
			sessionId: options.context.sessionId,
			emit: options.emit,
		});
		this.#claudeSessionId = options.context.providerSessionId;
		this.#seedHistory = options.context.providerSessionId
			? undefined
			: options.context.conversationHistory;
	}

	async sendPrompt(
		prompt: string,
		runId: string,
		profile?: AgentRunProfile,
		resumeAt?: string,
		freshConversation?: boolean,
	): Promise<void> {
		if (this.#active) throw new Error(`RUN_ACTIVE: ${this.#active.runId} is still running`);
		this.#emit({ type: 'run.started', runId, sessionId: this.#context.sessionId });
		const executable = this.#executable;
		if (!executable) {
			this.#emit({
				type: 'run.failed',
				runId,
				error: 'Claude Code is not installed. Install it from Settings, then try again.',
			});
			return;
		}
		if (freshConversation) {
			this.#claudeSessionId = undefined;
			this.#seedHistory = undefined;
		}
		const resumed = this.#claudeSessionId !== undefined;
		const outcome = await this.#attempt(executable, prompt, runId, profile, resumeAt, resumed);
		if (outcome === 'transcript-missing') {
			this.#claudeSessionId = undefined;
			this.#seedHistory = this.#context.conversationHistory;
			await this.#attempt(executable, prompt, runId, profile, undefined, false);
		}
	}

	async #attempt(
		executable: string,
		prompt: string,
		runId: string,
		profile: AgentRunProfile | undefined,
		resumeAt: string | undefined,
		resumed: boolean,
	): Promise<'done' | 'transcript-missing'> {
		const transcript = new ClaudeTranscript(runId, this.#emit);
		this.#initialized = false;
		const abort = new AbortController();
		let settle!: () => void;
		const finished = new Promise<void>((resolve) => (settle = resolve));
		const promptId = randomUUID();
		const query = this.#query({
			prompt: openUserTurn(this.#promptWithSeed(prompt), promptId, finished),
			options: this.#options(executable, runId, profile, resumeAt, abort),
		});
		const active: ActiveRun = { runId, query, abort, finished, transcript, cancelled: false };
		this.#active = active;
		try {
			const results = await this.#consume(active, promptId);
			if (resumed && !this.#initialized && !active.cancelled && results[0]?.is_error) {
				return 'transcript-missing';
			}
			this.#seedHistory = undefined;
			this.#finish(runId, active, transcript, results);
		} catch (error) {
			transcript.stopBackgroundAgents();
			this.#emit({
				type: 'run.failed',
				runId,
				error: active.cancelled ? 'cancelled' : describe(error),
				...cursor(transcript),
			});
		} finally {
			this.#interactions.cancelRun(runId);
			query.close();
			this.#active = null;
			settle();
		}
		return 'done';
	}

	async #consume(active: ActiveRun, promptId: string): Promise<SDKResultMessage[]> {
		const results: SDKResultMessage[] = [];
		let reportsSessionState = false;
		for await (const message of active.query) {
			if (message.type === 'system' && message.subtype === 'init') this.#acceptInit(message);
			active.transcript.accept(message);
			if (message.type === 'system' && message.subtype === 'session_state_changed') {
				reportsSessionState = true;
				if (results.length > 0 && message.state === 'idle') return results;
			}
			if (message.type !== 'result') continue;
			if (results.length === 0 && !answersPrompt(message, promptId)) continue;
			results.push(message);
			if (!reportsSessionState || active.cancelled) return results;
		}
		return results;
	}

	#acceptInit(message: Extract<SDKMessage, { type: 'system'; subtype: 'init' }>): void {
		this.#initialized = true;
		this.#claudeSessionId = message.session_id;
		if (this.#requestedMode === 'auto' && message.permissionMode !== 'auto') {
			void this.#active?.query.setPermissionMode('acceptEdits').catch(() => undefined);
		}
		this.#emit({
			type: 'session.state',
			sessionId: this.#context.sessionId,
			status: 'running',
			providerSessionId: message.session_id,
		});
		const active = this.#active;
		if (active) {
			this.#emit({
				type: 'mcp.status',
				runId: active.runId,
				servers: message.mcp_servers.map(({ name, status }) => ({ name, status })),
			});
			void this.#learnContextWindow(active);
		}
	}

	async #learnContextWindow(active: ActiveRun): Promise<void> {
		const usage = await active.query.getContextUsage({ detail: 'summary' }).catch(() => null);
		if (usage) active.transcript.recordContextWindow(usage.rawMaxTokens);
	}

	#finish(
		runId: string,
		active: ActiveRun,
		transcript: ClaudeTranscript,
		results: readonly SDKResultMessage[],
	): void {
		transcript.stopBackgroundAgents();
		const result = results.at(-1);
		if (result) {
			if (!transcript.contextWindowTokens) {
				transcript.recordContextWindow(Object.values(result.modelUsage)[0]?.contextWindow);
			}
			const usages = results.map(({ usage }) => usage);
			this.#emit({
				type: 'usage.updated',
				runId,
				inputTokens: sum(
					usages.map(
						(usage) =>
							usage.input_tokens +
							usage.cache_read_input_tokens +
							usage.cache_creation_input_tokens,
					),
				),
				outputTokens: sum(usages.map((usage) => usage.output_tokens)),
				costUsd: result.total_cost_usd,
				...(transcript.usage ? { contextTokens: transcript.usage.contextTokens } : {}),
				...(transcript.contextWindowTokens
					? { contextWindowTokens: transcript.contextWindowTokens }
					: {}),
				interim: false,
			});
		}
		if (active.cancelled) {
			this.#emit({ type: 'run.failed', runId, error: 'cancelled', ...cursor(transcript) });
			return;
		}
		if (!result) {
			this.#emit({
				type: 'run.failed',
				runId,
				error: 'Claude Code stopped without finishing the turn.',
				...cursor(transcript),
			});
			return;
		}
		if (result.subtype === 'success' && !result.is_error) {
			this.#emit({ type: 'run.completed', runId, summary: result.result, ...cursor(transcript) });
			return;
		}
		this.#emit({ type: 'run.failed', runId, error: resultError(result), ...cursor(transcript) });
	}

	#options(
		executable: string,
		runId: string,
		profile: AgentRunProfile | undefined,
		resumeAt: string | undefined,
		abort: AbortController,
	): Options {
		const permissionMode = permissionModeFor(profile);
		this.#requestedMode = permissionMode;
		const model = this.#context.model;
		return {
			cwd: this.#context.cwd,
			abortController: abort,
			pathToClaudeCodeExecutable: executable,
			env: { ...claudeEnvironment(), CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' },
			settingSources: ['user', 'project', 'local'],
			systemPrompt: {
				type: 'preset',
				preset: 'claude_code',
				append: systemPromptAppend(this.#context.cwd),
			},
			includePartialMessages: true,
			thinking: { type: 'adaptive', display: 'summarized' },
			permissionMode,
			...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
			sandbox: sandboxFor(profile),
			disallowedTools: disallowedTools(),
			canUseTool: this.#canUseTool(runId),
			...(model && model !== 'default' ? { model } : {}),
			...(profile ? { effort: profile.effort } : {}),
			...(this.#claudeSessionId ? { resume: this.#claudeSessionId } : {}),
			...(this.#claudeSessionId && resumeAt ? { resumeSessionAt: resumeAt } : {}),
			stderr: (data) => process.stderr.write(`[claude] ${data}`),
		};
	}

	#canUseTool(runId: string): CanUseTool {
		return async (toolName, input, options): Promise<PermissionResult> => {
			const toolCallId = options.toolUseID;
			if (toolName === 'AskUserQuestion') {
				const questions = claudeQuestions(input);
				const resolution = await this.#interactions.requestQuestion({
					runId,
					questionId: `question-${toolCallId}`,
					questions,
					toolName,
					toolCallId,
					signal: options.signal,
				});
				return resolution.behavior === 'answered'
					? {
							behavior: 'allow',
							updatedInput: {
								...input,
								answers: claudeAnswers(questions, resolution.reply.answers),
							},
						}
					: { behavior: 'deny', message: 'The user dismissed the question.' };
			}
			if (toolName === 'ExitPlanMode') {
				const plan = input['plan'];
				if (typeof plan === 'string' && plan.trim()) {
					this.#emit({ type: 'plan.updated', runId, text: plan });
				}
				return { behavior: 'deny', message: PLAN_HANDOFF_MESSAGE };
			}
			const resolution = await this.#interactions.requestApproval({
				runId,
				approvalId: `approval-${toolCallId}`,
				reason: options.title ?? options.decisionReason ?? `Claude wants to use ${toolName}`,
				toolName,
				input,
				permission: permissionDescriptor(toolName, input, this.#context.cwd, options.blockedPath),
				signal: options.signal,
			});
			if (resolution.decision === 'deny') {
				if (resolution.reason) return { behavior: 'deny', message: resolution.reason };
				const active = this.#active;
				if (active?.runId === runId) {
					active.cancelled = true;
					active.transcript.markStoppedByUser();
				}
				return { behavior: 'deny', message: 'The user denied this action.', interrupt: true };
			}
			const updatedPermissions = rememberedPermissions(options.suggestions, resolution.scope);
			return {
				behavior: 'allow',
				updatedInput: input,
				...(updatedPermissions ? { updatedPermissions } : {}),
			};
		};
	}

	#promptWithSeed(prompt: string): string {
		const history = this.#seedHistory;
		if (!history || history.length === 0) return prompt;
		const transcript = history
			.map((message) => `[${message.role}] ${message.content.trim()}`)
			.join('\n\n');
		return `<previous_conversation>\n${transcript}\n</previous_conversation>\n\n${prompt}`;
	}

	async cancel(runId: string): Promise<void> {
		const active = this.#active;
		if (!active || active.runId !== runId) return;
		active.cancelled = true;
		active.transcript.markStoppedByUser();
		this.#interactions.cancelRun(runId, 'run-cancelled');
		const interrupted = active.query.interrupt().catch(() => undefined);
		const grace = new Promise((resolve) => setTimeout(resolve, INTERRUPT_GRACE_MS).unref());
		await Promise.race([Promise.all([interrupted, active.finished]), grace]);
		active.abort.abort();
		await active.finished;
	}

	async respondToApproval(reply: ProviderApprovalReply): Promise<void> {
		this.#interactions.resolveApproval(reply);
	}

	async respondToQuestion(reply: ProviderQuestionReply): Promise<void> {
		this.#interactions.resolveQuestion(reply);
	}

	async refreshMcpStatus(runId: string): Promise<void> {
		const active = this.#active;
		if (!active || active.runId !== runId) return;
		const servers = await active.query.mcpServerStatus();
		this.#emit({
			type: 'mcp.status',
			runId,
			servers: servers.map((server) => ({
				name: server.name,
				status: server.status,
				...(server.error ? { error: server.error } : {}),
			})),
		});
	}

	async close(): Promise<void> {
		this.#interactions.close();
		const active = this.#active;
		if (active) await this.cancel(active.runId);
	}
}

async function* openUserTurn(
	text: string,
	promptId: UUID,
	finished: Promise<void>,
): AsyncIterable<SDKUserMessage> {
	yield {
		type: 'user',
		uuid: promptId,
		message: { role: 'user', content: text },
		parent_tool_use_id: null,
	};
	await finished;
}

function answersPrompt(result: SDKResultMessage, promptId: string): boolean {
	const answered =
		result.user_message_uuids ?? (result.user_message_uuid ? [result.user_message_uuid] : []);
	if (answered.length > 0) return answered.includes(promptId);
	return result.subtype !== 'success' || result.is_error || result.num_turns > 0;
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function cursor(transcript: ClaudeTranscript): { providerCursor?: string } {
	return transcript.cursor ? { providerCursor: transcript.cursor } : {};
}

function resultError(result: SDKResultMessage): string {
	const text =
		result.subtype === 'success' ? result.result : result.errors.join('\n') || result.subtype;
	if (/not logged in|\/login|authentication|invalid api key|oauth/iu.test(text)) {
		return `Claude Code is not signed in. Run \`${CLAUDE_LOGIN_COMMAND}\` in a terminal, then try again.`;
	}
	return text || 'Claude Code reported an error.';
}

export function claudeEnvironment(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (value === undefined || name === 'ELECTRON_RUN_AS_NODE') continue;
		if (name.startsWith('MALINI_') || name === 'AGENT_BRIDGE_LOG') continue;
		env[name] = value;
	}
	return env;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
