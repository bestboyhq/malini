import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, posix } from 'node:path';
import { errorCode } from '$main/errors';
import type { MaliniDatabase } from '$main/db/driver';
import { listPermissionRules } from './permissions.repository';

import { isAtOrInsideDirectory } from '$main/fs/paths';
import { isDirectory } from '$main/fs/stat';
import {
	isAgentApprovalScope,
	type AgentApprovalDecision,
	type AgentApprovalDecisionResult,
	type AgentApprovalScope,
} from '$contract/agent';

export type { AgentApprovalDecision, AgentApprovalDecisionResult, AgentApprovalScope };

const MAX_PERMISSION_JSON_BYTES = 64 * 1024;
const MAX_PERMISSION_RESOURCES = 32;
const MAX_PERMISSION_PATH_BYTES = 4096;

export interface NormalizedPermission {
	readonly fingerprint: string;
	readonly canonicalJson: string;
}

interface PermissionResourceWire {
	kind: string;
	value: string;
	canonicalValue?: string;
	boundary: string;
	readOnly?: boolean;
}

interface PermissionWire {
	capability: string;
	resources: PermissionResourceWire[];
}

export const MALINI_TOOL_PREFIX = 'mcp__malini__';

const MALINI_ACTION =
	/^(?:pull-requests\.open-draft|jobs\.save|routines\.save|jobs\.run:[^\s:]{1,256})$/u;

export type MaliniActionPermission = Readonly<{
	capability: 'execute';
	resources: readonly [Readonly<{ kind: 'action'; value: string; boundary: 'workstream' }>];
}>;

export function maliniActionPermission(action: string): MaliniActionPermission {
	if (!MALINI_ACTION.test(action)) throw new Error(`\`${action}\` is not a Malini action`);
	return {
		capability: 'execute',
		resources: [{ kind: 'action', value: action, boundary: 'workstream' }],
	};
}

export function maliniActionFingerprint(action: string): string {
	return finishNormalization(JSON.stringify(maliniActionPermission(action))).fingerprint;
}

export type RememberedResource = Readonly<{ kind: string; value: string }>;

export function rememberedResources(permissionJson: string): RememberedResource[] {
	const permission: unknown = JSON.parse(permissionJson);
	if (!isPlainObject(permission) || !Array.isArray(permission['resources'])) return [];
	return permission['resources'].flatMap((resource: unknown) => {
		if (!isPlainObject(resource) || typeof resource['kind'] !== 'string') return [];
		const value = resource['value'] ?? resource['canonicalValue'];
		return typeof value === 'string' ? [{ kind: resource['kind'], value }] : [];
	});
}

export function normalizeRememberablePermission(
	permission: unknown,
	workstreamPath: string,
	toolName?: string,
): NormalizedPermission {
	let encoded: string;
	try {
		encoded = JSON.stringify(permission);
	} catch (error) {
		throw new Error(`permission descriptor is not serializable: ${describe(error)}`);
	}
	if (encoded === undefined || Buffer.byteLength(encoded) > MAX_PERMISSION_JSON_BYTES) {
		throw new Error('permission descriptor exceeds the safe size limit');
	}
	const wire = parsePermissionWire(permission);
	if (wire.resources.length === 0 || wire.resources.length > MAX_PERMISSION_RESOURCES) {
		throw new Error(`remembered permissions require 1-${MAX_PERMISSION_RESOURCES} resources`);
	}
	if (toolName?.startsWith(MALINI_TOOL_PREFIX)) return normalizeMaliniAction(wire);
	if (wire.capability !== 'read') {
		throw new Error('only canonical external reads can be remembered');
	}
	return normalizeExternalReadPermission(wire.resources, workstreamPath);
}

