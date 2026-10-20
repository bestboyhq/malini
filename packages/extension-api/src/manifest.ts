export const EXTENSION_API_VERSION = 1 as const;
export const EXTENSION_MANIFEST_VERSION = 1 as const;

export type ExtensionActivationEvent =
	'onStartup' | 'onWorkstream' | `onCommand:${string}` | `onEvent:${string}`;

export type ExtensionPanelManifest = {
	id: string;
	label: string;
	icon: string;
	order?: number;
	defaultVisible?: boolean;
	minWidth?: number;
	instances?: boolean;
};

export const EXTENSION_PANEL_INSTANCE_SEPARATOR = ':';

export function extensionPanelInstanceId(templateId: string, instanceKey: string): string {
	return `${templateId}${EXTENSION_PANEL_INSTANCE_SEPARATOR}${instanceKey}`;
}

export function extensionPanelInstanceParts(
	panelId: string,
): { templateId: string; instanceKey: string } | null {
	const separator = panelId.indexOf(EXTENSION_PANEL_INSTANCE_SEPARATOR);
	if (separator <= 0 || separator === panelId.length - 1) return null;
	return {
		templateId: panelId.slice(0, separator),
		instanceKey: panelId.slice(separator + 1),
	};
}

export type ExtensionCommandManifest = {
	id: string;
	title: string;
	description?: string;
};

export type ExtensionSettingManifest = {
	id: string;
	label: string;
	type: 'string' | 'number' | 'boolean' | 'select';
	default: string | number | boolean;
	description?: string;
	options?: readonly { label: string; value: string }[];
	scope?: 'global' | 'repository' | 'workstream';
};

export type ExtensionWorkflowManifest = {
	id: string;
	label: string;
	description?: string;
};

export type ExtensionManifest = {
	schemaVersion: typeof EXTENSION_MANIFEST_VERSION;
	id: string;
	name: string;
	version: string;
	apiVersion: typeof EXTENSION_API_VERSION;
	description: string;
	publisher: string;
	entrypoint: string;
	activationEvents: readonly ExtensionActivationEvent[];
	contributes?: {
		panels?: readonly ExtensionPanelManifest[];
		commands?: readonly ExtensionCommandManifest[];
		settings?: readonly ExtensionSettingManifest[];
		workflows?: readonly ExtensionWorkflowManifest[];
	};
};

export type ManifestValidationIssue = {
	path: string;
	message: string;
};

export type ManifestValidationResult =
	| { valid: true; manifest: ExtensionManifest; issues: readonly [] }
	| { valid: false; issues: readonly ManifestValidationIssue[] };

const EXTENSION_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const CONTRIBUTION_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export function validateExtensionManifest(input: unknown): ManifestValidationResult {
	const issues: ManifestValidationIssue[] = [];
	if (!isRecord(input)) {
		return { valid: false, issues: [{ path: '$', message: 'manifest must be an object' }] };
	}
	rejectUnknownKeys(
		input,
		[
			'schemaVersion',
			'id',
			'name',
			'version',
			'apiVersion',
			'description',
			'publisher',
			'entrypoint',
			'activationEvents',
			'contributes',
		],
		'$',
		issues,
	);

	requireExactNumber(input, 'schemaVersion', EXTENSION_MANIFEST_VERSION, issues);
	requireString(
		input,
		'id',
		issues,
		(value) => EXTENSION_ID.test(value),
		'must be a namespaced lowercase id',
	);
	requireString(input, 'name', issues);
	requireString(
		input,
		'version',
		issues,
		(value) => SEMVER.test(value),
		'must be semantic version',
	);
	requireExactNumber(input, 'apiVersion', EXTENSION_API_VERSION, issues);
	requireString(input, 'description', issues);
	requireString(input, 'publisher', issues);
	requireString(
		input,
		'entrypoint',
		issues,
		(value) => isSafeRelativePath(value),
		'must be a relative path inside the extension package',
	);

	if (!Array.isArray(input.activationEvents) || input.activationEvents.length === 0) {
		issues.push({
			path: '$.activationEvents',
			message: 'must contain at least one activation event',
		});
	} else {
		const activationEvents = new Set<string>();
		for (const [index, value] of input.activationEvents.entries()) {
			if (typeof value !== 'string' || !isActivationEvent(value)) {
				issues.push({
					path: `$.activationEvents[${index}]`,
					message: 'is not a supported activation event',
				});
			} else if (activationEvents.has(value)) {
				issues.push({
					path: `$.activationEvents[${index}]`,
					message: `duplicate activation event ${value}`,
				});
			} else {
				activationEvents.add(value);
			}
		}
	}

	const contributionIds = new Set<string>();
	if (input.contributes !== undefined) {
		if (!isRecord(input.contributes)) {
			issues.push({ path: '$.contributes', message: 'must be an object' });
		} else {
			rejectUnknownKeys(
				input.contributes,
				['panels', 'commands', 'settings', 'workflows'],
				'$.contributes',
				issues,
			);
			validatePanels(input.contributes.panels, contributionIds, issues);
			validateCommands(input.contributes.commands, contributionIds, issues);
			validateSettings(input.contributes.settings, contributionIds, issues);
			validateWorkflows(input.contributes.workflows, contributionIds, issues);
		}
	}

	if (issues.length > 0 || !isExtensionManifest(input)) {
		return { valid: false, issues };
	}
	return { valid: true, manifest: input, issues: [] };
}

