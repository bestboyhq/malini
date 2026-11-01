import { randomUUID, type UUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
	query as sdkQuery,
	type CanUseTool,
	type HookCallback,
	type McpServerStatus,
	type Options,
	type PermissionMode,
	type PermissionResult,
	type Query,
	type SDKControlGetContextUsageResponse,
	type SDKMessage,
	type SDKResultMessage,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
	lineageDirectories,
	type AgentLineage,
	type AgentRunProfile,
	type AgentTheme,
} from '../agent-profile.js';
import type { ProviderApprovalReply, ProviderQuestionReply } from '../interaction-types.js';
import type {
	ConversationHistoryMessage,
	PlatformResult,
	PlatformToolCall,
	Secrets,
} from '../protocol.js';
import { ProviderInteractionBroker } from '../provider-interactions.js';
import type { ProviderContext, ProviderEventListener, ProviderHandle } from '../providers/types.js';
import type { McpServerReport } from '../types.js';
import { MALINI_MCP_SERVER, maliniTools } from './browser-tools.js';
import { previousConversation, recordHooks } from './compaction.js';
import {
	configChanged,
	configSnapshot,
	restamped,
	type ConfigSnapshot,
} from './config-snapshot.js';
import { CLAUDE_LOGIN_COMMAND } from './installation.js';
import { systemPromptAppend } from './instructions.js';
import {
	mcpServerReport,
	probeMcpServer,
	switchMcpServerLive,
	type McpProbeOptions,
	type McpServerEntry,
} from './mcp-servers.js';
import {
	approvedInput,
	AUTO_MODE_STOPPED,
	AUTO_MODE_UNAVAILABLE,
	autoModeCategory,
	AutoModeOutage,
	autoModeRule,
	claudeAnswers,
	claudeQuestions,
	disallowedTools,
	isMaliniTool,
	steerToMalini,
	permissionDescriptor,
	permissionModeFor,
	rememberedPermissions,
	retryKey,
	sandboxFor,
	UNCHECKED_CALL_REASON,
} from './permissions.js';
import { RunFailureSignals, SIGNED_OUT_TEXT, UNKNOWN_FAILURE } from './run-failure.js';
import { claudeShell, type SessionSecrets } from './secrets.js';
import { lastOutputLine } from './task-output.js';
import { ClaudeTranscript } from './transcript.js';
import { anthropicSnapshot, type AnthropicSnapshot } from './usage.js';
import { allowInUserSettings, claudeStateFile, userSettingsFile } from './user-settings.js';
import { isRecord } from '../type-guards.js';

const INTERRUPT_GRACE_MS = 3_000;
const BACKGROUND_OUTPUT_POLL_MS = 2_000;
const IDLE_PROCESS_MS = 10 * 60_000;
const MCP_SETTLE_MS = 5_000;
const MCP_SETTLE_POLL_MS = 250;
const BLOCKED_CALL_DECISION_TIMEOUT_S = 24 * 60 * 60;
const RETRY_BLOCKED_CALL = {
	hookSpecificOutput: { hookEventName: 'PermissionDenied', retry: true },
} as const;
const KEPT_BLOCKED_MESSAGE =
	'The user kept this call blocked. Carry on with the rest of the task without it.';
const PLAN_HANDOFF_MESSAGE =
	'Malini now shows this plan to the user, who starts the implementation from there. End your turn without restating the plan.';

export type ClaudeContextUsage = Pick<
	SDKControlGetContextUsageResponse,
	'categories' | 'skills' | 'memoryFiles' | 'totalTokens'
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
		| 'reconnectMcpServer'
		| 'toggleMcpServer'
		| 'initializationResult'
		| 'close'
		| 'stopTask'
		| 'applyFlagSettings'
		| 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'
	> & {
		getContextUsage(opts: { detail: 'summary' }): Promise<ClaudeContextUsage>;
		mcpAuthenticate?(serverName: string): Promise<unknown>;
	};

