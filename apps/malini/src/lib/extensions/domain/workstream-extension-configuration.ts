export const WORKSTREAM_EXTENSION_CONFIGURATION_PATH = '.malini/workspace.json' as const;
export const WORKSTREAM_EXTENSION_CONFIGURATION_SCHEMA_VERSION = 1 as const;

const EXTENSION_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const CONTRIBUTION_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const AUTOMATION_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export type WorkstreamExtensionSettingValue = string | number | boolean;

export type WorkstreamExtensionJsonValue =
	| string
	| number
	| boolean
	| null
	| readonly WorkstreamExtensionJsonValue[]
	| { readonly [key: string]: WorkstreamExtensionJsonValue };

export type WorkstreamExtensionWorkflowRun = Readonly<{
	workflow: string;
	input: Readonly<Record<string, WorkstreamExtensionJsonValue>>;
}>;

export type WorkstreamExtensionCommandRun = Readonly<{
	command: string;
	args: readonly WorkstreamExtensionJsonValue[];
}>;

export type WorkstreamExtensionAutomationRun =
	WorkstreamExtensionWorkflowRun | WorkstreamExtensionCommandRun;

export type WorkstreamExtensionAutomationRule = Readonly<{
	id: string;
	enabled: boolean;
	when: string;
	run: WorkstreamExtensionAutomationRun;
}>;

export type WorkstreamExtensionConfigurationEntry = Readonly<{
	enabled: boolean;
	settings: Readonly<Record<string, WorkstreamExtensionSettingValue>>;
	automations: readonly WorkstreamExtensionAutomationRule[];
}>;

export type WorkstreamExtensionConfiguration = Readonly<{
	schemaVersion: typeof WORKSTREAM_EXTENSION_CONFIGURATION_SCHEMA_VERSION;
	applications?: readonly WorkstreamExtensionJsonValue[];
	names?: Readonly<Record<string, WorkstreamExtensionJsonValue>>;
	extensions: Readonly<Record<string, WorkstreamExtensionConfigurationEntry>>;
}>;

export type LoadedWorkstreamExtensionConfiguration = Readonly<{
	source: 'missing' | 'repository';
	path: typeof WORKSTREAM_EXTENSION_CONFIGURATION_PATH;
	configuration: WorkstreamExtensionConfiguration;
}>;

const EMPTY_SETTINGS: Readonly<Record<string, WorkstreamExtensionSettingValue>> = Object.freeze({});
const EMPTY_AUTOMATIONS: readonly WorkstreamExtensionAutomationRule[] = Object.freeze([]);
const EMPTY_EXTENSIONS: Readonly<Record<string, WorkstreamExtensionConfigurationEntry>> =
	Object.freeze({});
const EMPTY_JSON_RECORD: Readonly<Record<string, WorkstreamExtensionJsonValue>> = Object.freeze({});

export const EMPTY_WORKSTREAM_EXTENSION_CONFIGURATION: WorkstreamExtensionConfiguration =
	Object.freeze({
		schemaVersion: WORKSTREAM_EXTENSION_CONFIGURATION_SCHEMA_VERSION,
		extensions: EMPTY_EXTENSIONS,
	});

export class WorkstreamExtensionConfigurationError extends Error {
	constructor(message: string) {
		super(`Invalid ${WORKSTREAM_EXTENSION_CONFIGURATION_PATH}: ${message}`);
		this.name = 'WorkstreamExtensionConfigurationError';
	}
}

export function parseWorkstreamExtensionConfiguration(
	contents: string,
): WorkstreamExtensionConfiguration {
	let input: unknown;
	try {
		input = JSON.parse(contents);
	} catch (error) {
		throw configurationError(errorMessage(error));
	}
	if (!isRecord(input)) throw configurationError('must contain a JSON object');
	assertKeys(input, ['schemaVersion', 'applications', 'names', 'extensions'], '$');
	assertRequired(input, 'schemaVersion', '$');
	assertRequired(input, 'extensions', '$');
	if (input.schemaVersion !== WORKSTREAM_EXTENSION_CONFIGURATION_SCHEMA_VERSION) {
		throw configurationError(
			`schemaVersion must equal ${WORKSTREAM_EXTENSION_CONFIGURATION_SCHEMA_VERSION}`,
		);
	}
	if (!isRecord(input.extensions)) {
		throw configurationError('$.extensions must be an object keyed by extension id');
	}

	const extensions = Object.freeze(
		Object.fromEntries(
			Object.entries(input.extensions).map(([extensionId, value]) => {
				if (!EXTENSION_ID.test(extensionId)) {
					throw configurationError(
						`$.extensions key ${JSON.stringify(extensionId)} must be a namespaced lowercase extension id`,
					);
				}
				return [extensionId, parseExtensionEntry(extensionId, value)] as const;
			}),
		),
	);
	return Object.freeze({
		schemaVersion: WORKSTREAM_EXTENSION_CONFIGURATION_SCHEMA_VERSION,
		...parseAuthoredIntentSections(input),
		extensions,
	});
}