function isExtensionManifest(input: Record<string, unknown>): input is ExtensionManifest {
	return (
		input.schemaVersion === EXTENSION_MANIFEST_VERSION &&
		input.apiVersion === EXTENSION_API_VERSION &&
		typeof input.id === 'string' &&
		typeof input.name === 'string' &&
		typeof input.version === 'string' &&
		typeof input.description === 'string' &&
		typeof input.publisher === 'string' &&
		typeof input.entrypoint === 'string' &&
		Array.isArray(input.activationEvents)
	);
}

export function assertExtensionManifest(input: unknown): ExtensionManifest {
	const result = validateExtensionManifest(input);
	if (result.valid) return result.manifest;
	throw new Error(
		`Invalid extension manifest:\n${result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n')}`,
	);
}

function validatePanels(value: unknown, ids: Set<string>, issues: ManifestValidationIssue[]): void {
	validateContributionArray(value, 'panels', ids, issues, (entry, path) => {
		rejectUnknownKeys(
			entry,
			['id', 'label', 'icon', 'order', 'defaultVisible', 'minWidth', 'instances'],
			path,
			issues,
		);
		requireString(entry, 'label', issues, undefined, undefined, path);
		requireString(entry, 'icon', issues, undefined, undefined, path);
		if (entry.order !== undefined && !Number.isFinite(entry.order)) {
			issues.push({ path: `${path}.order`, message: 'must be a finite number' });
		}
		if (entry.defaultVisible !== undefined && typeof entry.defaultVisible !== 'boolean') {
			issues.push({ path: `${path}.defaultVisible`, message: 'must be a boolean' });
		}
		if (
			entry.minWidth !== undefined &&
			(!Number.isInteger(entry.minWidth) || Number(entry.minWidth) <= 0)
		) {
			issues.push({ path: `${path}.minWidth`, message: 'must be a positive whole number' });
		}
		if (entry.instances !== undefined && typeof entry.instances !== 'boolean') {
			issues.push({ path: `${path}.instances`, message: 'must be a boolean' });
		}
		if (entry.instances === true && String(entry.id).includes(EXTENSION_PANEL_INSTANCE_SEPARATOR)) {
			issues.push({
				path: `${path}.id`,
				message: `must not contain '${EXTENSION_PANEL_INSTANCE_SEPARATOR}' when instances is true`,
			});
		}
	});
}

function validateCommands(
	value: unknown,
	ids: Set<string>,
	issues: ManifestValidationIssue[],
): void {
	validateContributionArray(value, 'commands', ids, issues, (entry, path) => {
		rejectUnknownKeys(entry, ['id', 'title', 'description'], path, issues);
		requireString(entry, 'title', issues, undefined, undefined, path);
		optionalString(entry, 'description', issues, path);
	});
}