interface McpReport {
	readonly runId: string;
	readonly servers: readonly McpServerReport[];
}

export type QueryFunction = (params: {
	prompt: AsyncIterable<SDKUserMessage>;
	options: Options;
}) => ClaudeQuery;

export interface ClaudeSessionOptions {
	readonly context: ProviderContext;
	readonly emit: ProviderEventListener;
	readonly executable: string | null;
	readonly query?: QueryFunction;
	readonly outage?: AutoModeOutage;
	readonly secrets: SessionSecrets;
}

interface RunSettings {
	readonly profile: AgentRunProfile | undefined;
	readonly skills: readonly string[] | undefined;
	readonly theme: AgentTheme | undefined;
	readonly lineage: AgentLineage | undefined;
	readonly plugins: readonly string[];
	readonly compactWindow: number | undefined;
}

interface ActiveRun {
	runId: string;
	promptId: UUID;
	profile: AgentRunProfile | undefined;
	readonly skills: readonly string[] | undefined;
	readonly theme: AgentTheme | undefined;
	readonly lineage: AgentLineage | undefined;
	readonly plugins: readonly string[];
	readonly compactWindow: number | undefined;
	results: SDKResultMessage[];
	costBefore: number;
	readonly query: ClaudeQuery;
	readonly messages: AsyncIterator<SDKMessage>;
	readonly turns: UserTurns;
	readonly abort: AbortController;
	readonly finished: Promise<void>;
	readonly end: () => void;
	transcript: ClaudeTranscript;
	failureSignals: RunFailureSignals;
	turnEnded: Promise<void>;
	cancelled: boolean;
	snapshot: AnthropicSnapshot | null;
	pending: Promise<IteratorResult<SDKMessage>> | null;
	idleTimeout: NodeJS.Timeout | null;
	config: ConfigSnapshot | null;
	readonly approvedRetries: Set<string>;
	readonly retriedCalls: Set<string>;
	readonly allowRules: Set<string>;
	readonly uncheckedRetries: Map<string, number>;
	readonly uncheckedFallbacks: Set<string>;
	fallback: NodeJS.Timeout | null;
}

type TurnKind = 'fresh' | 'resumed' | 'warm';

export class ClaudeSession implements ProviderHandle {
	readonly #context: ProviderContext;
	readonly #emit: ProviderEventListener;
	readonly #executable: string | null;
	readonly #query: QueryFunction;
	readonly #interactions: ProviderInteractionBroker;
	readonly #outage: AutoModeOutage;
	readonly #secrets: SessionSecrets;
	readonly #blockedCallRules = new Map<string, string>();
	#claudeSessionId: string | undefined;
	#seedHistory: readonly ConversationHistoryMessage[] | undefined;
	#active: ActiveRun | null = null;
	#requestedMode: PermissionMode = 'default';
	#initialized = false;
	#knownMcpServers: readonly string[] = [];
	#mcpStatus = new Map<string, McpServerStatus>();
	#mcpReport: McpReport | null = null;