function parseAuthoredIntentSections(input: Record<string, unknown>): Readonly<
	Partial<{
		applications: readonly WorkstreamExtensionJsonValue[];
		names: Readonly<Record<string, WorkstreamExtensionJsonValue>>;
	}>
> {
	const sections: {
		applications?: readonly WorkstreamExtensionJsonValue[];
		names?: Readonly<Record<string, WorkstreamExtensionJsonValue>>;
	} = {};
	if (input.applications !== undefined) {
		if (!Array.isArray(input.applications)) {
			throw configurationError('$.applications must be an array');
		}
		sections.applications = Object.freeze(
			input.applications.map((entry, index) => {
				const parsed = parseJsonValue(entry, `$.applications[${index}]`);
				if (!isRecord(parsed)) {
					throw configurationError(`$.applications[${index}] must be an object`);
				}
				return parsed;
			}),
		);
	}
	if (input.names !== undefined) {
		if (!isRecord(input.names)) throw configurationError('$.names must be an object keyed by id');
		sections.names = parseJsonRecord(input.names, '$.names');
	}
	return Object.freeze(sections);
}

export function isWorkstreamExtensionEnabled(
	configuration: WorkstreamExtensionConfiguration,
	extensionId: string,
): boolean {
	return configuration.extensions[extensionId]?.enabled === true;
}

export function setWorkstreamExtensionEnabled(
	configuration: WorkstreamExtensionConfiguration,
	extensionId: string,
	enabled: boolean,
): WorkstreamExtensionConfiguration {
	const existing = configuration.extensions[extensionId];
	if (existing?.enabled === enabled) return configuration;
	return parseWorkstreamExtensionConfiguration(
		JSON.stringify({
			...configuration,
			extensions: {
				...configuration.extensions,
				[extensionId]: {
					enabled,
					settings: existing?.settings ?? {},
					automations: existing?.automations ?? [],
				},
			},
		}),
	);
}

function parseExtensionEntry(
	extensionId: string,
	input: unknown,
): WorkstreamExtensionConfigurationEntry {
	const path = `$.extensions[${JSON.stringify(extensionId)}]`;
	if (!isRecord(input)) throw configurationError(`${path} must be an object`);
	assertKeys(input, ['enabled', 'settings', 'automations'], path);
	assertRequired(input, 'enabled', path);
	if (typeof input.enabled !== 'boolean') {
		throw configurationError(`${path}.enabled must be a boolean`);
	}
	const settings =
		input.settings === undefined
			? EMPTY_SETTINGS
			: parseSettings(extensionId, input.settings, `${path}.settings`);
	const automations =
		input.automations === undefined
			? EMPTY_AUTOMATIONS
			: parseAutomations(extensionId, input.automations, `${path}.automations`);
	return Object.freeze({ enabled: input.enabled, settings, automations });
}

function parseSettings(
	extensionId: string,
	input: unknown,
	path: string,
): Readonly<Record<string, WorkstreamExtensionSettingValue>> {
	if (!isRecord(input)) throw configurationError(`${path} must be an object`);
	return Object.freeze(
		Object.fromEntries(
			Object.entries(input).map(([settingId, value]) => {
				if (!CONTRIBUTION_ID.test(settingId) || !settingId.startsWith(`${extensionId}.`)) {
					throw configurationError(
						`${path} key ${JSON.stringify(settingId)} must be a contribution id owned by ${extensionId}`,
					);
				}
				if (
					(typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') ||
					(typeof value === 'number' && !Number.isFinite(value))
				) {
					throw configurationError(
						`${path}[${JSON.stringify(settingId)}] must be a string, finite number, or boolean`,
					);
				}
				return [settingId, value] as const;
			}),
		),
	);
}

function parseAutomations(
	extensionId: string,
	input: unknown,
	path: string,
): readonly WorkstreamExtensionAutomationRule[] {
	if (!Array.isArray(input)) throw configurationError(`${path} must be an array`);
	const rules = input.map((value, index) =>
		parseAutomationRule(extensionId, value, `${path}[${index}]`),
	);
	const seen = new Set<string>();
	for (const rule of rules) {
		if (seen.has(rule.id)) {
			throw configurationError(`${path} contains duplicate automation id ${rule.id}`);
		}
		seen.add(rule.id);
	}
	return Object.freeze(rules);
}

function parseAutomationRule(
	extensionId: string,
	input: unknown,
	path: string,
): WorkstreamExtensionAutomationRule {
	if (!isRecord(input)) throw configurationError(`${path} must be an object`);
	assertKeys(input, ['id', 'enabled', 'when', 'run'], path);
	for (const key of ['id', 'when', 'run'] as const) assertRequired(input, key, path);
	const id = nonEmptyString(input.id, `${path}.id`);
	if (!AUTOMATION_ID.test(id)) {
		throw configurationError(`${path}.id must be a lowercase automation id`);
	}
	if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
		throw configurationError(`${path}.enabled must be a boolean`);
	}
	const when = nonEmptyString(input.when, `${path}.when`).trim();
	return Object.freeze({
		id,
		enabled: input.enabled ?? true,
		when,
		run: parseAutomationRun(extensionId, input.run, `${path}.run`),
	});
}