function validateSettings(
	value: unknown,
	ids: Set<string>,
	issues: ManifestValidationIssue[],
): void {
	validateContributionArray(value, 'settings', ids, issues, (entry, path) => {
		rejectUnknownKeys(
			entry,
			['id', 'label', 'type', 'default', 'description', 'options', 'scope'],
			path,
			issues,
		);
		requireString(entry, 'label', issues, undefined, undefined, path);
		if (!['string', 'number', 'boolean', 'select'].includes(String(entry.type))) {
			issues.push({ path: `${path}.type`, message: 'must be string, number, boolean, or select' });
		}
		if (!['string', 'number', 'boolean'].includes(typeof entry.default)) {
			issues.push({ path: `${path}.default`, message: 'must be a string, number, or boolean' });
		}
		if (
			['string', 'number', 'boolean'].includes(String(entry.type)) &&
			typeof entry.default !== entry.type
		) {
			issues.push({
				path: `${path}.default`,
				message: `must match setting type ${String(entry.type)}`,
			});
		}
		optionalString(entry, 'description', issues, path);
		if (
			entry.scope !== undefined &&
			!['global', 'repository', 'workstream'].includes(String(entry.scope))
		) {
			issues.push({ path: `${path}.scope`, message: 'must be global, repository, or workstream' });
		}
		if (entry.type === 'select' && (!Array.isArray(entry.options) || entry.options.length === 0)) {
			issues.push({ path: `${path}.options`, message: 'select settings require options' });
		} else if (entry.type === 'select' && Array.isArray(entry.options)) {
			const values = new Set<string>();
			for (const [index, option] of entry.options.entries()) {
				if (
					!isRecord(option) ||
					typeof option.label !== 'string' ||
					typeof option.value !== 'string'
				) {
					issues.push({
						path: `${path}.options[${index}]`,
						message: 'must contain string label and value',
					});
					continue;
				}
				rejectUnknownKeys(option, ['label', 'value'], `${path}.options[${index}]`, issues);
				if (values.has(option.value)) {
					issues.push({
						path: `${path}.options[${index}].value`,
						message: `duplicate option ${option.value}`,
					});
				}
				values.add(option.value);
			}
			if (typeof entry.default === 'string' && !values.has(entry.default)) {
				issues.push({ path: `${path}.default`, message: 'must match a select option value' });
			}
		}
	});
}

function validateWorkflows(
	value: unknown,
	ids: Set<string>,
	issues: ManifestValidationIssue[],
): void {
	validateContributionArray(value, 'workflows', ids, issues, (entry, path) => {
		rejectUnknownKeys(entry, ['id', 'label', 'description'], path, issues);
		requireString(entry, 'label', issues, undefined, undefined, path);
		optionalString(entry, 'description', issues, path);
	});
}

function validateContributionArray(
	value: unknown,
	name: string,
	ids: Set<string>,
	issues: ManifestValidationIssue[],
	validate: (entry: Record<string, unknown>, path: string) => void,
): void {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		issues.push({ path: `$.contributes.${name}`, message: 'must be an array' });
		return;
	}
	for (const [index, entry] of value.entries()) {
		const path = `$.contributes.${name}[${index}]`;
		if (!isRecord(entry)) {
			issues.push({ path, message: 'must be an object' });
			continue;
		}
		requireString(
			entry,
			'id',
			issues,
			(candidate) => CONTRIBUTION_ID.test(candidate),
			'must be a lowercase contribution id',
			path,
		);
		if (typeof entry.id === 'string') {
			if (ids.has(entry.id))
				issues.push({ path: `${path}.id`, message: `duplicate contribution id ${entry.id}` });
			ids.add(entry.id);
		}
		validate(entry, path);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
	record: Record<string, unknown>,
	allowed: readonly string[],
	path: string,
	issues: ManifestValidationIssue[],
): void {
	const allowedKeys = new Set(allowed);
	for (const key of Object.keys(record)) {
		if (!allowedKeys.has(key))
			issues.push({ path: `${path}.${key}`, message: 'is not supported by manifest v1' });
	}
}

function requireString(
	record: Record<string, unknown>,
	key: string,
	issues: ManifestValidationIssue[],
	validate?: (value: string) => boolean,
	validationMessage?: string,
	parent = '$',
): void {
	const value = record[key];
	if (typeof value !== 'string' || value.trim() === '') {
		issues.push({ path: `${parent}.${key}`, message: 'must be a non-empty string' });
		return;
	}
	if (validate && !validate(value)) {
		issues.push({ path: `${parent}.${key}`, message: validationMessage ?? 'is invalid' });
	}
}

function optionalString(
	record: Record<string, unknown>,
	key: string,
	issues: ManifestValidationIssue[],
	parent: string,
): void {
	if (record[key] !== undefined && typeof record[key] !== 'string') {
		issues.push({ path: `${parent}.${key}`, message: 'must be a string' });
	}
}

function requireExactNumber(
	record: Record<string, unknown>,
	key: string,
	expected: number,
	issues: ManifestValidationIssue[],
): void {
	if (record[key] !== expected) {
		issues.push({ path: `$.${key}`, message: `must equal ${expected}` });
	}
}

function isSafeRelativePath(value: string): boolean {
	return !value.startsWith('/') && !value.startsWith('\\') && !value.split(/[\\/]/u).includes('..');
}

function isActivationEvent(value: string): value is ExtensionActivationEvent {
	return (
		value === 'onStartup' ||
		value === 'onWorkstream' ||
		(value.startsWith('onCommand:') && value.length > 'onCommand:'.length) ||
		(value.startsWith('onEvent:') && value.length > 'onEvent:'.length)
	);
}