	constructor(options: ClaudeSessionOptions) {
		this.#context = options.context;
		this.#emit = options.emit;
		this.#executable = options.executable;
		this.#query = options.query ?? sdkQuery;
		this.#outage = options.outage ?? new AutoModeOutage();
		this.#secrets = options.secrets;
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
		theme?: AgentTheme,
		lineage?: AgentLineage,
		plugins: readonly string[] = [],
		compactWindow?: number,
	): Promise<void> {
		const run: RunSettings = { profile, skills, theme, lineage, plugins, compactWindow };
		const active = this.#active;
		if (active && !active.idleTimeout) {
			const continues = canContinue(active, run, resumeAt !== undefined, freshConversation);
			const answered = active.transcript.waiting || active.results.length > 0;
			const replaces = steer || active.transcript.waiting;
			if (continues && replaces) {
				await this.#handOff(active, prompt, runId, profile, !answered);
				return;
			}
			if (!replaces) throw new Error(`RUN_ACTIVE: ${active.runId} is still running`);
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
		const idle = this.#active;
		if (idle?.idleTimeout) {
			const fresh =
				canContinue(idle, run, rewinds(idle, resumeAt), freshConversation) &&
				idle.compactWindow === run.compactWindow &&
				idle.config !== null &&
				!configChanged(idle.config);
			if (fresh && (await this.#continue(idle, prompt, runId, profile)) === 'done') return;
			if (!fresh) this.#retire(idle);
		}
		const resumed = this.#claudeSessionId !== undefined;
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
		const active = this.#launch(executable, runId, run, resumeAt);
		const outcome = await this.#turn(active, prompt, run.profile, resumed ? 'resumed' : 'fresh');
		return outcome === 'transcript-missing' ? outcome : 'done';
	}

	#launch(
		executable: string,
		runId: string,
		run: RunSettings,
		resumeAt: string | undefined,
	): ActiveRun {
		const abort = new AbortController();
		let end!: () => void;
		const finished = new Promise<void>((resolve) => (end = resolve));
		let open!: (proceed: boolean) => void;
		const turns = userTurns(finished, new Promise<boolean>((resolve) => (open = resolve)));
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
			promptId: randomUUID(),
			profile: run.profile,
			skills: run.skills,
			theme: run.theme,
			lineage: run.lineage,
			plugins: run.plugins,
			compactWindow: run.compactWindow,
			results: [],
			costBefore: 0,
			query,
			messages: query[Symbol.asyncIterator](),
			turns,
			abort,
			finished,
			end,
			transcript: new ClaudeTranscript(runId, this.#emit),
			failureSignals: new RunFailureSignals(),
			turnEnded: finished,
			cancelled: false,
			snapshot: null,
			pending: null,
			idleTimeout: null,
			config: null,
			approvedRetries: new Set(),
			retriedCalls: new Set(),
			allowRules: new Set(),
			uncheckedRetries: new Map(),
			uncheckedFallbacks: new Set(),
			fallback: null,
		};
		this.#active = active;
		void this.#openOnceMcpSettles(active, open);
		return active;
	}

	// ponytail: a cold start waits only for the MCP servers this chat already saw or that are still pending, so a server Claude Code lists late can miss the first turn of a new chat; persist the names per worktree if that matters
	async #openOnceMcpSettles(active: ActiveRun, open: (proceed: boolean) => void): Promise<void> {
		const deadline = Date.now() + MCP_SETTLE_MS;
		while (!active.cancelled && Date.now() < deadline) {
			const servers = await Promise.race([
				active.query.mcpServerStatus().catch(() => null),
				delay(deadline - Date.now(), null, { ref: false }),
			]);
			if (servers) this.#learnMcpStatus(servers);
			if (!servers || mcpSettled(servers, this.#knownMcpServers)) break;
			await delay(MCP_SETTLE_POLL_MS, undefined, { ref: false });
		}
		open(!active.cancelled);
	}

	async #continue(
		active: ActiveRun,
		prompt: string,
		runId: string,
		profile: AgentRunProfile | undefined,
	): Promise<'done' | 'process-ended'> {
		if (active.idleTimeout) clearTimeout(active.idleTimeout);
		active.idleTimeout = null;
		active.costBefore = active.results.at(-1)?.total_cost_usd ?? active.costBefore;
		active.runId = runId;
		active.promptId = randomUUID();
		active.results = [];
		active.snapshot = null;
		active.transcript = new ClaudeTranscript(runId, this.#emit);
		active.failureSignals = new RunFailureSignals();
		const outcome = await this.#turn(active, prompt, profile, 'warm');
		return outcome === 'process-ended' ? outcome : 'done';
	}

	async #turn(
		active: ActiveRun,
		prompt: string,
		profile: AgentRunProfile | undefined,
		kind: TurnKind,
	): Promise<'done' | 'transcript-missing' | 'process-ended'> {
		let endTurn!: () => void;
		active.turnEnded = new Promise<void>((resolve) => (endTurn = resolve));
		this.#initialized = false;
		const { runId, promptId, transcript } = active;
		const outputPoll = setInterval(
			() => void this.#readBackgroundOutput(transcript),
			BACKGROUND_OUTPUT_POLL_MS,
		).unref();
		let keepWarm = false;
		try {
			await this.#applyEffort(active, profile);
			if (active.runId === runId) {
				active.turns.push(userTurn(this.#promptWithSeed(prompt), promptId));
			}
			const ended = await this.#consume(active);
			const started = this.#initialized || active.cancelled;
			if (!started && kind === 'warm') return 'process-ended';
			if (!started && kind === 'resumed' && active.results[0]?.is_error) {
				return 'transcript-missing';
			}
			this.#seedHistory = undefined;
			transcript.endBackgroundWork();
			this.#finish(active);
			keepWarm = !ended && !active.cancelled;
		} catch (error) {
			if (kind === 'warm' && !this.#initialized && !active.cancelled) return 'process-ended';
			transcript.endBackgroundWork();
			this.#emit({
				type: 'run.failed',
				runId: active.runId,
				...(active.cancelled
					? { error: 'cancelled' }
					: { error: describe(error), failure: UNKNOWN_FAILURE }),
				...cursor(transcript),
			});
		} finally {
			clearInterval(outputPoll);
			this.#interactions.cancelRun(active.runId);
			active.approvedRetries.clear();
			active.uncheckedRetries.clear();
			active.uncheckedFallbacks.clear();
			if (keepWarm) void this.#rest(active);
			else this.#retire(active);
			endTurn();
		}
		return 'done';
	}

	async #consume(active: ActiveRun): Promise<boolean> {
		let reportsSessionState = false;
		for (;;) {
			const next = await this.#read(active);
			if (next.done) return true;
			const message = next.value;
			if (message.type === 'system' && message.subtype === 'init') this.#acceptInit(message);
			active.transcript.accept(message);
			active.failureSignals.accept(message);
			if (message.type === 'system' && message.subtype === 'session_state_changed') {
				reportsSessionState = true;
				const settled = message.state === 'idle' && !active.transcript.hasBackgroundTasks;
				if (active.results.length > 0 && settled) return false;
			}
			if (message.type !== 'result') continue;
			if (active.results.length === 0 && !answersPrompt(message, active.promptId)) continue;
			active.results.push(message);
			active.transcript.recordTurnResult(message);
			if (!active.cancelled) {
				active.snapshot = await anthropicSnapshot(active.query, new Date());
			}
			if (!reportsSessionState || active.cancelled) return false;
		}
	}

	#read(active: ActiveRun): Promise<IteratorResult<SDKMessage>> {
		const next = active.pending ?? active.messages.next();
		active.pending = null;
		return next;
	}

	async #rest(active: ActiveRun): Promise<void> {
		const next = active.messages.next();
		active.pending = next;
		active.idleTimeout = setTimeout(() => this.#retire(active), IDLE_PROCESS_MS).unref();
		await next.catch(() => undefined);
		if (active.idleTimeout) this.#retire(active);
	}

	#retire(active: ActiveRun): void {
		if (active.idleTimeout) clearTimeout(active.idleTimeout);
		if (active.fallback) clearTimeout(active.fallback);
		active.idleTimeout = null;
		active.fallback = null;
		active.pending = null;
		active.query.close();
		if (this.#active === active) this.#active = null;
		active.end();
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
		active.snapshot = null;
		active.transcript.handOff(runId);
		active.failureSignals = new RunFailureSignals();
		await this.#applyEffort(active, profile);
		if (interrupt) await active.query.interrupt().catch(() => undefined);
		active.turns.push(userTurn(prompt, active.promptId));
		await active.turnEnded;
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
			this.#reportMcp(
				active.runId,
				message.mcp_servers.map((server) => this.#describeMcp(server)),
			);
			void this.#learnContextWindow(active);
		}
	}