function parseAutomationRun(
	extensionId: string,
	input: unknown,
	path: string,
): WorkstreamExtensionAutomationRun {
	if (!isRecord(input)) throw configurationError(`${path} must be an object`);
	const hasWorkflow = owns(input, 'workflow');
	const hasCommand = owns(input, 'command');
	if (hasWorkflow === hasCommand) {
		throw configurationError(`${path} must select exactly one of workflow or command`);
	}
	if (hasWorkflow) {
		assertKeys(input, ['workflow', 'input'], path);
		const workflow = contributionId(input.workflow, `${path}.workflow`, extensionId);
		const workflowInput =
			input.input === undefined ? EMPTY_JSON_RECORD : parseJsonRecord(input.input, `${path}.input`);
		return Object.freeze({ workflow, input: workflowInput });
	}

	assertKeys(input, ['command', 'args'], path);
	const command = contributionId(input.command, `${path}.command`, extensionId);
	if (input.args !== undefined && !Array.isArray(input.args)) {
		throw configurationError(`${path}.args must be an array`);
	}
	const args = Object.freeze(
		(input.args ?? []).map((value, index) => parseJsonValue(value, `${path}.args[${index}]`)),
	);
	return Object.freeze({ command, args });
}

function contributionId(input: unknown, path: string, extensionId: string): string {
	const value = nonEmptyString(input, path);
	if (!CONTRIBUTION_ID.test(value) || !value.startsWith(`${extensionId}.`)) {
		throw configurationError(`${path} must be a contribution id owned by ${extensionId}`);
	}
	return value;
}

function parseJsonRecord(
	input: unknown,
	path: string,
): Readonly<Record<string, WorkstreamExtensionJsonValue>> {
	if (!isRecord(input)) throw configurationError(`${path} must be a JSON object`);
	return Object.freeze(
		Object.fromEntries(
			Object.entries(input).map(([key, value]) => [key, parseJsonValue(value, `${path}.${key}`)]),
		),
	);
}

function parseJsonValue(input: unknown, path: string): WorkstreamExtensionJsonValue {
	if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
	if (typeof input === 'number') {
		if (!Number.isFinite(input)) throw configurationError(`${path} must be a finite number`);
		return input;
	}
	if (Array.isArray(input)) {
		return Object.freeze(input.map((value, index) => parseJsonValue(value, `${path}[${index}]`)));
	}
	if (isRecord(input)) {
		return Object.freeze(
			Object.fromEntries(
				Object.entries(input).map(([key, value]) => [key, parseJsonValue(value, `${path}.${key}`)]),
			),
		);
	}
	throw configurationError(`${path} must contain only JSON values`);
}

function nonEmptyString(input: unknown, path: string): string {
	if (typeof input !== 'string' || input.trim().length === 0) {
		throw configurationError(`${path} must be a non-empty string`);
	}
	return input;
}

function assertKeys(
	input: Record<string, unknown>,
	allowed: readonly string[],
	path: string,
): void {
	const valid = new Set(allowed);
	for (const key of Object.keys(input)) {
		if (!valid.has(key)) {
			throw configurationError(
				`${path}.${key} is not supported by workstream configuration v${WORKSTREAM_EXTENSION_CONFIGURATION_SCHEMA_VERSION}`,
			);
		}
	}
}

function assertRequired(input: Record<string, unknown>, key: string, path: string): void {
	if (!owns(input, key)) throw configurationError(`${path}.${key} is required`);
}

function owns(input: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(input, key);
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function configurationError(message: string): WorkstreamExtensionConfigurationError {
	return new WorkstreamExtensionConfigurationError(message);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
