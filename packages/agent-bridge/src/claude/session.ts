import { randomUUID, type UUID } from 'node:crypto';
import {
	query as sdkQuery,
	type CanUseTool,
	type Options,
	type PermissionMode,
	type PermissionResult,
	type Query,
	type SDKControlGetContextUsageResponse,
	type SDKMessage,
	type SDKResultMessage,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunProfile } from '../agent-profile.js';
import type { ProviderApprovalReply, ProviderQuestionReply } from '../interaction-types.js';
import type { ConversationHistoryMessage, PlatformResult, PlatformToolCall } from '../protocol.js';
import { ProviderInteractionBroker } from '../provider-interactions.js';
import type { ProviderContext, ProviderEventListener, ProviderHandle } from '../providers/types.js';
import { MALINI_MCP_SERVER, maliniTools } from './browser-tools.js';
import { CLAUDE_LOGIN_COMMAND } from './installation.js';
import { systemPromptAppend } from './instructions.js';
import {
	claudeAnswers,
	claudeQuestions,
	disallowedTools,
	refuseMaliniOwnedCommands,
	permissionDescriptor,
	permissionModeFor,
	rememberedPermissions,
	sandboxFor,
} from './permissions.js';
import { lastOutputLine } from './task-output.js';
import { ClaudeTranscript } from './transcript.js';
import { anthropicMetrics } from './usage.js';

const INTERRUPT_GRACE_MS = 3_000;
const BACKGROUND_OUTPUT_POLL_MS = 2_000;
const PLAN_HANDOFF_MESSAGE =
	'Malini now shows this plan to the user, who starts the implementation from there. End your turn without restating the plan.';

export type ClaudeContextUsage = Pick<
	SDKControlGetContextUsageResponse,
	'categories' | 'skills'
> & {
	readonly rawMaxTokens: number;
};

