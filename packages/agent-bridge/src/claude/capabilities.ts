import { tmpdir } from 'node:os';
import {
	query as sdkQuery,
	type ModelInfo,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from '../agent-profile.js';
import { BRIDGE_DEFAULT_MODEL, BRIDGE_MODELS } from '../generated/protocol-contract.js';
import type { AgentModelInfo, ProviderCapability } from '../protocol.js';
import { isOneOf } from '../type-guards.js';
import {
	claudeAuthStatus,
	claudeVersion,
	findClaudeExecutable,
	type ClaudeAuthStatus,
} from './installation.js';
import type { QueryFunction } from './session.js';

const MODEL_PROBE_TIMEOUT_MS = 15_000;

const FALLBACK_MODEL_DETAILS: Readonly<Record<string, Omit<AgentModelInfo, 'id'>>> = {
	default: {
		label: 'Default',
		description: 'The model Claude Code recommends for your plan',
		efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
	},
	opus: {
		label: 'Opus',
		description: 'Best for complex, multi-step work',
		efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
	},
	sonnet: {
		label: 'Sonnet',
		description: 'Efficient for routine tasks',
		efforts: ['low', 'medium', 'high', 'max'],
	},
	haiku: { label: 'Haiku', description: 'Fastest for quick answers', efforts: [] },
};

export const FALLBACK_MODELS: readonly AgentModelInfo[] = BRIDGE_MODELS.map((id) => ({
	id,
	...(FALLBACK_MODEL_DETAILS[id] ?? { label: id, description: '', efforts: [] }),
}));

export interface CapabilityProbeOptions {
	readonly findExecutable?: () => string | null;
	readonly version?: (executable: string) => Promise<string>;
	readonly authStatus?: (executable: string) => Promise<ClaudeAuthStatus>;
	readonly query?: QueryFunction;
}

export async function probeClaudeCode(
	options: CapabilityProbeOptions = {},
): Promise<ProviderCapability> {
	const executable = (options.findExecutable ?? findClaudeExecutable)();
	if (!executable) {
		return {
			state: 'missing',
			installed: false,
			authenticated: null,
			version: null,
			account: null,
			models: FALLBACK_MODELS,
			defaultModel: BRIDGE_DEFAULT_MODEL,
			message: 'Claude Code is not installed',
		};
	}
	const [version, auth, models] = await Promise.all([
		(options.version ?? claudeVersion)(executable).catch(() => null),
		(options.authStatus ?? claudeAuthStatus)(executable),
		supportedModels(executable, options.query ?? sdkQuery),
	]);
	if (!auth.signedIn) {
		return {
			state: 'needs_auth',
			installed: true,
			authenticated: false,
			version,
			account: null,
			models,
			defaultModel: BRIDGE_DEFAULT_MODEL,
			message: 'Sign in to Claude Code to start',
		};
	}
	return {
		state: 'ready',
		installed: true,
		authenticated: true,
		version,
		account: auth.account,
		models,
		defaultModel: BRIDGE_DEFAULT_MODEL,
		message: auth.account.email ? `Signed in as ${auth.account.email}` : 'Signed in',
	};
}

export function unknownCapability(message: string): ProviderCapability {
	return {
		state: 'unknown',
		installed: true,
		authenticated: null,
		version: null,
		account: null,
		models: FALLBACK_MODELS,
		defaultModel: BRIDGE_DEFAULT_MODEL,
		message,
	};
}

async function supportedModels(
	executable: string,
	query: QueryFunction,
): Promise<readonly AgentModelInfo[]> {
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	const probe = query({
		prompt: idle(released),
		options: {
			cwd: tmpdir(),
			pathToClaudeCodeExecutable: executable,
			settingSources: ['user'],
			settings: { disableAllHooks: true },
			mcpServers: {},
			strictMcpConfig: true,
			persistSession: false,
		},
	});
	const timeout = new Promise<null>((resolve) =>
		setTimeout(() => resolve(null), MODEL_PROBE_TIMEOUT_MS).unref(),
	);
	try {
		const init = await Promise.race([probe.initializationResult(), timeout]);
		const models = init?.models.map(modelInfo) ?? [];
		return models.length > 0 ? withDefaultModel(models) : FALLBACK_MODELS;
	} catch {
		return FALLBACK_MODELS;
	} finally {
		release();
		probe.close();
	}
}

function withDefaultModel(models: AgentModelInfo[]): AgentModelInfo[] {
	if (models.some((model) => model.id === BRIDGE_DEFAULT_MODEL)) return models;
	const fallback = FALLBACK_MODELS.find((model) => model.id === BRIDGE_DEFAULT_MODEL);
	return fallback ? [fallback, ...models] : models;
}

function modelInfo(model: ModelInfo): AgentModelInfo {
	const efforts: AgentReasoningEffort[] = (model.supportedEffortLevels ?? []).filter(
		(effort): effort is AgentReasoningEffort => isOneOf(AGENT_REASONING_EFFORTS, effort),
	);
	return {
		id: model.value,
		label: model.value === 'default' ? 'Default' : model.displayName,
		description: model.description,
		efforts: model.supportsEffort === false ? [] : efforts,
	};
}

async function* idle(released: Promise<void>): AsyncIterable<SDKUserMessage> {
	await released;
}
