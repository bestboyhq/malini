import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import {
	findActivePermissionRule,
	listPermissionRules,
	markPermissionRuleUsed,
	matchPermissionRule,
	rememberPermissionRule,
	revokePermissionRule,
} from './permissions.repository';
import {
	approvalDecisionResult,
	isSensitivePathForHome,
	normalizeRememberablePermission,
	rememberedRuleIdForResolvedApproval,
	resolveHomeDirectory,
	validateApprovalDecision,
} from './permissions.service';
import { openChatTestDatabase, seedChatSession, seedChatWorkstream } from './test-support';

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'malini-perm-'));
	tempDirs.push(dir);
	return dir;
}

function canonicalDir(...parts: string[]): string {
	const path = join(...parts);
	mkdirSync(path, { recursive: true });
	return realpathSync.native(path);
}

function descriptor(path: string, capability: string, boundary: string): unknown {
	return {
		capability,
		resources: [{ kind: 'path', value: path, canonicalValue: path, boundary }],
	};
}

afterEach(() => {
	while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe('normalizeRememberablePermission', () => {
	it('normalizes only canonical external reads', () => {
		const root = tempDir();
		const workstream = canonicalDir(root, 'workstream');
		const external = canonicalDir(root, 'external');

		const normalized = normalizeRememberablePermission(
			descriptor(external, 'read', 'external'),
			workstream,
		);
		expect(normalized.fingerprint).toHaveLength(64);
		expect(normalized.canonicalJson).toBe(
			`{"capability":"read","resources":[{"kind":"path","canonicalValue":"${external}","boundary":"external"}]}`,
		);
		expect(normalized.fingerprint).toBe(
			createHash('sha256').update(normalized.canonicalJson).digest('hex'),
		);

		expect(() =>
			normalizeRememberablePermission(descriptor(external, 'write', 'external'), workstream),
		).toThrow('only canonical external reads can be remembered');
		expect(() =>
			normalizeRememberablePermission(descriptor(workstream, 'read', 'workstream'), workstream),
		).toThrow('remembered permissions require only canonical external path resources');
	});

	it('rejects sensitive, unknown, and tampered paths', () => {
		const root = tempDir();
		const workstream = canonicalDir(root, 'workstream');
		const external = canonicalDir(root, 'external');

		const unknownField = {
			...(descriptor(external, 'read', 'external') as object),
			unexpected: true,
		};
		expect(() => normalizeRememberablePermission(unknownField, workstream)).toThrow(
			'permission descriptor is invalid: unknown field `unexpected`',
		);

		const noCanonical = {
			capability: 'read',
			resources: [{ kind: 'path', value: external, boundary: 'external' }],
		};
		expect(() => normalizeRememberablePermission(noCanonical, workstream)).toThrow(
			'external path permission has no canonicalValue',
		);

		const sensitive = join(external, '.env');
		writeFileSync(sensitive, 'SECRET=nope');
		expect(() =>
			normalizeRememberablePermission(descriptor(sensitive, 'read', 'external'), workstream),
		).toThrow(`path \`${sensitive}\` is credential-sensitive and cannot be remembered`);

		const fileAncestor = join(external, 'regular-file');
		writeFileSync(fileAncestor, 'not a directory');
		const impossibleChild = join(fileAncestor, 'child');
		expect(() =>
			normalizeRememberablePermission(descriptor(impossibleChild, 'read', 'external'), workstream),
		).toThrow('has a missing tail below a non-directory ancestor');

		const alias = join(root, 'external-alias');
		symlinkSync(external, alias);
		expect(() =>
			normalizeRememberablePermission(descriptor(alias, 'read', 'external'), workstream),
		).toThrow(`external path \`${alias}\` is not host-canonical`);

		expect(() =>
			normalizeRememberablePermission(
				descriptor(`${external}/sub/..`, 'read', 'external'),
				workstream,
			),
		).toThrow('is not normalized');
		expect(() =>
			normalizeRememberablePermission(descriptor('relative/path', 'read', 'external'), workstream),
		).toThrow('external path `relative/path` is not absolute');
		expect(() =>
			normalizeRememberablePermission(
				descriptor(join(workstream, 'inside'), 'read', 'external'),
				workstream,
			),
		).toThrow('is inside the active workstream');
		expect(() =>
			normalizeRememberablePermission({ capability: 'read', resources: [] }, workstream),
		).toThrow('remembered permissions require 1-32 resources');
		expect(() => normalizeRememberablePermission('nope', workstream)).toThrow(
			'permission descriptor is invalid: expected an object',
		);
	});

	it('fingerprints independent of order and of the provider label', () => {
		const root = tempDir();
		const workstream = canonicalDir(root, 'workstream');
		const externalA = canonicalDir(root, 'external-a');
		const externalB = canonicalDir(root, 'external-b');
		const build = (resources: Array<[string, string]>): unknown => ({
			capability: 'read',
			resources: resources.map(([value, canonicalValue]) => ({
				kind: 'path',
				value,
				canonicalValue,
				boundary: 'external',
			})),
		});
		const first = normalizeRememberablePermission(
			build([
				['relative-provider-label-a', externalA],
				['label-b', externalB],
			]),
			workstream,
		);
		const reordered = normalizeRememberablePermission(
			build([
				['different-b', externalB],
				['different-a', externalA],
			]),
			workstream,
		);
		expect(first).toEqual(reordered);
	});

	it('refuses to remember anything but external reads', () => {
		const workstream = canonicalDir(tempDir(), 'workstream');
		expect(() =>
			normalizeRememberablePermission(
				{
					capability: 'execute',
					resources: [
						{
							kind: 'tool',
							value: 'computer_use:desktop',
							canonicalValue: 'computer_use:desktop',
							boundary: 'external',
						},
					],
				},
				workstream,
			),
		).toThrow('only canonical external reads can be remembered');
	});
});

describe('isSensitivePathForHome', () => {
	it('treats the common CLI credential stores as sensitive', () => {
		const home = canonicalDir(tempDir());
		for (const relative of [
			'.git-credentials',
			'.codex/auth.json',
			'.claude/.credentials.json',
			'.local/share/opencode/auth.json',
			'.ssh/id_ed25519',
			'.config/gh/hosts.yml',
		]) {
			expect(isSensitivePathForHome(join(home, relative), home)).toBe(true);
		}
		expect(isSensitivePathForHome(join(home, '.codex/config.toml'), home)).toBe(false);
		expect(isSensitivePathForHome(join(home, 'project/.env.example'), home)).toBe(false);
		expect(isSensitivePathForHome(join(home, 'project/.env.production'), home)).toBe(true);
		expect(isSensitivePathForHome(`${realpathSync.native('/etc')}/sudoers`, null)).toBe(true);
	});
});

describe('resolveHomeDirectory', () => {
	it('uses the fallback when HOME is unset and prefers a non-empty HOME', () => {
		expect(resolveHomeDirectory(undefined, () => '/fallback/home')).toBe('/fallback/home');
		expect(resolveHomeDirectory('', () => '/fallback/home')).toBe('/fallback/home');
		expect(
			resolveHomeDirectory('/configured/home', () => {
				throw new Error('fallback must not be consulted when HOME is configured');
			}),
		).toBe('/configured/home');
	});
});

describe('approval decisions', () => {
	it('validates decision and scope with the messages the renderer shows', () => {
		expect(() => validateApprovalDecision('maybe', 'once')).toThrow(
			'approval decision must be `allow` or `deny`',
		);
		expect(() => validateApprovalDecision('allow', 'forever')).toThrow(
			'approval scope must be `once`, `session`, or `workstream`',
		);
		expect(() => validateApprovalDecision('deny', 'workstream')).not.toThrow();
	});

	it('omits ruleId rather than nulling it', () => {
		expect(approvalDecisionResult('allow', 'once', null)).toEqual({
			decision: 'allow',
			scope: 'once',
			remembered: false,
		});
		expect(approvalDecisionResult('allow', 'session', 'rule-1')).toEqual({
			decision: 'allow',
			scope: 'session',
			remembered: true,
			ruleId: 'rule-1',
		});
	});
});

describe('agent_permission_rules repository', () => {
	const fingerprint = 'a'.repeat(64);
	const other = 'b'.repeat(64);

	function setup() {
		const db = openChatTestDatabase();
		seedChatWorkstream(db, 'ws-1', '/tmp/ws-1');
		seedChatWorkstream(db, 'ws-2', '/tmp/ws-2');
		seedChatSession(db, 'sess-1', 'ws-1');
		seedChatSession(db, 'sess-2', 'ws-1');
		seedChatSession(db, 'sess-other', 'ws-2');
		return db;
	}

	it('remembers once per scope, lists workstream rules plus the session own, and matches session first', () => {
		const db = setup();
		const sessionRuleId = rememberPermissionRule(db, {
			id: 'rule-session',
			scope: 'session',
			workstreamId: 'ws-1',
			sessionId: 'sess-1',
			permissionFingerprint: fingerprint,
			permissionJson: '{}',
			createdRunId: null,
			createdRequestId: 'req-1',
			createdAt: '2026-09-18T10:00:00.000Z',
		});
		expect(sessionRuleId).toBe('rule-session');
		expect(
			rememberPermissionRule(db, {
				id: 'rule-session-dup',
				scope: 'session',
				workstreamId: 'ws-1',
				sessionId: 'sess-1',
				permissionFingerprint: fingerprint,
				permissionJson: '{}',
				createdRunId: null,
				createdRequestId: 'req-2',
				createdAt: '2026-09-18T10:01:00.000Z',
			}),
		).toBe('rule-session');
		rememberPermissionRule(db, {
			id: 'rule-workstream',
			scope: 'workstream',
			workstreamId: 'ws-1',
			sessionId: 'sess-2',
			permissionFingerprint: fingerprint,
			permissionJson: '{}',
			createdRunId: null,
			createdRequestId: 'req-3',
			createdAt: '2026-09-18T10:02:00.000Z',
		});

		expect(listPermissionRules(db, 'ws-1').map((rule) => rule.id)).toEqual([
			'rule-workstream',
			'rule-session',
		]);
		expect(listPermissionRules(db, 'ws-1', 'sess-2').map((rule) => rule.id)).toEqual([
			'rule-workstream',
		]);
		expect(listPermissionRules(db, 'ws-1', 'sess-1')[1]).toEqual({
			id: 'rule-session',
			scope: 'session',
			workstreamId: 'ws-1',
			sessionId: 'sess-1',
			permissionFingerprint: fingerprint,
			permissionJson: '{}',
			createdRunId: null,
			createdRequestId: 'req-1',
			createdAt: '2026-09-18T10:00:00.000Z',
			lastUsedAt: null,
			revokedAt: null,
		});
		expect(() => listPermissionRules(db, 'ws-1', 'sess-other')).toThrow(
			'session `sess-other` does not belong to workstream `ws-1`',
		);

		expect(matchPermissionRule(db, 'ws-1', 'sess-1', fingerprint)?.id).toBe('rule-session');
		expect(matchPermissionRule(db, 'ws-1', 'sess-2', fingerprint)?.id).toBe('rule-workstream');
		expect(matchPermissionRule(db, 'ws-1', 'sess-1', other)).toBeNull();
		expect(findActivePermissionRule(db, 'ws-1', 'sess-1', fingerprint, 'workstream')?.id).toBe(
			'rule-workstream',
		);
		db.close();
	});

	it('revokes once, keeps the first revokedAt, and sorts revoked rules last', () => {
		const db = setup();
		rememberPermissionRule(db, {
			id: 'rule-a',
			scope: 'workstream',
			workstreamId: 'ws-1',
			sessionId: 'sess-1',
			permissionFingerprint: fingerprint,
			permissionJson: '{}',
			createdRunId: null,
			createdRequestId: 'req-a',
			createdAt: '2026-09-18T10:00:00.000Z',
		});
		rememberPermissionRule(db, {
			id: 'rule-b',
			scope: 'workstream',
			workstreamId: 'ws-1',
			sessionId: 'sess-1',
			permissionFingerprint: other,
			permissionJson: '{}',
			createdRunId: null,
			createdRequestId: 'req-b',
			createdAt: '2026-09-18T09:00:00.000Z',
		});
		revokePermissionRule(db, 'ws-1', 'rule-a', '2026-09-18T11:00:00.000Z');
		revokePermissionRule(db, 'ws-1', 'rule-a', '2026-09-18T12:00:00.000Z');
		const rules = listPermissionRules(db, 'ws-1');
		expect(rules.map((rule) => rule.id)).toEqual(['rule-b', 'rule-a']);
		expect(rules[1]?.revokedAt).toBe('2026-09-18T11:00:00.000Z');
		expect(matchPermissionRule(db, 'ws-1', 'sess-1', fingerprint)).toBeNull();
		expect(() => revokePermissionRule(db, 'ws-2', 'rule-a', '2026-09-18T11:00:00.000Z')).toThrow(
			'permission rule `rule-a` was not found in workstream `ws-2`',
		);
		db.close();
	});

	it('stamps last use only when the rule still matches the approval context', () => {
		const db = setup();
		rememberPermissionRule(db, {
			id: 'rule-s',
			scope: 'session',
			workstreamId: 'ws-1',
			sessionId: 'sess-1',
			permissionFingerprint: fingerprint,
			permissionJson: '{}',
			createdRunId: null,
			createdRequestId: 'req',
			createdAt: '2026-09-18T10:00:00.000Z',
		});
		expect(
			markPermissionRuleUsed(db, {
				ruleId: 'rule-s',
				workstreamId: 'ws-1',
				sessionId: 'sess-2',
				permissionFingerprint: fingerprint,
				usedAt: '2026-09-18T10:05:00.000Z',
			}),
		).toBe(false);
		expect(
			markPermissionRuleUsed(db, {
				ruleId: 'rule-s',
				workstreamId: 'ws-1',
				sessionId: 'sess-1',
				permissionFingerprint: fingerprint,
				usedAt: '2026-09-18T10:05:00.000Z',
			}),
		).toBe(true);
		expect(listPermissionRules(db, 'ws-1')[0]?.lastUsedAt).toBe('2026-09-18T10:05:00.000Z');

		const record = {
			workstreamId: 'ws-1',
			sessionId: 'sess-1',
			permissionFingerprint: fingerprint,
		};
		expect(rememberedRuleIdForResolvedApproval(db, record, 'allow', 'session')).toBe('rule-s');
		expect(rememberedRuleIdForResolvedApproval(db, record, 'allow', 'workstream')).toBeNull();
		expect(rememberedRuleIdForResolvedApproval(db, record, 'allow', 'once')).toBeNull();
		expect(rememberedRuleIdForResolvedApproval(db, record, 'deny', 'session')).toBeNull();
		expect(
			rememberedRuleIdForResolvedApproval(
				db,
				{ ...record, permissionFingerprint: null },
				'allow',
				'session',
			),
		).toBeNull();
		db.close();
	});
});