	#learnMcpStatus(servers: readonly McpServerStatus[]): void {
		this.#mcpStatus = new Map(servers.map((server) => [server.name, server]));
	}

	#describeMcp(server: McpServerEntry): McpServerReport {
		const known = this.#mcpStatus.get(server.name);
		const report = mcpServerReport(known?.status === server.status ? known : server);
		const source = report.source ?? (known && mcpServerReport(known).source);
		return source ? { ...report, source } : report;
	}

	#reportMcp(runId: string, servers: readonly McpServerReport[]): void {
		this.#knownMcpServers = servers.map(({ name }) => name);
		this.#mcpReport = { runId, servers };
		this.#emit({ type: 'mcp.status', runId, servers: [...servers] });
	}

	async #learnContextWindow(active: ActiveRun): Promise<void> {
		const { transcript } = active;
		const usage = await active.query.getContextUsage({ detail: 'summary' }).catch(() => null);
		if (!usage) return;
		transcript.recordContextWindow(usage.rawMaxTokens);
		active.config ??= configSnapshot(
			this.#context.cwd,
			usage.memoryFiles.map(({ path }) => path),
		);
	}

	#finish(active: ActiveRun, handedOff = false): void {
		const { runId, transcript, results, snapshot } = active;
		const result = results.at(-1);
		if (result) {
			if (!transcript.contextWindowTokens) {
				transcript.recordContextWindow(Object.values(result.modelUsage)[0]?.contextWindow);
			}
			const usages = results.map(({ usage }) => usage);
			const contextTokens = transcript.usage?.contextTokens ?? snapshot?.context?.totalTokens;
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
				...(contextTokens === undefined ? {} : { contextTokens }),
				...(transcript.contextWindowTokens
					? { contextWindowTokens: transcript.contextWindowTokens }
					: {}),
				...(snapshot?.metrics ? { providerMetrics: snapshot.metrics } : {}),
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
				failure: UNKNOWN_FAILURE,
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
		this.#emit({
			type: 'run.failed',
			runId,
			error: resultError(result),
			failure: active.failureSignals.failure(result),
			...cursor(transcript),
		});
	}

	#options(
		executable: string,
		{ profile, skills, theme, lineage, plugins, compactWindow }: RunSettings,
		resumeAt: string | undefined,
		abort: AbortController,
	): Options {
		const directories = lineageDirectories(lineage);
		const permissionMode = permissionModeFor(profile);
		this.#requestedMode = permissionMode;
		const model = this.#context.model;
		return {
			cwd: this.#context.cwd,
			abortController: abort,
			pathToClaudeCodeExecutable: executable,
			env: {
				...claudeEnvironment(),
				CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
				CLAUDE_CODE_SHELL: claudeShell(),
				CLAUDE_CODE_SHELL_PREFIX: this.#secrets.runScript,
				...(theme ? { MALINI_THEME: theme } : {}),
			},
			settingSources: ['user', 'project', 'local'],
			systemPrompt: {
				type: 'preset',
				preset: 'claude_code',
				append: systemPromptAppend(this.#context.cwd, profile?.report ?? 'medium', theme, lineage),
			},
			includePartialMessages: true,
			thinking: { type: 'adaptive', display: 'summarized' },
			permissionMode,
			...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
			sandbox: sandboxFor(profile),
			disallowedTools: disallowedTools(lineage),
			...(directories.length > 0 ? { additionalDirectories: directories } : {}),
			hooks: {
				PreToolUse: [
					{ matcher: 'Bash', hooks: [steerToMalini] },
					{ hooks: [this.#allowApprovedRetry()] },
				],
				PostToolUse: [{ hooks: [this.#maskSecrets()] }],
				PermissionDenied: [
					{ hooks: [this.#askAboutBlockedCall()], timeout: BLOCKED_CALL_DECISION_TIMEOUT_S },
				],
				SessionStart: [
					{ matcher: 'compact', hooks: recordHooks(() => this.#context.requestHistory()) },
				],
			},
			...(compactWindow ? { settings: { autoCompactWindow: compactWindow } } : {}),
			...maliniTools(this.#context.requestBrowser, (call) => this.#requestPlatform(call)),
			canUseTool: this.#canUseTool(),
			...(model ? { model } : {}),
			...(profile ? { effort: profile.effort } : {}),
			...(skills ? { skills: [...skills] } : {}),
			plugins: plugins.map((path) => ({ type: 'local', path })),
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
			const unchecked = Boolean(this.#active?.fallback) && !isMaliniTool(toolName);
			const resolution = await this.#interactions.requestApproval({
				runId,
				approvalId: `approval-${toolCallId}`,
				reason: unchecked
					? UNCHECKED_CALL_REASON
					: (options.title ?? options.decisionReason ?? `Claude wants to use ${toolName}`),
				toolName,
				input,
				permission: permissionDescriptor(toolName, input, this.#context.cwd, options.blockedPath),
				...(unchecked ? { autoModeUnavailable: true } : {}),
				signal: options.signal,
			});
			if (resolution.decision === 'deny') {
				if (resolution.reason) return { behavior: 'deny', message: resolution.reason };
				if (unchecked) {
					this.#active?.transcript.markUnchecked(toolCallId);
					return { behavior: 'deny', message: KEPT_BLOCKED_MESSAGE };
				}
				const active = this.#active;
				if (active?.runId === runId) {
					active.cancelled = true;
					active.transcript.markStoppedByUser();
				}
				return { behavior: 'deny', message: 'The user denied this action.', interrupt: true };
			}
			const updatedPermissions = rememberedPermissions(
				toolName,
				options.suggestions,
				resolution.scope,
			);
			return {
				behavior: 'allow',
				updatedInput: approvedInput(toolName, input, resolution.updatedInput),
				...(updatedPermissions ? { updatedPermissions } : {}),
			};
		};
	}

	#askAboutBlockedCall(): HookCallback {
		return async (input, _toolUseId, { signal }) => {
			const active = this.#active;
			if (input.hook_event_name !== 'PermissionDenied' || !active) return {};
			if (active.retriedCalls.has(input.tool_use_id)) return {};
			const category = autoModeCategory(input.reason);
			if (category.startsWith(AUTO_MODE_STOPPED)) {
				await this.#fallBack(active);
				return {};
			}
			const unchecked = category === AUTO_MODE_UNAVAILABLE;
			const key = retryKey(input.tool_name, input.tool_input);
			if (unchecked && (await this.#retriedUnchecked(active, key, signal))) {
				return RETRY_BLOCKED_CALL;
			}
			const { cwd } = this.#context;
			const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
			const approvalId = `approval-${input.tool_use_id}`;
			const rule = autoModeRule(input.tool_name, toolInput, cwd);
			this.#blockedCallRules.set(approvalId, rule);
			const resolution = await this.#interactions
				.requestApproval({
					runId: active.runId,
					approvalId,
					reason: unchecked ? UNCHECKED_CALL_REASON : `Blocked by auto mode: ${category}`,
					toolName: input.tool_name,
					input: toolInput,
					permission: permissionDescriptor(input.tool_name, toolInput, cwd, undefined),
					autoModeRule: rule,
					...(unchecked ? { autoModeUnavailable: true } : {}),
					signal,
				})
				.finally(() => this.#blockedCallRules.delete(approvalId));
			if (resolution.decision === 'deny') return {};
			if (resolution.alwaysAllow) await this.#allowWhileRunning(active, rule);
			active.approvedRetries.add(key);
			return RETRY_BLOCKED_CALL;
		};
	}

	async #retriedUnchecked(active: ActiveRun, key: string, signal: AbortSignal): Promise<boolean> {
		if (active.uncheckedFallbacks.has(key)) return false;
		const retries = active.uncheckedRetries.get(key) ?? 0;
		const wait = this.#outage.down ? undefined : this.#outage.retryDelaysMs[retries];
		if (wait === undefined) {
			active.uncheckedFallbacks.add(key);
			await this.#fallBack(active);
			return true;
		}
		active.uncheckedRetries.set(key, retries + 1);
		return delay(wait, true, { signal, ref: false }).catch(() => false);
	}

	async #fallBack(active: ActiveRun): Promise<void> {
		this.#outage.confirm();
		if (!active.fallback) {
			await active.query
				.setPermissionMode('acceptEdits')
				.catch((error: unknown) =>
					process.stderr.write(`[claude] could not fall back to acceptEdits: ${describe(error)}\n`),
				);
		}
		this.#restoreAutoOnceUp(active);
	}

	#restoreAutoOnceUp(active: ActiveRun): void {
		if (active.fallback) clearTimeout(active.fallback);
		active.fallback = setTimeout(() => {
			if (this.#outage.down) {
				this.#restoreAutoOnceUp(active);
				return;
			}
			active.fallback = null;
			void active.query.setPermissionMode('auto').catch(() => undefined);
		}, this.#outage.remainingMs).unref();
	}

	#maskSecrets(): HookCallback {
		return async (input) => {
			if (input.hook_event_name !== 'PostToolUse') return {};
			const masked = this.#secrets.mask(input.tool_response);
			return masked === input.tool_response
				? {}
				: { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: masked } };
		};
	}

	#allowApprovedRetry(): HookCallback {
		return async (input) => {
			const active = this.#active;
			if (input.hook_event_name !== 'PreToolUse' || !active) return {};
			if (!active.approvedRetries.delete(retryKey(input.tool_name, input.tool_input))) return {};
			active.retriedCalls.add(input.tool_use_id);
			return {
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					permissionDecision: 'allow',
					permissionDecisionReason:
						'The user allowed this call in Malini after auto mode blocked it.',
				},
			};
		};
	}

	async #allowWhileRunning(active: ActiveRun, rule: string): Promise<void> {
		active.allowRules.add(rule);
		if (active.config) active.config = restamped(active.config, userSettingsFile());
		await active.query
			.applyFlagSettings({ permissions: { allow: [...active.allowRules] } })
			.catch((error: unknown) =>
				process.stderr.write(`[claude] could not allow ${rule} live: ${describe(error)}\n`),
			);
	}

	#requestPlatform(call: PlatformToolCall): Promise<PlatformResult> {
		const runId = this.#active?.runId;
		if (!runId) return Promise.resolve({ ok: false, error: 'No Malini run is active.' });
		return this.#context.requestPlatform({ ...call, runId });
	}

	#promptWithSeed(prompt: string): string {
		const history = this.#seedHistory;
		if (!history || history.length === 0) return prompt;
		return `${previousConversation(history)}\n\n${prompt}`;
	}

	async cancel(runId: string): Promise<void> {
		const active = this.#active;
		if (!active || active.runId !== runId || active.idleTimeout) return;
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
		if (reply.alwaysAllow && reply.decision === 'allow') {
			const rule = this.#blockedCallRules.get(reply.approvalId);
			if (!rule) throw new Error(`${reply.approvalId} is not a call auto mode blocked`);
			await allowInUserSettings(rule);
		}
		this.#interactions.resolveApproval(reply);
	}

	async respondToQuestion(reply: ProviderQuestionReply): Promise<void> {
		this.#interactions.resolveQuestion(reply);
	}

	async refreshSessionStatus(): Promise<void> {
		const active = this.#active;
		if (!active) return;
		const { runId, query } = active;
		const [servers, { context, metrics }] = await Promise.all([
			query.mcpServerStatus(),
			anthropicSnapshot(query, new Date()),
		]);
		this.#learnMcpStatus(servers);
		this.#reportMcp(
			runId,
			servers.map((server) => mcpServerReport(server)),
		);
		if (!context) return;
		this.#emit({
			type: 'usage.updated',
			runId,
			contextTokens: context.totalTokens,
			contextWindowTokens: context.rawMaxTokens,
			...(metrics ? { providerMetrics: metrics } : {}),
			interim: true,
		});
	}

	async reconnectMcpServer(serverName: string, plugins: readonly string[] = []): Promise<void> {
		const active = this.#active;
		if (!active) {
			const server = await probeMcpServer(serverName, this.#mcpProbe(plugins));
			if (server) await this.adoptMcpServer(server);
			return;
		}
		try {
			await active.query.reconnectMcpServer(serverName);
		} finally {
			await this.refreshSessionStatus();
		}
	}

	#mcpProbe(plugins: readonly string[]): McpProbeOptions {
		const executable = this.#executable;
		if (!executable) throw new Error('Claude Code is not installed');
		const { cwd } = this.#context;
		return { cwd, plugins, executable, env: claudeEnvironment(), query: this.#query };
	}

	async adoptMcpServer(server: McpServerReport): Promise<void> {
		const active = this.#active;
		if (active) {
			await active.query.reconnectMcpServer(server.name).catch(() => undefined);
			await this.refreshSessionStatus().catch(() => undefined);
			return;
		}
		const report = this.#mcpReport;
		if (!report?.servers.some(({ name }) => name === server.name)) return;
		this.#reportMcp(
			report.runId,
			report.servers.map((known) => (known.name === server.name ? server : known)),
		);
	}

	async switchMcpServer(serverName: string, on: boolean): Promise<boolean> {
		const active = this.#active;
		if (!active || !(await switchMcpServerLive(active.query, serverName, on))) return false;
		if (active.config) {
			active.config = restamped(active.config, userSettingsFile(), claudeStateFile());
		}
		await this.refreshSessionStatus().catch(() => undefined);
		return true;
	}

	setSecrets(secrets: Secrets): Promise<void> {
		return this.#secrets.set(secrets);
	}

	async close(): Promise<void> {
		this.#interactions.close();
		const active = this.#active;
		if (active?.idleTimeout) this.#retire(active);
		else if (active) await this.cancel(active.runId);
		await this.#secrets.remove();
	}
}