export type ClaudeQuery = AsyncIterable<SDKMessage> &
	Pick<
		Query,
		| 'interrupt'
		| 'setPermissionMode'
		| 'setMcpPermissionModeOverride'
		| 'mcpServerStatus'
		| 'initializationResult'
		| 'close'
		| 'stopTask'
		| 'applyFlagSettings'
		| 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'
	> & {
		getContextUsage(opts: { detail: 'summary' }): Promise<ClaudeContextUsage>;
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

interface RunSettings {
	readonly profile: AgentRunProfile | undefined;
	readonly skills: readonly string[] | undefined;
}

interface ActiveRun {
	runId: string;
	promptId: UUID;
	profile: AgentRunProfile | undefined;
	readonly skills: readonly string[] | undefined;
	results: SDKResultMessage[];
	costBefore: number;
	readonly query: ClaudeQuery;
	readonly turns: UserTurns;
	readonly abort: AbortController;
	readonly finished: Promise<void>;
	readonly transcript: ClaudeTranscript;
	cancelled: boolean;
	metrics: Record<string, unknown> | null;
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
		skills?: readonly string[],
		steer?: boolean,
	): Promise<void> {
		const active = this.#active;
		if (active) {
			const continues = canContinue(active, { profile, skills }, resumeAt, freshConversation);
			const answered = active.transcript.waiting || active.results.length > 0;
			if (continues && (steer || active.transcript.waiting)) {
				await this.#handOff(active, prompt, runId, profile, !answered);
				return;
			}
			if (!steer) throw new Error(`RUN_ACTIVE: ${active.runId} is still running`);
			await this.cancel(active.runId);
		}
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
		const run: RunSettings = { profile, skills };
		const outcome = await this.#attempt(executable, prompt, runId, run, resumeAt, resumed);
		if (outcome === 'transcript-missing') {
			this.#claudeSessionId = undefined;
			this.#seedHistory = this.#context.conversationHistory;
			await this.#attempt(executable, prompt, runId, run, undefined, false);
		}
	}

	async #attempt(
		executable: string,
		prompt: string,
		runId: string,
		run: RunSettings,
		resumeAt: string | undefined,
		resumed: boolean,
	): Promise<'done' | 'transcript-missing'> {
		const transcript = new ClaudeTranscript(runId, this.#emit);
		this.#initialized = false;
		const abort = new AbortController();
		let settle!: () => void;
		const finished = new Promise<void>((resolve) => (settle = resolve));
		const promptId = randomUUID();
		const turns = userTurns(finished);
		turns.push(userTurn(this.#promptWithSeed(prompt), promptId));
		const query = this.#query({
			prompt: turns.messages,
			options: this.#options(executable, run, resumeAt, abort),
		});
		void query
			.setMcpPermissionModeOverride(MALINI_MCP_SERVER, 'default')
			.catch((error: unknown) =>
				process.stderr.write(`[claude] could not make Malini's tools ask: ${describe(error)}\n`),
			);
		const active: ActiveRun = {
			runId,
			promptId,
			profile: run.profile,
			skills: run.skills,
			results: [],
			costBefore: 0,
			query,
			turns,
			abort,
			finished,
			transcript,
			cancelled: false,
			metrics: null,
		};
		this.#active = active;
		const outputPoll = setInterval(
			() => void this.#readBackgroundOutput(transcript),
			BACKGROUND_OUTPUT_POLL_MS,
		).unref();
		try {
			await this.#consume(active);
			if (resumed && !this.#initialized && !active.cancelled && active.results[0]?.is_error) {
				return 'transcript-missing';
			}
			this.#seedHistory = undefined;
			transcript.endBackgroundWork();
			this.#finish(active);
		} catch (error) {
			transcript.endBackgroundWork();
			this.#emit({
				type: 'run.failed',
				runId: active.runId,
				error: active.cancelled ? 'cancelled' : describe(error),
				...cursor(transcript),
			});
		} finally {
			clearInterval(outputPoll);
			this.#interactions.cancelRun(active.runId);
			query.close();
			this.#active = null;
			settle();
		}
		return 'done';
	}

	async #consume(active: ActiveRun): Promise<void> {
		let reportsSessionState = false;
		for await (const message of active.query) {
			if (message.type === 'system' && message.subtype === 'init') this.#acceptInit(message);
			active.transcript.accept(message);
			if (message.type === 'system' && message.subtype === 'session_state_changed') {
				reportsSessionState = true;
				const settled = message.state === 'idle' && !active.transcript.hasBackgroundTasks;
				if (active.results.length > 0 && settled) return;
			}
			if (message.type !== 'result') continue;
			if (active.results.length === 0 && !answersPrompt(message, active.promptId)) continue;
			active.results.push(message);
			active.transcript.recordTurnResult(message);
			if (!active.cancelled) active.metrics = await anthropicMetrics(active.query, new Date());
			if (!reportsSessionState || active.cancelled) return;
		}
	}

	async #handOff(
		active: ActiveRun,
		prompt: string,
		runId: string,
		profile: AgentRunProfile | undefined,
		interrupt: boolean,
	): Promise<void> {
		active.transcript.releaseBackgroundWork();
		if (interrupt) {
			active.transcript.interruptTurn();
			this.#emit({
				type: 'run.failed',
				runId: active.runId,
				error: 'cancelled',
				...cursor(active.transcript),
				handedOff: true,
			});
		} else {
			this.#finish(active, true);
		}
		this.#interactions.cancelRun(active.runId);
		this.#emit({ type: 'run.started', runId, sessionId: this.#context.sessionId });
		active.costBefore = active.results.at(-1)?.total_cost_usd ?? active.costBefore;
		active.runId = runId;
		active.promptId = randomUUID();
		active.results = [];
		active.metrics = null;
		active.transcript.handOff(runId);
		await this.#applyEffort(active, profile);
		if (interrupt) await active.query.interrupt().catch(() => undefined);
		active.turns.push(userTurn(prompt, active.promptId));
		await active.finished;
	}

	async #applyEffort(active: ActiveRun, profile: AgentRunProfile | undefined): Promise<void> {
		if (profile && profile.effort !== active.profile?.effort) {
			await active.query.applyFlagSettings({ effortLevel: profile.effort });
		}
		active.profile = profile;
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

	#finish(active: ActiveRun, handedOff = false): void {
		const { runId, transcript, results } = active;
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
				costUsd: result.total_cost_usd - active.costBefore,
				...(transcript.usage ? { contextTokens: transcript.usage.contextTokens } : {}),
				...(transcript.contextWindowTokens
					? { contextWindowTokens: transcript.contextWindowTokens }
					: {}),
				...(active.metrics ? { providerMetrics: active.metrics } : {}),
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
			this.#emit({
				type: 'run.completed',
				runId,
				summary: result.result,
				...cursor(transcript),
				...(handedOff ? { handedOff } : {}),
			});
			return;
		}
		this.#emit({ type: 'run.failed', runId, error: resultError(result), ...cursor(transcript) });
	}

	#options(
		executable: string,
		{ profile, skills }: RunSettings,
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
				append: systemPromptAppend(this.#context.cwd, profile?.report ?? 'medium'),
			},
			includePartialMessages: true,
			thinking: { type: 'adaptive', display: 'summarized' },
			permissionMode,
			...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
			sandbox: sandboxFor(profile),
			disallowedTools: disallowedTools(),
			hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [refuseMaliniOwnedCommands] }] },
			...maliniTools(this.#context.requestBrowser, (call) => this.#requestPlatform(call)),
			canUseTool: this.#canUseTool(),
			...(model ? { model } : {}),
			...(profile ? { effort: profile.effort } : {}),
			...(skills ? { skills: [...skills] } : {}),
			...(this.#claudeSessionId ? { resume: this.#claudeSessionId } : {}),
			...(this.#claudeSessionId && resumeAt ? { resumeSessionAt: resumeAt } : {}),
			stderr: (data) => process.stderr.write(`[claude] ${data}`),
		};
	}

	#canUseTool(): CanUseTool {
		return async (toolName, input, options): Promise<PermissionResult> => {
			const runId = this.#active?.runId ?? '';
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

	#requestPlatform(call: PlatformToolCall): Promise<PlatformResult> {
		const runId = this.#active?.runId;
		if (!runId) return Promise.resolve({ ok: false, error: 'No Malini run is active.' });
		return this.#context.requestPlatform({ ...call, runId });
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

	async stopTask(runId: string, taskId: string): Promise<void> {
		const active = this.#active;
		if (!active || active.runId !== runId) return;
		await active.query.stopTask(taskId);
	}

	async #readBackgroundOutput(transcript: ClaudeTranscript): Promise<void> {
		for (const [taskId, file] of transcript.backgroundOutputFiles) {
			const line = await lastOutputLine(file).catch(() => '');
			transcript.recordBackgroundOutput(taskId, line);
		}
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

interface UserTurns {
	readonly messages: AsyncIterable<SDKUserMessage>;
	push(message: SDKUserMessage): void;
}

function userTurns(finished: Promise<void>): UserTurns {
	const pending: SDKUserMessage[] = [];
	let arrived = signal();
	let open = true;
	void (async () => {
		await finished;
		open = false;
		arrived.resolve();
	})();
	async function* messages(): AsyncIterable<SDKUserMessage> {
		for (;;) {
			const next = pending.shift();
			if (next) {
				yield next;
				continue;
			}
			if (!open) return;
			await arrived.promise;
			arrived = signal();
		}
	}
	return {
		messages: messages(),
		push(message) {
			pending.push(message);
			arrived.resolve();
		},
	};
}

function signal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((settle) => (resolve = settle));
	return { promise, resolve };
}

function userTurn(text: string, promptId: UUID): SDKUserMessage {
	return {
		type: 'user',
		uuid: promptId,
		message: { role: 'user', content: text },
		parent_tool_use_id: null,
	};
}

function canContinue(
	active: ActiveRun,
	{ profile, skills }: RunSettings,
	resumeAt: string | undefined,
	freshConversation: boolean | undefined,
): boolean {
	return (
		!active.cancelled &&
		!resumeAt &&
		!freshConversation &&
		(profile?.access ?? 'auto') === (active.profile?.access ?? 'auto') &&
		profile?.mode === active.profile?.mode &&
		profile?.report === active.profile?.report &&
		skills?.join('\n') === active.skills?.join('\n')
	);
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
