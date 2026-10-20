import { readFileSync } from 'node:fs';
import type {
	ModelInfo,
	Options,
	PermissionMode,
	PermissionResult,
	PermissionUpdate,
	SDKControlGetContextUsageResponse,
	SDKControlGetUsageResponse,
	SDKControlInitializeResponse,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { isRecord } from '../../type-guards.js';
import type { QueryFunction } from '../session.js';

export interface CanUseToolStep {
	readonly canUseTool: {
		readonly toolName: string;
		readonly input: Record<string, unknown>;
		readonly opts: {
			readonly toolUseID: string;
			readonly requestId: string;
			readonly suggestions?: PermissionUpdate[];
		};
	};
}

export type ScriptStep =
	SDKMessage | CanUseToolStep | 'wait-for-interrupt' | 'wait-for-stop-task' | 'wait-for-prompt';

export type RecordedScenario =
	| 'readAndBash'
	| 'write'
	| 'ask'
	| 'plan'
	| 'bashFailure'
	| 'deny'
	| 'orphanedTask'
	| 'backgroundAgent'
	| 'backgroundCommand'
	| 'stoppedBackgroundCommand'
	| 'retriedStream'
	| 'nonStreamingFallback';

export interface FakeRun {
	readonly options: Options;
	readonly prompt: Promise<string>;
	readonly permissionResults: (PermissionResult | null)[];
	readonly permissionModes: PermissionMode[];
	readonly mcpPermissionModes: Record<string, string | null>;
	readonly stoppedTasks: string[];
	readonly followUps: string[];
	readonly efforts: unknown[];
	interrupted: boolean;
	closed: boolean;
}

export const FAKE_CONTEXT_CATEGORIES: SDKControlGetContextUsageResponse['categories'] = [
	{ name: 'System prompt', tokens: 2_104, color: 'promptBorder', kind: 'used' },
	{
		name: 'MCP tools (deferred)',
		tokens: 5_965,
		color: 'inactive',
		isDeferred: true,
		kind: 'deferred',
	},
	{ name: 'Custom agents', tokens: 0, color: 'permission', kind: 'used' },
	{ name: 'Messages', tokens: 23_368, color: 'purple', kind: 'used' },
	{ name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', kind: 'buffer' },
	{ name: 'Free space', tokens: 141_528, color: 'promptBorder', kind: 'free' },
];

export const FAKE_PLAN_USAGE: SDKControlGetUsageResponse = {
	session: {
		total_cost_usd: 0,
		total_api_duration_ms: 0,
		total_duration_ms: 0,
		total_lines_added: 0,
		total_lines_removed: 0,
		model_usage: {},
	},
	subscription_type: 'max',
	rate_limits_available: true,
	rate_limits: {
		five_hour: { utilization: 92, resets_at: '2026-10-12T13:50:00.000Z' },
		seven_day: { utilization: 34, resets_at: '2026-10-15T06:00:00.000Z' },
		seven_day_opus: null,
		model_scoped: [{ display_name: 'Fable', utilization: 12, resets_at: null }],
	},
	behaviors: null,
};

const recorded: unknown = JSON.parse(
	readFileSync(new URL('./transcripts.json', import.meta.url), 'utf8'),
);

export function recordedScript(scenario: RecordedScenario): ScriptStep[] {
	const steps: unknown = isRecord(recorded) ? recorded[scenario] : undefined;
	if (!Array.isArray(steps) || !steps.every(isRecordedStep)) {
		throw new Error(`no recorded ${scenario} transcript`);
	}
	return steps;
}

export function recordedMessages(scenario: RecordedScenario): SDKMessage[] {
	return recordedScript(scenario).filter(isMessage);
}

export function initializeResponse(models: ModelInfo[]): SDKControlInitializeResponse {
	return {
		commands: [],
		agents: [],
		output_style: 'default',
		available_output_styles: [],
		models,
		account: { email: 'ada@example.com' },
	};
}

export function fakeClaude(
	scripts: readonly (readonly ScriptStep[])[] = [],
	initializationResult: () => Promise<SDKControlInitializeResponse> = async () =>
		initializeResponse([]),
): { readonly query: QueryFunction; readonly runs: FakeRun[] } {
	const runs: FakeRun[] = [];
	const query: QueryFunction = ({ prompt, options }) => {
		const script = scripts[runs.length] ?? [];
		let release!: () => void;
		const interrupted = new Promise<void>((resolve) => (release = resolve));
		let releaseStop!: () => void;
		const taskStopped = new Promise<void>((resolve) => (releaseStop = resolve));
		const prompts = prompt[Symbol.asyncIterator]();
		const sent = nextPrompt(prompts);
		let latest = sent;
		const run: FakeRun = {
			options,
			prompt: promptText(sent),
			permissionResults: [],
			permissionModes: [],
			mcpPermissionModes: {},
			stoppedTasks: [],
			followUps: [],
			efforts: [],
			interrupted: false,
			closed: false,
		};
		runs.push(run);
		let iterating = true;
		const whileIterating = async <T>(answer: T): Promise<T> => {
			if (!iterating) throw new Error('Claude Code closed when the session stopped reading');
			return answer;
		};
		return {
			async *[Symbol.asyncIterator]() {
				try {
					for (const step of script) {
						if (step === 'wait-for-interrupt') {
							await interrupted;
							continue;
						}
						if (step === 'wait-for-stop-task') {
							await taskStopped;
							continue;
						}
						if (step === 'wait-for-prompt') {
							latest = nextPrompt(prompts);
							run.followUps.push(await promptText(latest));
							continue;
						}
						if ('canUseTool' in step) {
							run.permissionResults.push(await askPermission(options, step));
							continue;
						}
						yield step.type === 'result' ? echoPrompt(step, (await latest)?.uuid) : step;
					}
				} finally {
					iterating = false;
				}
			},
			async interrupt() {
				run.interrupted = true;
				release();
				return undefined;
			},
			async applyFlagSettings(settings) {
				run.efforts.push(settings.effortLevel);
			},
			async stopTask(taskId) {
				run.stoppedTasks.push(taskId);
				releaseStop();
			},
			async setPermissionMode(mode) {
				run.permissionModes.push(mode);
			},
			async setMcpPermissionModeOverride(server, mode) {
				run.mcpPermissionModes[server] = mode;
				return {};
			},
			async mcpServerStatus() {
				return [];
			},
			getContextUsage() {
				return whileIterating({ rawMaxTokens: 200_000, categories: FAKE_CONTEXT_CATEGORIES });
			},
			usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET() {
				return whileIterating(FAKE_PLAN_USAGE);
			},
			initializationResult,
			close() {
				run.closed = true;
			},
		};
	};
	return { query, runs };
}

async function askPermission(
	options: Options,
	step: CanUseToolStep,
): Promise<PermissionResult | null> {
	const canUseTool = options.canUseTool;
	if (!canUseTool) throw new Error('the session did not pass canUseTool');
	const { toolName, input, opts } = step.canUseTool;
	const signal = options.abortController?.signal ?? new AbortController().signal;
	return canUseTool(toolName, input, { ...opts, signal });
}

async function nextPrompt(
	prompts: AsyncIterator<SDKUserMessage>,
): Promise<SDKUserMessage | undefined> {
	const next = await prompts.next();
	return next.done ? undefined : next.value;
}

async function promptText(sent: Promise<SDKUserMessage | undefined>): Promise<string> {
	const content = (await sent)?.message.content;
	return typeof content === 'string' ? content : '';
}

function echoPrompt(result: SDKResultMessage, promptId: string | undefined): SDKResultMessage {
	if (!promptId || !result.user_message_uuids) return result;
	return { ...result, user_message_uuid: promptId, user_message_uuids: [promptId] };
}

function isMessage(step: ScriptStep): step is SDKMessage {
	return typeof step !== 'string' && !('canUseTool' in step);
}

function isRecordedStep(value: unknown): value is ScriptStep {
	if (!isRecord(value)) return false;
	const call = value['canUseTool'];
	if (call === undefined) return typeof value['type'] === 'string';
	return (
		isRecord(call) &&
		typeof call['toolName'] === 'string' &&
		isRecord(call['input']) &&
		isRecord(call['opts']) &&
		typeof call['opts']['toolUseID'] === 'string' &&
		typeof call['opts']['requestId'] === 'string'
	);
}
