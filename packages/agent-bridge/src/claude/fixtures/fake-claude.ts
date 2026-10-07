import { readFileSync } from 'node:fs';
import type {
	ModelInfo,
	Options,
	PermissionMode,
	PermissionResult,
	PermissionUpdate,
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

export type ScriptStep = SDKMessage | CanUseToolStep | 'wait-for-interrupt';

export type RecordedScenario =
	'readAndBash' | 'write' | 'ask' | 'plan' | 'bashFailure' | 'deny' | 'orphanedTask';

export interface FakeRun {
	readonly options: Options;
	readonly prompt: Promise<string>;
	readonly permissionResults: (PermissionResult | null)[];
	readonly permissionModes: PermissionMode[];
	interrupted: boolean;
	closed: boolean;
}

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
		account: {},
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
		const sent = firstMessage(prompt);
		const run: FakeRun = {
			options,
			prompt: promptText(sent),
			permissionResults: [],
			permissionModes: [],
			interrupted: false,
			closed: false,
		};
		runs.push(run);
		return {
			async *[Symbol.asyncIterator]() {
				for (const step of script) {
					if (step === 'wait-for-interrupt') {
						await interrupted;
						continue;
					}
					if ('canUseTool' in step) {
						run.permissionResults.push(await askPermission(options, step));
						continue;
					}
					yield step.type === 'result' ? echoPrompt(step, (await sent)?.uuid) : step;
				}
			},
			async interrupt() {
				run.interrupted = true;
				release();
				return undefined;
			},
			async setPermissionMode(mode) {
				run.permissionModes.push(mode);
			},
			async mcpServerStatus() {
				return [];
			},
			async getContextUsage() {
				return { rawMaxTokens: 200_000 };
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

async function firstMessage(
	prompt: AsyncIterable<SDKUserMessage>,
): Promise<SDKUserMessage | undefined> {
	for await (const message of prompt) return message;
	return undefined;
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
	return step !== 'wait-for-interrupt' && !('canUseTool' in step);
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