function parsePermissionWire(permission: unknown): PermissionWire {
	const invalid = (detail: string): Error =>
		new Error(`permission descriptor is invalid: ${detail}`);
	if (!isPlainObject(permission)) throw invalid('expected an object');
	for (const key of Object.keys(permission)) {
		if (key !== 'capability' && key !== 'resources') throw invalid(`unknown field \`${key}\``);
	}
	if (typeof permission['capability'] !== 'string') throw invalid('missing field `capability`');
	const resources: PermissionResourceWire[] = [];
	const rawResources = permission['resources'];
	if (!Array.isArray(rawResources)) throw invalid('missing field `resources`');
	for (const resource of rawResources) {
		if (!isPlainObject(resource)) throw invalid('resource is not an object');
		for (const key of Object.keys(resource)) {
			if (!['kind', 'value', 'canonicalValue', 'boundary', 'readOnly'].includes(key)) {
				throw invalid(`unknown field \`${key}\``);
			}
		}
		const { kind, value, canonicalValue, boundary, readOnly } = resource;
		if (typeof kind !== 'string') throw invalid('missing field `kind`');
		if (typeof value !== 'string') throw invalid('missing field `value`');
		if (typeof boundary !== 'string') throw invalid('missing field `boundary`');
		if (
			canonicalValue !== undefined &&
			canonicalValue !== null &&
			typeof canonicalValue !== 'string'
		) {
			throw invalid('`canonicalValue` must be a string');
		}
		if (readOnly !== undefined && readOnly !== null && typeof readOnly !== 'boolean') {
			throw invalid('`readOnly` must be a boolean');
		}
		const parsed: PermissionResourceWire = { kind, value, boundary };
		if (typeof canonicalValue === 'string') parsed.canonicalValue = canonicalValue;
		if (typeof readOnly === 'boolean') parsed.readOnly = readOnly;
		resources.push(parsed);
	}
	return { capability: permission['capability'], resources };
}

function normalizeMaliniAction(wire: PermissionWire): NormalizedPermission {
	const [resource] = wire.resources;
	if (
		wire.capability !== 'execute' ||
		wire.resources.length !== 1 ||
		resource?.kind !== 'action' ||
		resource.boundary !== 'workstream' ||
		resource.canonicalValue !== undefined ||
		resource.readOnly !== undefined
	) {
		throw new Error('a Malini tool is remembered only as one Malini action');
	}
	return finishNormalization(JSON.stringify(maliniActionPermission(resource.value)));
}

function normalizeExternalReadPermission(
	resources: PermissionResourceWire[],
	workstreamPath: string,
): NormalizedPermission {
	const workstream = canonicalizeAllowMissing(workstreamPath);
	if (!isAbsolute(workstream)) throw new Error('workstream path is not absolute');
	if (!isDirectory(workstream)) {
		throw new Error('workstream path is not an existing directory');
	}
	const paths: string[] = [];
	for (const resource of resources) {
		if (resource.kind !== 'path' || resource.boundary !== 'external') {
			throw new Error('remembered permissions require only canonical external path resources');
		}
		if (!isUsablePathValue(resource.value)) {
			throw new Error('permission resource value is empty or too large');
		}
		const canonicalValue = resource.canonicalValue;
		if (canonicalValue === undefined) {
			throw new Error('external path permission has no canonicalValue');
		}
		if (!isUsablePathValue(canonicalValue)) {
			throw new Error('canonical external path is empty or too large');
		}
		const candidate = strictlyNormalizedAbsolutePath(canonicalValue);
		const hostCanonical = canonicalizeAllowMissing(candidate);
		if (hostCanonical !== candidate) {
			throw new Error(`external path \`${canonicalValue}\` is not host-canonical`);
		}
		if (isAtOrInsideDirectory(workstream, candidate)) {
			throw new Error(`path \`${canonicalValue}\` is inside the active workstream`);
		}
		if (isSensitivePath(candidate)) {
			throw new Error(
				`path \`${canonicalValue}\` is credential-sensitive and cannot be remembered`,
			);
		}
		paths.push(canonicalValue);
	}
	const unique = [...new Set(paths)].sort(compareBytewise);
	const canonicalJson = JSON.stringify({
		capability: 'read',
		resources: unique.map((path) => ({
			kind: 'path',
			canonicalValue: path,
			boundary: 'external',
		})),
	});
	return finishNormalization(canonicalJson);
}

function finishNormalization(canonicalJson: string): NormalizedPermission {
	const fingerprint = createHash('sha256').update(canonicalJson).digest('hex');
	return { fingerprint, canonicalJson };
}

function isUsablePathValue(value: string): boolean {
	return (
		value.length > 0 &&
		Buffer.byteLength(value) <= MAX_PERMISSION_PATH_BYTES &&
		!value.includes('\0')
	);
}