interface UserTurns {
	readonly messages: AsyncIterable<SDKUserMessage>;
	push(message: SDKUserMessage): void;
}

function userTurns(finished: Promise<void>, ready: Promise<boolean>): UserTurns {
	const pending: SDKUserMessage[] = [];
	let arrived = signal();
	let open = true;
	void (async () => {
		await finished;
		open = false;
		arrived.resolve();
	})();
	async function* messages(): AsyncIterable<SDKUserMessage> {
		if (!(await ready)) return;
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
	{ profile, skills, theme, lineage, plugins }: RunSettings,
	rewound: boolean,
	freshConversation: boolean | undefined,
): boolean {
	return (
		!active.cancelled &&
		!rewound &&
		!freshConversation &&
		(profile?.access ?? 'auto') === (active.profile?.access ?? 'auto') &&
		profile?.mode === active.profile?.mode &&
		profile?.report === active.profile?.report &&
		theme === active.theme &&
		skills?.join('\n') === active.skills?.join('\n') &&
		JSON.stringify(lineage ?? null) === JSON.stringify(active.lineage ?? null) &&
		JSON.stringify(plugins) === JSON.stringify(active.plugins)
	);
}

function rewinds(idle: ActiveRun, resumeAt: string | undefined): boolean {
	return resumeAt !== undefined && resumeAt !== idle.transcript.cursor;
}

function mcpSettled(servers: readonly McpServerStatus[], known: readonly string[]): boolean {
	const listed = new Set(servers.map(({ name }) => name));
	return (
		servers.every(({ status }) => status !== 'pending') && known.every((name) => listed.has(name))
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
	if (SIGNED_OUT_TEXT.test(text)) {
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
