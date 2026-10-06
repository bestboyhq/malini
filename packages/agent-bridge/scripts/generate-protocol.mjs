import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const bridgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(bridgeRoot, '../..');
const contractPath = resolve(bridgeRoot, 'protocol/bridge-protocol.json');
const tsOutputPath = resolve(bridgeRoot, 'src/generated/protocol-contract.ts');
const appTsOutputPath = resolve(
	repoRoot,
	'apps/malini/src/contract/protocol-contract.generated.ts',
);

/**
 * @typedef {object} ProtocolContract
 * @property {string} contractName
 * @property {number} protocolVersion
 * @property {number} readyTimeoutMs
 * @property {number} heartbeatIntervalMs
 * @property {number} heartbeatTimeoutMs
 * @property {number} commandAckTimeoutMs
 * @property {number} maxFrameBytes
 * @property {number} maxDiagnosticBytes
 * @property {string} agentAttachmentsPath
 * @property {string} sandboxScratchPath
 * @property {string} defaultModel
 * @property {string[]} models
 * @property {string[]} commands
 * @property {string[]} events
 * @property {string[]} controls
 */

/** @type {ProtocolContract} */
const contract = JSON.parse(await readFile(contractPath, 'utf8'));

for (const key of [
	'contractName',
	'protocolVersion',
	'readyTimeoutMs',
	'heartbeatIntervalMs',
	'heartbeatTimeoutMs',
	'commandAckTimeoutMs',
	'maxFrameBytes',
	'maxDiagnosticBytes',
	'agentAttachmentsPath',
	'sandboxScratchPath',
	'defaultModel',
	'models',
	'commands',
	'events',
	'controls',
]) {
	if (!(key in contract)) throw new Error(`bridge protocol contract is missing ${key}`);
}

for (const key of /** @type {const} */ ([
	'protocolVersion',
	'readyTimeoutMs',
	'heartbeatIntervalMs',
	'heartbeatTimeoutMs',
	'commandAckTimeoutMs',
	'maxFrameBytes',
	'maxDiagnosticBytes',
])) {
	if (!Number.isSafeInteger(contract[key]) || contract[key] <= 0) {
		throw new Error(`bridge protocol ${key} must be a positive safe integer`);
	}
}

for (const key of /** @type {const} */ (['agentAttachmentsPath', 'sandboxScratchPath'])) {
	const path = contract[key];
	if (
		typeof path !== 'string' ||
		path.startsWith('/') ||
		path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
	) {
		throw new Error(`bridge protocol ${key} must be a relative POSIX path inside the checkout`);
	}
}

for (const key of /** @type {const} */ (['commands', 'events', 'controls'])) {
	const values = contract[key];
	if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
		throw new Error(`bridge protocol ${key} must be an array of strings`);
	}
	if (new Set(values).size !== values.length) {
		throw new Error(`bridge protocol ${key} contains duplicates`);
	}
}

if (
	!Array.isArray(contract.models) ||
	contract.models.length === 0 ||
	contract.models.some((model) => typeof model !== 'string' || !model)
) {
	throw new Error('bridge protocol models must be a non-empty array of model ids');
}
if (new Set(contract.models).size !== contract.models.length) {
	throw new Error('bridge protocol models contains duplicates');
}
if (typeof contract.defaultModel !== 'string' || !contract.models.includes(contract.defaultModel)) {
	throw new Error('bridge protocol defaultModel is not in models');
}

/**
 * @param {unknown} values
 * @returns {string}
 */
const tsArray = (values) => JSON.stringify(values, null, '\t').replaceAll('\n', '\n');
const unformattedTs =
	`// Generated from packages/agent-bridge/protocol/bridge-protocol.json. Do not edit.\n\n` +
	`export const BRIDGE_CONTRACT_NAME = ${JSON.stringify(contract.contractName)} as const;\n` +
	`export const BRIDGE_PROTOCOL_VERSION = ${contract.protocolVersion} as const;\n` +
	`export const BRIDGE_READY_TIMEOUT_MS = ${contract.readyTimeoutMs} as const;\n` +
	`export const BRIDGE_HEARTBEAT_INTERVAL_MS = ${contract.heartbeatIntervalMs} as const;\n` +
	`export const BRIDGE_HEARTBEAT_TIMEOUT_MS = ${contract.heartbeatTimeoutMs} as const;\n` +
	`export const BRIDGE_COMMAND_ACK_TIMEOUT_MS = ${contract.commandAckTimeoutMs} as const;\n` +
	`export const BRIDGE_MAX_FRAME_BYTES = ${contract.maxFrameBytes} as const;\n` +
	`export const BRIDGE_MAX_DIAGNOSTIC_BYTES = ${contract.maxDiagnosticBytes} as const;\n` +
	`export const BRIDGE_AGENT_ATTACHMENTS_PATH = ${JSON.stringify(contract.agentAttachmentsPath)} as const;\n` +
	`export const BRIDGE_SANDBOX_SCRATCH_PATH = ${JSON.stringify(contract.sandboxScratchPath)} as const;\n` +
	`export const BRIDGE_MODELS = ${tsArray(contract.models)} as const;\n` +
	`export const BRIDGE_DEFAULT_MODEL = ${JSON.stringify(contract.defaultModel)} as const;\n` +
	`export const BRIDGE_COMMAND_NAMES = ${tsArray(contract.commands)} as const;\n` +
	`export const BRIDGE_EVENT_TYPES = ${tsArray(contract.events)} as const;\n` +
	`export const BRIDGE_CONTROL_TYPES = ${tsArray(contract.controls)} as const;\n`;
const prettierConfig = (await resolveConfig(appTsOutputPath)) ?? {};
const ts = await format(unformattedTs, { ...prettierConfig, parser: 'typescript' });

/**
 * @param {string} path
 * @param {string} content
 * @returns {Promise<void>}
 */
async function update(path, content) {
	const existing = await readFile(path, 'utf8').catch(() => '');
	if (existing === content) return;
	if (process.argv.includes('--check')) throw new Error(`${path} is stale; run pnpm build`);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, 'utf8');
}

await Promise.all([update(tsOutputPath, ts), update(appTsOutputPath, ts)]);