export function strictlyNormalizedAbsolutePath(value: string): string {
	if (!isAbsolute(value)) throw new Error(`external path \`${value}\` is not absolute`);
	for (const segment of value.split('/')) {
		if (segment === '.' || segment === '..') {
			throw new Error(`external path \`${value}\` is not normalized`);
		}
	}
	const normalized = posix.normalize(value);
	return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export function canonicalizeAllowMissing(path: string): string {
	let current = path;
	const missing: string[] = [];
	for (;;) {
		try {
			const canonical = realpathSync.native(current);
			if (missing.length > 0 && !isDirectory(canonical)) {
				throw new Error(
					`permission path \`${path}\` has a missing tail below a non-directory ancestor`,
				);
			}
			return missing.length === 0 ? canonical : posix.join(canonical, ...missing.reverse());
		} catch (error) {
			const code = errorCode(error);
			if (code !== 'ENOENT' && code !== 'ENOTDIR') {
				if (error instanceof Error && error.message.startsWith('permission path')) throw error;
				throw new Error(`cannot canonicalize permission path \`${path}\`: ${describe(error)}`);
			}
			const name = basename(current);
			const parent = dirname(current);
			if (name.length === 0 || parent === current) {
				throw new Error(`cannot canonicalize permission path \`${path}\``);
			}
			missing.push(name);
			current = parent;
		}
	}
}

function isSensitivePath(candidate: string): boolean {
	return isSensitivePathForHome(candidate, homeDirectory());
}

export function homeDirectory(): string | null {
	return resolveHomeDirectory(process.env['HOME'], () => {
		try {
			return homedir();
		} catch {
			return null;
		}
	});
}

export function resolveHomeDirectory(
	homeEnv: string | undefined,
	fallback: () => string | null,
): string | null {
	if (homeEnv !== undefined && homeEnv.length > 0) return homeEnv;
	return fallback();
}

export function isSensitivePathForHome(candidate: string, home: string | null): boolean {
	const name = basename(candidate);
	if (
		name === '.env' ||
		(name.startsWith('.env.') && name !== '.env.example' && name !== '.env.sample')
	) {
		return true;
	}
	if (home !== null && CREDENTIAL_FILE_NAMES.has(name) && isInHomeDotDirectory(candidate, home)) {
		return true;
	}
	const roots = ['/etc/shadow', '/etc/sudoers', '/private/etc/shadow', '/private/etc/sudoers'];
	if (home !== null) {
		roots.push(
			...[
				'.ssh',
				'.gnupg',
				'.aws',
				'.azure',
				'.kube',
				'.config/gh',
				'.config/gcloud',
				'Library/Keychains',
				'.docker/config.json',
				'.netrc',
				'.npmrc',
				'.git-credentials',
			].map((relative) => posix.join(home, relative)),
		);
	}
	return roots.some((root) => {
		let canonicalRoot: string;
		try {
			canonicalRoot = canonicalizeAllowMissing(root);
		} catch {
			return true;
		}
		return isAtOrInsideDirectory(canonicalRoot, candidate);
	});
}

const CREDENTIAL_FILE_NAMES = new Set(['auth.json', 'credentials.json', '.credentials.json']);

function isInHomeDotDirectory(candidate: string, home: string): boolean {
	let relative: string;
	try {
		relative = posix.relative(canonicalizeAllowMissing(home), candidate);
	} catch {
		return true;
	}
	const top = relative.split('/')[0] ?? '';
	return top.startsWith('.') && top !== '..';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareBytewise(a: string, b: string): number {
	return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function validateApprovalDecision(
	decision: string,
	scope: string,
): asserts decision is AgentApprovalDecision {
	if (decision !== 'allow' && decision !== 'deny') {
		throw new Error('approval decision must be `allow` or `deny`');
	}
	if (!isAgentApprovalScope(scope)) {
		throw new Error('approval scope must be `once`, `session`, `workstream`, or `everywhere`');
	}
}

export function approvalDecisionResult(
	decision: AgentApprovalDecision,
	scope: AgentApprovalScope,
	ruleId: string | null,
): AgentApprovalDecisionResult {
	const result: AgentApprovalDecisionResult = { decision, scope, remembered: ruleId !== null };
	return ruleId === null ? result : { ...result, ruleId };
}

export function rememberedRuleIdForResolvedApproval(
	db: MaliniDatabase,
	record: {
		readonly workstreamId: string;
		readonly sessionId: string;
		readonly permissionFingerprint: string | null;
	},
	decision: AgentApprovalDecision,
	scope: AgentApprovalScope,
): string | null {
	if (decision !== 'allow' || scope === 'once') return null;
	const fingerprint = record.permissionFingerprint;
	if (fingerprint === null) return null;
	const rule = listPermissionRules(db, record.workstreamId, record.sessionId).find(
		(candidate) =>
			candidate.revokedAt === null &&
			candidate.scope === scope &&
			candidate.permissionFingerprint === fingerprint &&
			(scope !== 'session' || candidate.sessionId === record.sessionId),
	);
	return rule ? rule.id : null;
}
