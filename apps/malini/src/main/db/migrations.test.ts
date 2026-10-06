import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from './open';
import { openDatabase } from './driver';
import {
	MIGRATION_0022_AGENT_RUN_CHECKPOINT_FAILURES,
	TARGET_USER_VERSION,
	migrate,
	tableNames,
	userVersion,
} from './migrations';
import { ladderDatabase } from './test-fixtures';
import { all, scalar } from './rows';

const ALL_TABLES = [
	'agent_attachments',
	'agent_checkpoints',
	'agent_events',
	'agent_interactions',
	'agent_permission_rules',
	'agent_run_change_files',
	'agent_run_changes',
	'agent_runs',
	'agent_sessions',
	'agent_user_baselines',
	'connected_repositories',
	'docker_containers',
	'projects',
	'routine_gated_runs',
	'routine_suggestions',
	'routines',
	'settings',
	'workstream_commit_runs',
	'workstreams',
];

function appTables(db: ReturnType<typeof openDatabase>): string[] {
	return tableNames(db).filter((name) => !name.startsWith('sqlite_'));
}

function foreignKeyErrors(db: ReturnType<typeof openDatabase>): number {
	return scalar(db, 'SELECT COUNT(*) FROM pragma_foreign_key_check');
}

const SCOPED_TABLES = [
	'projects',
	'workstreams',
	'connected_repositories',
	'routines',
	'routine_suggestions',
];

function columnsOf(db: ReturnType<typeof openDatabase>, table: string): string[] {
	return all<{ name: string }>(db, `PRAGMA table_info(${table})`).map((row) => row.name);
}

function indexNames(db: ReturnType<typeof openDatabase>): string[] {
	return all<{ name: string }>(
		db,
		"SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
	).map((row) => row.name);
}

function indexColumns(db: ReturnType<typeof openDatabase>, index: string): string[] {
	return all<{ name: string }>(db, `PRAGMA index_info(${index})`).map((row) => row.name);
}

function rowids(db: ReturnType<typeof openDatabase>, table: string): unknown[] {
	return all(db, `SELECT id, rowid FROM ${table} ORDER BY id`);
}

const ALL_INDEXES = [
	'idx_agent_attachments_run',
	'idx_agent_attachments_workstream_state_expiry',
	'idx_agent_checkpoints_session_obsoleted',
	'idx_agent_checkpoints_session_seq',
	'idx_agent_checkpoints_workstream_created',
	'idx_agent_events_run',
	'idx_agent_events_session_seq',
	'idx_agent_interactions_pending',
	'idx_agent_permission_rules_active_session',
	'idx_agent_permission_rules_active_workstream',
	'idx_agent_permission_rules_effective',
	'idx_agent_run_changes_captured',
	'idx_agent_runs_session_obsoleted',
	'idx_agent_sessions_workstream_archived_started',
	'idx_agent_user_baselines_run',
	'idx_agent_user_baselines_workstream_created',
	'idx_docker_containers_bundle_released',
	'idx_docker_containers_project_service',
	'idx_routine_gated_runs_routine',
	'idx_routine_gated_runs_workstream_state',
	'idx_routine_suggestions_cluster',
	'idx_routines_status',
];

const V31_RENAMED_TABLES = [
	['workspaces', 'workstreams'],
	['workspace_routines', 'routines'],
	['agent_sessions', 'agent_sessions'],
	['agent_checkpoints', 'agent_checkpoints'],
	['agent_user_baselines', 'agent_user_baselines'],
	['agent_attachments', 'agent_attachments'],
	['agent_interactions', 'agent_interactions'],
	['agent_permission_rules', 'agent_permission_rules'],
	['docker_containers', 'docker_containers'],
	['routine_gated_runs', 'routine_gated_runs'],
] as const;

function rowidsOf(db: ReturnType<typeof openDatabase>, table: string): number[] {
	return all<{ rowid: number }>(db, `SELECT rowid FROM ${table} ORDER BY rowid`).map(
		(row) => row.rowid,
	);
}

function schemaMentioning(db: ReturnType<typeof openDatabase>, word: string): string[] {
	return all<{ name: string }>(
		db,
		'SELECT name FROM sqlite_master WHERE sql LIKE ? ORDER BY name',
		`%${word}%`,
	).map((row) => row.name);
}

function foreignKeyTargets(db: ReturnType<typeof openDatabase>): string[] {
	return appTables(db).flatMap((table) =>
		all<{ table: string; from: string }>(
			db,
			`SELECT "table", "from" FROM pragma_foreign_key_list('${table}')`,
		).map((key) => `${table}.${key.from} -> ${key.table}`),
	);
}

function seedV30(db: ReturnType<typeof openDatabase>): void {
	db.exec(`
		INSERT INTO projects (id, name, repo_path, default_branch, created_at)
		  VALUES ('local__acme__widgets', 'Widgets', '/tmp/widgets', 'main', '2026-09-22T00:00:00.000Z');
		INSERT INTO workspaces (id, project_id, name, path, branch, base_branch, status, created_at) VALUES
		  ('ws-31-a', 'local__acme__widgets', 'A', '/tmp/ws-31-a', 'malini/ws-31-a', 'main', 'active', '2026-09-22T00:00:01.000Z'),
		  ('ws-31-b', 'local__acme__widgets', 'B', '/tmp/ws-31-b', 'malini/ws-31-b', 'main', 'archived', '2026-09-22T00:00:02.000Z'),
		  ('ws-31-c', 'local__acme__widgets', 'C', '/tmp/ws-31-c', 'malini/ws-31-c', 'main', 'active', '2026-09-22T00:00:03.000Z');
		DELETE FROM workspaces WHERE id = 'ws-31-b';
		INSERT INTO agent_sessions (id, workspace_id, model, status, started_at, display_name) VALUES
		  ('sess-31-a', 'ws-31-a', 'anthropic/claude-sonnet-4-6', 'completed', '2026-09-22T00:00:04.000Z', 'First'),
		  ('sess-31-c', 'ws-31-c', 'openai/gpt-5.6-sol', 'idle', '2026-09-22T00:00:05.000Z', 'Second');
		INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at)
		  VALUES ('run-31', 'sess-31-a', 'ship it', '2026-09-22T00:00:06.000Z', '2026-09-22T00:00:07.000Z');
		INSERT INTO agent_checkpoints (id, workspace_id, session_id, run_id, user_message_seq, git_ref, git_commit, created_at)
		  VALUES ('cp-31', 'ws-31-a', 'sess-31-a', 'run-31', 1, 'refs/smack/checkpoints/ws-31-a/cp-31', '0123456789abcdef', '2026-09-22T00:00:06.500Z');
		INSERT INTO agent_user_baselines (id, workspace_id, session_id, run_id, git_ref, git_commit, created_at)
		  VALUES ('ub-31', 'ws-31-a', 'sess-31-a', 'run-31', 'refs/smack/user-baselines/ws-31-a/ub-31', 'abcdefabcdefabcd', '2026-09-22T00:00:05.500Z');
		INSERT INTO agent_attachments (id, workspace_id, run_id, display_name, relative_path, media_type, size, sha256, state, created_at, expires_at, bound_at, removed_at)
		  VALUES ('att-31', 'ws-31-a', 'run-31', 'a.txt', '.smack/agent-attachments/att-31/a.txt', 'text/plain', 1, '${'a'.repeat(64)}', 'bound', '2026-09-22T00:00:06.000Z', NULL, '2026-09-22T00:00:06.100Z', NULL);
		INSERT INTO agent_interactions (kind, session_id, workspace_id, run_id, request_id, request_payload_json, permission_json, permission_fingerprint, state, intended_response_json, response_json, decision, scope, source, requested_at, decided_at, closed_at) VALUES
		  ('question', 'sess-31-a', 'ws-31-a', 'run-31', 'req-gone', '{}', NULL, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, '2026-09-22T00:00:06.100Z', NULL, NULL),
		  ('approval', 'sess-31-a', 'ws-31-a', 'run-31', 'req-remembered', '{}', '{}', '${'b'.repeat(64)}', 'resolved', '{"decision":"allow","permission":{},"scope":"workspace"}', '{"decision":"allow","permission":{},"scope":"workspace"}', 'allow', 'workspace', 'manual', '2026-09-22T00:00:06.200Z', '2026-09-22T00:00:06.300Z', NULL),
		  ('approval', 'sess-31-a', 'ws-31-a', 'run-31', 'req-once', '{}', NULL, NULL, 'resolved', '{"decision":"deny","scope":"once"}', '{"decision":"deny","scope":"once"}', 'deny', 'once', 'manual', '2026-09-22T00:00:06.400Z', '2026-09-22T00:00:06.500Z', NULL),
		  ('question', 'sess-31-a', 'ws-31-a', 'run-31', 'req-pending', '{}', NULL, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, '2026-09-22T00:00:06.600Z', NULL, NULL);
		INSERT INTO agent_permission_rules (id, scope, workspace_id, session_id, permission_fingerprint, permission_json, created_run_id, created_request_id, created_at, last_used_at, revoked_at) VALUES
		  ('rule-31-gone', 'session', 'ws-31-a', 'sess-31-a', '${'e'.repeat(64)}', '{}', NULL, 'req-gone', '2026-09-22T00:00:06.250Z', NULL, NULL),
		  ('rule-31-workstream', 'workspace', 'ws-31-a', NULL, '${'b'.repeat(64)}', '{}', 'run-31', 'req-remembered', '2026-09-22T00:00:06.300Z', '2026-09-22T00:00:08.000Z', NULL),
		  ('rule-31-session', 'session', 'ws-31-a', 'sess-31-a', '${'c'.repeat(64)}', '{}', NULL, 'req-session', '2026-09-22T00:00:06.350Z', NULL, '2026-09-22T00:00:09.000Z');
		INSERT INTO docker_containers (container_id, container_name, bundle_identifier, app_instance_id, workspace_id, compose_project, service, owner, cwd, started_at, released_at, app_pid) VALUES
		  ('ctr-31-gone', 'widgets-ws-31-a-old-1', 'app.malini.desktop', 'instance-30', 'ws-31-a', 'widgets-ws-31-a', 'old', 'workspace', '/tmp/ws-31-a', '2026-09-22T00:00:09.000Z', '2026-09-22T00:00:09.500Z', NULL),
		  ('ctr-31-a', 'widgets-ws-31-a-db-1', 'app.malini.desktop', 'instance-31', 'ws-31-a', 'widgets-ws-31-a', 'db', 'workspace', '/tmp/ws-31-a', '2026-09-22T00:00:10.000Z', NULL, 4242),
		  ('ctr-31-shared', 'widgets-shared-cache-1', 'app.malini.desktop', 'instance-31', NULL, 'widgets-shared', 'cache', 'shared', '/tmp/widgets', '2026-09-22T00:00:11.000Z', '2026-09-22T00:00:12.000Z', NULL);
		INSERT INTO workspace_routines (id, status, origin, label, trigger_when, run_json, evidence_json, created_at, updated_at) VALUES
		  ('rt-31-a', 'routine', 'user', 'Tests', 'after a run', '{"command":"pnpm test","args":[]}', '[]', '2026-09-22T00:00:13.000Z', '2026-09-22T00:00:13.000Z'),
		  ('rt-31-b', 'draft', 'suggested', 'Lint', 'after a run', '{"command":"pnpm lint","args":[]}', '[]', '2026-09-22T00:00:14.000Z', '2026-09-22T00:00:14.000Z');
		INSERT INTO routine_gated_runs (id, routine_id, workspace_id, run_key, event, payload_json, state, created_at, decided_at) VALUES
		  ('gr-31-a', 'rt-31-a', 'ws-31-a', 'key-31-a', 'malini.run.completed', '{}', 'pending', '2026-09-22T00:00:15.000Z', NULL),
		  ('gr-31-b', 'rt-31-b', 'ws-31-c', 'key-31-b', 'malini.run.completed', '{}', 'confirmed', '2026-09-22T00:00:16.000Z', '2026-09-22T00:00:17.000Z');
		DELETE FROM agent_interactions WHERE request_id = 'req-gone';
		DELETE FROM agent_permission_rules WHERE id = 'rule-31-gone';
		DELETE FROM docker_containers WHERE container_id = 'ctr-31-gone';
	`);
}

describe('migrate', () => {
	it('creates all 19 binding tables and stamps the target user_version', () => {
		const db = openMigratedDatabase(':memory:');
		expect(appTables(db)).toEqual(ALL_TABLES);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(scalar(db, 'PRAGMA foreign_keys')).toBe(1);
		db.close();
	});

	it('is idempotent and keeps user_version on a second run', () => {
		const db = openMigratedDatabase(':memory:');
		const first = userVersion(db);
		migrate(db);
		expect(userVersion(db)).toBe(first);
		expect(first).toBeGreaterThanOrEqual(1);
		db.close();
	});

	it('a v33 database gains the commit runs table', () => {
		const db = openMigratedDatabase(':memory:');
		db.exec('DROP TABLE workstream_commit_runs; PRAGMA user_version = 33;');
		migrate(db);
		expect(appTables(db)).toEqual(ALL_TABLES);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		db.close();
	});

	it('a v34 database marks every run it already holds as written by the user', () => {
		const db = openMigratedDatabase(':memory:');
		db.exec('ALTER TABLE agent_runs DROP COLUMN automated; PRAGMA user_version = 34;');
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at)
			  VALUES ('p-1', 'p', '/tmp/p', 'main', '2026-10-02T00:00:00Z');
			INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at)
			  VALUES ('w-1', 'p-1', 'w', '/tmp/w', 'malini/w-1', 'main', 'active', '2026-10-02T00:00:00Z');
			INSERT INTO agent_sessions (id, workstream_id, model, status, started_at, display_name)
			  VALUES ('s-1', 'w-1', 'anthropic/claude-sonnet-4-6', 'completed', '2026-10-02T00:00:00Z', 'Chat 1');
			INSERT INTO agent_runs (id, session_id, prompt, started_at)
			  VALUES ('r-1', 's-1', 'Ship the sidebar', '2026-10-02T00:00:01Z');
		`);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(scalar(db, "SELECT automated FROM agent_runs WHERE id = 'r-1'")).toBe(0);
		db.close();
	});

	it('a v35 database keeps its commit runs, none of them with review threads resolved yet', () => {
		const db = openMigratedDatabase(':memory:');
		db.exec(
			'ALTER TABLE workstream_commit_runs DROP COLUMN threads_resolved_at; PRAGMA user_version = 35;',
		);
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at)
			  VALUES ('p-1', 'p', '/tmp/p', 'main', '2026-10-02T00:00:00Z');
			INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at)
			  VALUES ('w-1', 'p-1', 'w', '/tmp/w', 'malini/w-1', 'main', 'active', '2026-10-02T00:00:00Z');
			INSERT INTO workstream_commit_runs (workstream_id, run_id, commit_sha, committed_at)
			  VALUES ('w-1', 'r-1', 'abc1234', '2026-10-02T00:00:01Z');
		`);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(
			all(
				db,
				"SELECT commit_sha, threads_resolved_at FROM workstream_commit_runs WHERE run_id = 'r-1'",
			),
		).toEqual([{ commit_sha: 'abc1234', threads_resolved_at: null }]);
		db.close();
	});

	it('upgrades a v11 install without backfilling run changes', () => {
		const db = ladderDatabase(11);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(tableNames(db)).toContain('agent_run_changes');
		expect(tableNames(db)).toContain('agent_run_change_files');
		const columns = all<{ name: string }>(db, 'PRAGMA table_info(agent_run_changes)').map(
			(row) => row.name,
		);
		expect(columns).not.toContain('patch');
		expect(scalar(db, 'SELECT COUNT(*) FROM agent_run_changes')).toBe(0);
		db.close();
	});

	it('a v19 database keeps every workstream through the scope backfill and its removal', () => {
		const db = ladderDatabase(19);
		db.exec(`
			INSERT INTO projects (id, core_workspace_id, name, repo_path, default_branch, created_at)
			  VALUES ('proj-scoped', 'cw-1', 'proj', '/tmp/proj', 'main', '2026-01-01T00:00:00Z');
			INSERT INTO projects (id, core_workspace_id, name, repo_path, default_branch, created_at)
			  VALUES ('proj-unscoped', '', 'proj2', '/tmp/proj2', 'main', '2026-01-01T00:00:00Z');
			INSERT INTO workspaces (id, core_workspace_id, project_id, name, path, branch, base_branch, status, created_at)
			  VALUES ('ws-legacy', '', 'proj-scoped', 'legacy', '/tmp/ws', 'malini/ws-legacy', 'main', 'active', '2026-01-01T00:00:00Z');
			INSERT INTO workspaces (id, core_workspace_id, project_id, name, path, branch, base_branch, status, created_at)
			  VALUES ('ws-orphan-scope', '', 'proj-unscoped', 'orphan', '/tmp/ws2', 'malini/ws-orphan-scope', 'main', 'active', '2026-01-01T00:00:00Z');
		`);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(
			all<{ id: string; project_id: string }>(
				db,
				'SELECT id, project_id FROM workstreams ORDER BY id',
			),
		).toEqual([
			{ id: 'ws-legacy', project_id: 'proj-scoped' },
			{ id: 'ws-orphan-scope', project_id: 'proj-unscoped' },
		]);
		expect(columnsOf(db, 'workstreams')).not.toContain('core_workspace_id');
		expect(foreignKeyErrors(db)).toBe(0);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		db.close();
	});

	it('v24 adds the routine tables to a v23 database and enforces their invariants', () => {
		const db = ladderDatabase(23);
		expect(appTables(db)).not.toContain('workspace_routines');
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(appTables(db)).toEqual(ALL_TABLES);
		db.exec(`
			INSERT INTO routines
			  (id, status, origin, label, trigger_when, run_json, evidence_json, created_at, updated_at)
			VALUES
			  ('rt-1', 'candidate', 'user', 'Ensure preview', 'when a frontend resource becomes ready',
			   '{"command":"malini.preview.open","args":[]}', '[]', '2026-09-18T00:00:00Z', '2026-09-18T00:00:00Z');
			INSERT INTO routine_gated_runs
			  (id, routine_id, workstream_id, run_key, event, payload_json, state, created_at, decided_at)
			VALUES
			  ('gr-1', 'rt-1', 'ws-1', 'key-1', 'malini.resource.ready', '{}', 'pending', '2026-09-18T00:00:01Z', NULL);
		`);
		expect(() =>
			db.exec(
				`INSERT INTO routine_gated_runs
				   (id, routine_id, workstream_id, run_key, event, payload_json, state, created_at, decided_at)
				 VALUES
				   ('gr-2', 'rt-1', 'ws-1', 'key-2', 'malini.resource.ready', '{}', 'confirmed', '2026-09-18T00:00:02Z', NULL);`,
			),
		).toThrow(/CHECK/u);
		expect(() =>
			db.exec(
				`INSERT INTO routine_gated_runs
				   (id, routine_id, workstream_id, run_key, event, payload_json, state, created_at, decided_at)
				 VALUES
				   ('gr-3', 'rt-1', 'ws-1', 'key-1', 'malini.resource.ready', '{}', 'pending', '2026-09-18T00:00:03Z', NULL);`,
			),
		).toThrow(/UNIQUE/u);
		db.exec("DELETE FROM routines WHERE id = 'rt-1';");
		expect(scalar(db, 'SELECT COUNT(*) FROM routine_gated_runs')).toBe(0);
		db.close();
	});

	it('v25 adds obsoleted_at to the runs and checkpoints of a v24 database', () => {
		const db = ladderDatabase(24);
		expect(columnsOf(db, 'agent_runs')).not.toContain('obsoleted_at');
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(columnsOf(db, 'agent_runs')).toContain('obsoleted_at');
		expect(columnsOf(db, 'agent_checkpoints')).toContain('obsoleted_at');
		expect(appTables(db)).toEqual(ALL_TABLES);
		db.close();
	});

	it('v26 adds fork lineage columns to the agent_sessions of a v25 database', () => {
		const db = ladderDatabase(25);
		expect(columnsOf(db, 'agent_sessions')).not.toContain('fork_seq');
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(columnsOf(db, 'agent_sessions')).toEqual(
			expect.arrayContaining(['forked_from_session_id', 'fork_seq']),
		);
		db.close();
	});

	it('v27 drops the check and preview tables a v26 database still carried', () => {
		const db = ladderDatabase(26);
		db.exec(`
			INSERT INTO projects (id, core_workspace_id, name, repo_path, default_branch, created_at)
			  VALUES ('proj-27', 'cw-1', 'proj', '/tmp/proj', 'main', '2026-09-22T00:00:00Z');
			INSERT INTO workspaces (id, core_workspace_id, project_id, name, path, branch, base_branch, status, created_at)
			  VALUES ('ws-27', 'cw-1', 'proj-27', 'ws', '/tmp/ws', 'malini/ws-27', 'main', 'active', '2026-09-22T00:00:00Z');
			INSERT INTO check_results (id, workspace_id, command, exit_code, stdout, stderr, duration_ms, ran_at)
			  VALUES ('chk-27', 'ws-27', 'pnpm test', 0, '', '', 1, '2026-09-22T00:00:01Z');
			INSERT INTO workspace_preview_intents (workspace_id, command, updated_at)
			  VALUES ('ws-27', 'pnpm dev', '2026-09-22T00:00:02Z');
		`);
		expect(appTables(db)).toContain('check_results');
		expect(appTables(db)).toContain('workspace_preview_intents');

		migrate(db);

		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(appTables(db)).toEqual(ALL_TABLES);
		expect(foreignKeyErrors(db)).toBe(0);
		expect(scalar(db, "SELECT COUNT(*) FROM workstreams WHERE id = 'ws-27'")).toBe(1);
		db.close();
	});

	it('v27 is idempotent when the tables are already gone', () => {
		const db = ladderDatabase(26);
		db.exec('DROP TABLE check_results; DROP TABLE workspace_preview_intents;');
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(appTables(db)).toEqual(ALL_TABLES);
		db.close();
	});

	it('v16 repairs a drifted v14 database missing the auxiliary tables', () => {
		const db = ladderDatabase(13, 14);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(appTables(db)).toEqual(ALL_TABLES);
		expect(foreignKeyErrors(db)).toBe(0);
		migrate(db);
		expect(appTables(db)).toEqual(ALL_TABLES);
		db.close();
	});

	it('permission schema upgrades v12 with nullable run provenance', () => {
		const db = ladderDatabase(12);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(
			scalar(
				db,
				"SELECT [notnull] FROM pragma_table_info('agent_permission_rules') WHERE name = 'created_run_id'",
			),
		).toBe(0);
		expect(
			all<{ on_delete: string }>(
				db,
				"SELECT on_delete FROM pragma_foreign_key_list('agent_permission_rules') WHERE [from] = 'created_run_id'",
			)[0]?.on_delete,
		).toBe('SET NULL');
		db.close();
	});

	it('v16 repairs the conflicting v13 provider schema without losing children', () => {
		const db = openDatabase(':memory:');
		db.exec(`
			CREATE TABLE projects (
			  id TEXT PRIMARY KEY, name TEXT NOT NULL, repo_path TEXT NOT NULL,
			  default_branch TEXT NOT NULL, created_at TEXT NOT NULL,
			  core_workspace_id TEXT NOT NULL DEFAULT ''
			);
			CREATE TABLE workspaces (
			  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
			  name TEXT NOT NULL, path TEXT NOT NULL, branch TEXT NOT NULL,
			  base_branch TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
			  core_workspace_id TEXT NOT NULL DEFAULT ''
			);
			CREATE TABLE agent_sessions (
			  id TEXT PRIMARY KEY,
			  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
			  provider TEXT NOT NULL CHECK (provider IN ('codex','claude','opencode','cursor')),
			  model TEXT,
			  status TEXT NOT NULL CHECK (status IN ('idle','running','waiting_for_approval','completed','failed')),
			  started_at TEXT NOT NULL, provider_session_id TEXT,
			  display_name TEXT NOT NULL DEFAULT '', archived_at TEXT
			);
			CREATE TABLE agent_runs (
			  id TEXT PRIMARY KEY,
			  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
			  prompt TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
			  summary TEXT, error TEXT
			);
			INSERT INTO projects (id, name, repo_path, default_branch, created_at, core_workspace_id)
			  VALUES ('project-native-cold', 'Native cold', '/tmp/native-cold', 'main', '2026-07-22T00:00:00Z', '6a58008a28ad3ac394a392cc');
			INSERT INTO workspaces (id, project_id, name, path, branch, base_branch, status, created_at, core_workspace_id)
			  VALUES ('01JFC38279FF59D41E789CA0DA', 'project-native-cold', 'Native cold', '/tmp/native-cold-workstream', 'malini/native-cold', 'main', 'active', '2026-07-22T00:00:00Z', '6a58008a28ad3ac394a392cc');
			INSERT INTO agent_sessions (id, workspace_id, provider, model, status, started_at, display_name) VALUES
			  ('sess-1784709283023-4', '01JFC38279FF59D41E789CA0DA', 'opencode', 'opencode/glm-5.2', 'completed', '2026-07-22T08:34:43.023Z', 'GLM chat'),
			  ('session-anthropic', '01JFC38279FF59D41E789CA0DA', 'claude', 'claude-haiku-4-5', 'completed', '2026-07-22T08:35:00Z', 'Claude chat'),
			  ('session-openai', '01JFC38279FF59D41E789CA0DA', 'codex', 'gpt-5.6-sol', 'completed', '2026-07-22T08:36:00Z', 'Codex chat'),
			  ('session-unknown', '01JFC38279FF59D41E789CA0DA', 'opencode', 'deepseek/retired-model', 'completed', '2026-07-22T08:37:00Z', 'Historical chat');
			INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at)
			  VALUES ('run-preserved', 'sess-1784709283023-4', 'Preserve me', '2026-07-22T08:34:44Z', '2026-07-22T08:34:45Z');
			PRAGMA user_version = 13;
		`);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		const expected: Array<[string, string]> = [
			['sess-1784709283023-4', 'opencode/glm-5.2'],
			['session-anthropic', 'anthropic/claude-haiku-4-5'],
			['session-openai', 'openai/gpt-5.6-sol'],
			['session-unknown', 'anthropic/claude-sonnet-4-6'],
		];
		for (const [id, model] of expected) {
			const row = all<{ workstream_id: string; model: string }>(
				db,
				'SELECT workstream_id, model FROM agent_sessions WHERE id = ?',
				id,
			)[0];
			expect(row).toEqual({ workstream_id: '01JFC38279FF59D41E789CA0DA', model });
		}
		expect(
			all<{ session_id: string }>(
				db,
				"SELECT session_id FROM agent_runs WHERE id = 'run-preserved'",
			)[0]?.session_id,
		).toBe('sess-1784709283023-4');
		expect(foreignKeyErrors(db)).toBe(0);
		db.close();
	});

	it('v11 upgrade canonicalizes providers, preserves the graph and rowids, and restores foreign keys', () => {
		const db = ladderDatabase(11);
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at, core_workspace_id)
			  VALUES ('project-provider-v11', 'Provider v11', '/tmp/provider-v11', 'main', '2026-07-19T00:00:00.000Z', 'cw-11');
			INSERT INTO workspaces (id, project_id, name, path, branch, base_branch, status, created_at, core_workspace_id)
			  VALUES ('workstream-provider-v11', 'project-provider-v11', 'Provider v11', '/tmp/provider-v11/worktree', 'codex/provider-v11', 'main', 'active', '2026-07-19T00:00:00.000Z', 'cw-11');
			INSERT INTO agent_sessions (id, workspace_id, provider, model, status, started_at, provider_session_id, display_name, archived_at)
			  VALUES ('session-provider-v11', 'workstream-provider-v11', 'claude', 'claude-sonnet-4-6', 'completed', '2026-07-19T00:00:00.000Z', 'provider-session-v11', 'Preserved session', '2026-07-19T00:01:00.000Z');
			INSERT INTO agent_sessions (id, workspace_id, provider, model, status, started_at, provider_session_id, display_name, archived_at)
			  VALUES ('session-a-newest-provider-v11', 'workstream-provider-v11', 'claude', 'claude-opus-4-6', 'idle', '2026-07-19T00:02:00.000Z', NULL, 'Newest by insertion', NULL);
			INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, summary, error)
			  VALUES ('run-provider-v11', 'session-provider-v11', 'preserve me', '2026-07-19T00:00:01.000Z', '2026-07-19T00:00:02.000Z', 'done', NULL);
			INSERT INTO agent_checkpoints (id, workspace_id, session_id, run_id, user_message_seq, git_ref, git_commit, created_at)
			  VALUES ('checkpoint-provider-v11', 'workstream-provider-v11', 'session-provider-v11', 'run-provider-v11', 1, 'refs/malini/checkpoints/v11', '0123456789abcdef', '2026-07-19T00:00:03.000Z');
			PRAGMA user_version = 11;
		`);
		expect(() =>
			db.exec(
				"INSERT INTO agent_sessions (id, workspace_id, provider, model, status, started_at, provider_session_id, display_name, archived_at) VALUES ('rejected', 'workstream-provider-v11', 'core', NULL, 'idle', '2026-07-19T00:00:04.000Z', NULL, '', NULL)",
			),
		).toThrow();
		const latestBefore = all<{ id: string; rowid: number }>(
			db,
			"SELECT id, rowid FROM agent_sessions WHERE provider = 'claude' ORDER BY rowid DESC LIMIT 1",
		)[0];
		expect(latestBefore?.id).toBe('session-a-newest-provider-v11');

		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		const preserved = all<Record<string, unknown>>(
			db,
			"SELECT model, provider_session_id, display_name, archived_at FROM agent_sessions WHERE id = 'session-provider-v11'",
		)[0];
		expect(preserved).toEqual({
			model: 'anthropic/claude-sonnet-4-6',
			provider_session_id: null,
			display_name: 'Preserved session',
			archived_at: '2026-07-19T00:01:00.000Z',
		});
		const latestAfter = all<{ id: string; rowid: number }>(
			db,
			'SELECT id, rowid FROM agent_sessions ORDER BY rowid DESC LIMIT 1',
		)[0];
		expect(latestAfter).toEqual(latestBefore);
		expect(scalar(db, 'SELECT COUNT(*) FROM agent_runs')).toBe(1);
		expect(scalar(db, 'SELECT COUNT(*) FROM agent_checkpoints')).toBe(1);
		expect(scalar(db, 'PRAGMA foreign_keys')).toBe(1);
		expect(foreignKeyErrors(db)).toBe(0);
		db.exec(
			"INSERT INTO agent_sessions (id, workstream_id, model, status, started_at) VALUES ('upgraded', 'workstream-provider-v11', 'anthropic/claude-sonnet-4-6', 'idle', '2026-07-19T00:02:00.000Z')",
		);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		db.close();
	});

	it('v12 upgrade maps legacy models and preserves the durable graph', () => {
		const db = ladderDatabase(12);
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at, core_workspace_id)
			  VALUES ('project-owned-loop-v12', 'Owned loop v12', '/tmp/owned-loop-v12', 'main', '2026-07-19T00:00:00.000Z', 'cw-12');
			INSERT INTO workspaces (id, project_id, name, path, branch, base_branch, status, created_at, core_workspace_id)
			  VALUES ('workstream-owned-loop-v12', 'project-owned-loop-v12', 'Owned loop v12', '/tmp/owned-loop-v12/worktree', 'codex/owned-loop-v12', 'main', 'active', '2026-07-19T00:00:00.000Z', 'cw-12');
			INSERT INTO agent_sessions (id, workspace_id, provider, model, status, started_at, provider_session_id, display_name, archived_at) VALUES
			  ('session-claude', 'workstream-owned-loop-v12', 'claude', 'claude-opus-4-8', 'completed', '2026-07-19T00:00:01.000Z', 'claude-resume', 'Claude', NULL),
			  ('session-claude-unsupported', 'workstream-owned-loop-v12', 'claude', 'claude-fable-5', 'idle', '2026-07-19T00:00:02.000Z', 'claude-fable-resume', 'Claude unsupported', NULL),
			  ('session-codex', 'workstream-owned-loop-v12', 'codex', 'gpt-5.6-terra', 'idle', '2026-07-19T00:00:03.000Z', 'codex-resume', 'Codex', NULL),
			  ('session-opencode-zen', 'workstream-owned-loop-v12', 'opencode', 'opencode/big-pickle', 'idle', '2026-07-19T00:00:04.000Z', 'opencode-resume', 'OpenCode Zen', NULL),
			  ('session-opencode-known', 'workstream-owned-loop-v12', 'opencode', 'anthropic/claude-haiku-4-5', 'idle', '2026-07-19T00:00:05.000Z', 'opencode-known-resume', 'OpenCode known', NULL),
			  ('session-cursor', 'workstream-owned-loop-v12', 'cursor', NULL, 'idle', '2026-07-19T00:00:06.000Z', 'cursor-resume', 'Cursor', NULL),
			  ('session-owned-loop', 'workstream-owned-loop-v12', 'core', 'openai/gpt-5.6-sol', 'idle', '2026-07-19T00:00:07.000Z', 'owned-loop-resume', 'Owned loop', NULL),
			  ('session-owned-loop-invalid-zen', 'workstream-owned-loop-v12', 'core', 'opencode/vendor/model', 'idle', '2026-07-19T00:00:08.000Z', 'invalid-zen-resume', 'Invalid Zen', NULL);
			PRAGMA ignore_check_constraints = ON;
			INSERT INTO agent_sessions (id, workspace_id, provider, model, status, started_at, provider_session_id, display_name, archived_at)
			  VALUES ('session-unknown', 'workstream-owned-loop-v12', 'unknown', 'made-up-model', 'idle', '2026-07-19T00:00:09.000Z', 'unknown-resume', 'Unknown', NULL);
			PRAGMA ignore_check_constraints = OFF;
			INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, summary, error)
			  VALUES ('run-owned-loop-v12', 'session-claude', 'preserve the run', '2026-07-19T00:01:00.000Z', '2026-07-19T00:01:01.000Z', 'preserved', NULL);
			INSERT INTO agent_events (session_id, run_id, event, emitted_at)
			  VALUES ('session-claude', 'run-owned-loop-v12', 'assistant.message' || char(10) || '{"text":"preserve the event"}', '2026-07-19T00:01:01.000Z');
			INSERT INTO agent_checkpoints (id, workspace_id, session_id, run_id, user_message_seq, git_ref, git_commit, created_at)
			  VALUES ('checkpoint-owned-loop-v12', 'workstream-owned-loop-v12', 'session-claude', 'run-owned-loop-v12', 1, 'refs/malini/checkpoints/v12', '0123456789abcdef', '2026-07-19T00:01:02.000Z');
			PRAGMA user_version = 12;
		`);
		const rowidsBefore = all<{ id: string; rowid: number }>(
			db,
			'SELECT id, rowid FROM agent_sessions ORDER BY id',
		);

		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		const sessions = all<Record<string, unknown>>(
			db,
			'SELECT id, model, provider_session_id FROM agent_sessions ORDER BY id',
		);
		const canonical = (id: string, model: string) => ({
			id,
			model,
			provider_session_id: null,
		});
		expect(sessions).toEqual([
			canonical('session-claude', 'anthropic/claude-opus-4-8'),
			canonical('session-claude-unsupported', 'anthropic/claude-sonnet-4-6'),
			canonical('session-codex', 'openai/gpt-5.6-terra'),
			canonical('session-cursor', 'anthropic/claude-sonnet-4-6'),
			canonical('session-opencode-known', 'anthropic/claude-haiku-4-5'),
			canonical('session-opencode-zen', 'opencode/big-pickle'),
			canonical('session-owned-loop', 'openai/gpt-5.6-sol'),
			canonical('session-owned-loop-invalid-zen', 'anthropic/claude-sonnet-4-6'),
			canonical('session-unknown', 'anthropic/claude-sonnet-4-6'),
		]);
		expect(all(db, 'SELECT id, rowid FROM agent_sessions ORDER BY id')).toEqual(rowidsBefore);
		for (const table of ['agent_runs', 'agent_events', 'agent_checkpoints']) {
			expect(scalar(db, `SELECT COUNT(*) FROM ${table}`)).toBe(1);
		}
		expect(
			scalar(
				db,
				"SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_sessions_workstream_archived_started'",
			),
		).toBe(1);
		expect(foreignKeyErrors(db)).toBe(0);
		migrate(db);
		expect(
			all(db, 'SELECT id, model, provider_session_id FROM agent_sessions ORDER BY id'),
		).toEqual(sessions);
		db.close();
	});

	it('upgrades from v4 by applying the session metadata migrations', () => {
		const db = ladderDatabase(4);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(tableNames(db)).toContain('agent_checkpoints');
		const columns = all<{ name: string }>(db, 'PRAGMA table_info(agent_sessions)').map(
			(row) => row.name,
		);
		expect(columns).toEqual(
			expect.arrayContaining(['provider_session_id', 'display_name', 'archived_at']),
		);
		db.close();
	});

	it('upgrade from v8 repairs only legacy epoch-in-seconds timestamps', () => {
		const db = ladderDatabase(8);
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at, core_workspace_id)
			  VALUES ('project-time', 'time', '/tmp/time', 'main', '2026-07-10T00:00:00Z', 'local');
			INSERT INTO workspaces (id, project_id, name, path, branch, base_branch, status, created_at, core_workspace_id)
			  VALUES ('workstream-time', 'project-time', 'Time', '/tmp/time/ws', 'malini/time', 'main', 'active', '2026-07-10T00:00:00Z', 'local');
			INSERT INTO agent_sessions (id, workspace_id, provider, model, status, started_at, provider_session_id, display_name, archived_at)
			  VALUES ('session-time', 'workstream-time', 'claude', 'claude-sonnet-4-6', 'completed', '2026-07-03T00:00:1783733529Z', NULL, 'Time', '2026-07-03T00:00:1783733555Z');
			INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, summary, error)
			  VALUES ('run-time', 'session-time', 'time', '2026-07-03T00:00:1783733530Z', '2026-07-03T00:00:1783733554Z', NULL, NULL);
			INSERT INTO agent_events (session_id, run_id, event, emitted_at)
			  VALUES ('session-time', 'run-time', '{}', '2026-07-03T00:00:1783733531Z');
			PRAGMA user_version = 8;
		`);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		const repaired = [
			"SELECT started_at AS v FROM agent_sessions WHERE id = 'session-time'",
			"SELECT archived_at AS v FROM agent_sessions WHERE id = 'session-time'",
			"SELECT started_at AS v FROM agent_runs WHERE id = 'run-time'",
			"SELECT completed_at AS v FROM agent_runs WHERE id = 'run-time'",
			"SELECT emitted_at AS v FROM agent_events WHERE run_id = 'run-time'",
		].map((sql) => all<{ v: string }>(db, sql)[0]?.v ?? '');
		for (const value of repaired) {
			expect(Number.isNaN(Date.parse(value))).toBe(false);
			expect(value).not.toContain('T00:00:178');
		}
		expect(
			all<{ v: string }>(db, "SELECT created_at AS v FROM projects WHERE id = 'project-time'")[0]
				?.v,
		).toBe('2026-07-10T00:00:00Z');
		db.close();
	});

	it('a v20 database upgrades to the baseline table without losing rows', () => {
		const db = ladderDatabase(20);
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at) VALUES ('p', 'p', '/tmp/p', 'main', '2026-07-22T00:00:00Z');
			INSERT INTO workspaces (id, project_id, name, path, branch, base_branch, status, created_at) VALUES ('w', 'p', 'w', '/tmp/w', 'malini/w', 'main', 'active', '2026-07-22T00:00:00Z');
			INSERT INTO agent_sessions (id, workspace_id, provider, status, started_at) VALUES ('s', 'w', 'core', 'idle', '2026-07-22T00:00:00Z');
			INSERT INTO agent_runs (id, session_id, prompt, started_at) VALUES ('r', 's', 'p', '2026-07-22T00:00:01Z');
		`);
		expect(appTables(db)).not.toContain('agent_user_baselines');
		migrate(db);
		expect(tableNames(db)).toContain('agent_user_baselines');
		expect(tableNames(db)).not.toContain('agent_run_checkpoint_failures');
		expect(foreignKeyErrors(db)).toBe(0);
		expect(scalar(db, 'SELECT COUNT(*) FROM agent_runs')).toBe(1);
		migrate(db);
		db.close();
	});

	it('the fresh schema has no provider column and rejects an invalid session status', () => {
		const db = openMigratedDatabase(':memory:');
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at) VALUES ('p', 'p', '/tmp/p', 'main', '2026-07-19T00:00:00Z');
			INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at) VALUES ('w', 'p', 'w', '/tmp/w', 'codex/w', 'main', 'active', '2026-07-19T00:00:00Z');
		`);
		db.exec(
			"INSERT INTO agent_sessions (id, workstream_id, model, status, started_at) VALUES ('s-fresh', 'w', 'openai/gpt-5.6-terra', 'idle', '2026-07-19T00:00:00Z')",
		);
		expect(() =>
			db.exec(
				"INSERT INTO agent_sessions (id, workstream_id, provider, model, status, started_at) VALUES ('s-legacy', 'w', 'codex', NULL, 'idle', '2026-07-19T00:00:01Z')",
			),
		).toThrow(/has no column named provider/u);
		expect(() =>
			db.exec(
				"INSERT INTO agent_sessions (id, workstream_id, model, status, started_at) VALUES ('illegal', 'w', NULL, 'nonsense', '2026-01-01T00:00:00Z')",
			),
		).toThrow();
		const columns = all<{ name: string }>(db, 'PRAGMA table_info(agent_sessions)').map(
			(row) => row.name,
		);
		expect(columns).not.toContain('provider');
		expect(columns).toContain('provider_session_id');
		expect(
			scalar(
				db,
				"SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_sessions_workstream_archived_started'",
			),
		).toBe(1);
		db.close();
	});

	it('v27 upgrades a populated database to the target, preserving rowids, children and refs', () => {
		const db = ladderDatabase(27);
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at, core_workspace_id)
			  VALUES ('local__acme__widgets', 'Widgets', '/tmp/widgets', 'main', '2026-09-01T00:00:00.000Z', 'cw-27');
			INSERT INTO workspaces (id, project_id, name, path, branch, base_branch, status, created_at, core_workspace_id)
			  VALUES ('ws-27', 'local__acme__widgets', 'Widgets', '/tmp/widgets/ws', 'malini/ws-27', 'main', 'active', '2026-09-01T00:00:00.000Z', 'cw-27');
			INSERT INTO agent_sessions (id, workspace_id, provider, model, status, started_at, provider_session_id, display_name, archived_at, forked_from_session_id, fork_seq)
			  VALUES ('sess-27-a', 'ws-27', 'core', 'anthropic/claude-sonnet-4-6', 'completed', '2026-09-01T00:00:01.000Z', 'upstream-27', 'First chat', NULL, NULL, NULL);
			INSERT INTO agent_sessions (id, workspace_id, provider, model, status, started_at, provider_session_id, display_name, archived_at, forked_from_session_id, fork_seq)
			  VALUES ('sess-27-b', 'ws-27', 'core', 'openai/gpt-5.6-sol', 'idle', '2026-09-01T00:00:02.000Z', NULL, 'Branch chat', NULL, 'sess-27-a', 7);
			INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, summary, error)
			  VALUES ('run-27', 'sess-27-a', 'do the thing', '2026-09-01T00:00:03.000Z', '2026-09-01T00:00:04.000Z', 'done', NULL);
			INSERT INTO agent_events (session_id, run_id, event, emitted_at)
			  VALUES ('sess-27-a', 'run-27', 'assistant.message', '2026-09-01T00:00:04.000Z');
			INSERT INTO agent_checkpoints (id, workspace_id, session_id, run_id, user_message_seq, git_ref, git_commit, created_at)
			  VALUES ('cp-27', 'ws-27', 'sess-27-a', 'run-27', 1, 'refs/core/checkpoints/ws-27/cp-27', '0123456789abcdef', '2026-09-01T00:00:03.000Z');
			INSERT INTO agent_run_changes (run_id, checkpoint_id, before_commit, after_commit, after_ref, captured_at)
			  VALUES ('run-27', 'cp-27', '0123456789abcdef', 'fedcba9876543210', 'refs/core/run-changes/ws-27/rc-27', '2026-09-01T00:00:05.000Z');
			INSERT INTO agent_user_baselines (id, workspace_id, session_id, run_id, git_ref, git_commit, created_at)
			  VALUES ('ub-27', 'ws-27', 'sess-27-a', 'run-27', 'refs/core/user-baselines/ws-27/ub-27', 'abcdefabcdefabcd', '2026-09-01T00:00:02.500Z');
			INSERT INTO agent_attachments (id, workspace_id, run_id, display_name, relative_path, media_type, size, sha256, state, created_at, expires_at, bound_at, removed_at)
			  VALUES ('att-27', 'ws-27', 'run-27', 'brief.pdf', '.core/agent-attachments/att-27/brief.pdf', 'application/pdf', 3, '${'a'.repeat(64)}', 'bound', '2026-09-01T00:00:03.000Z', NULL, '2026-09-01T00:00:03.500Z', NULL);
			INSERT INTO agent_interactions (kind, session_id, workspace_id, run_id, request_id, request_payload_json, state, requested_at)
			  VALUES ('approval', 'sess-27-a', 'ws-27', 'run-27', 'req-27', '{}', 'pending', '2026-09-01T00:00:03.200Z');
			INSERT INTO agent_permission_rules (id, scope, workspace_id, session_id, permission_fingerprint, permission_json, created_run_id, created_request_id, created_at)
			  VALUES ('rule-27', 'session', 'ws-27', 'sess-27-a', '${'b'.repeat(64)}', '{}', 'run-27', 'req-27', '2026-09-01T00:00:03.300Z');
			INSERT INTO agent_run_checkpoint_failures (run_id, reason, recorded_at)
			  VALUES ('run-27', 'none', '2026-09-01T00:00:06.000Z');
		`);
		const rowidsBefore = all<{ id: string; rowid: number }>(
			db,
			'SELECT id, rowid FROM agent_sessions ORDER BY id',
		);

		migrate(db);

		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(all(db, 'SELECT id, rowid FROM agent_sessions ORDER BY id')).toEqual(rowidsBefore);
		expect(
			all<{ name: string }>(db, 'PRAGMA table_info(agent_sessions)').map((row) => row.name),
		).not.toContain('provider');
		expect(
			all<Record<string, unknown>>(
				db,
				"SELECT model, provider_session_id, display_name, forked_from_session_id, fork_seq FROM agent_sessions WHERE id = 'sess-27-b'",
			)[0],
		).toEqual({
			model: 'openai/gpt-5.6-sol',
			provider_session_id: null,
			display_name: 'Branch chat',
			forked_from_session_id: 'sess-27-a',
			fork_seq: 7,
		});
		for (const table of [
			'agent_runs',
			'agent_events',
			'agent_checkpoints',
			'agent_run_changes',
			'agent_user_baselines',
			'agent_attachments',
			'agent_interactions',
			'agent_permission_rules',
		]) {
			expect(scalar(db, `SELECT COUNT(*) FROM ${table}`)).toBe(1);
		}
		expect(tableNames(db)).not.toContain('agent_run_checkpoint_failures');
		expect(foreignKeyErrors(db)).toBe(0);
		expect(
			scalar(
				db,
				"SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_sessions_workstream_archived_started'",
			),
		).toBe(1);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		db.close();
	});

	it('v29 rewrites every persisted ref and attachment path into the malini namespace', () => {
		const db = ladderDatabase(27);
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at, core_workspace_id)
			  VALUES ('p29', 'p', '/tmp/p29', 'main', '2026-09-02T00:00:00.000Z', '');
			INSERT INTO workspaces (id, project_id, name, path, branch, base_branch, status, created_at, core_workspace_id)
			  VALUES ('ws-29', 'p29', 'w', '/tmp/ws-29', 'malini/ws-29', 'main', 'active', '2026-09-02T00:00:00.000Z', '');
			INSERT INTO agent_sessions (id, workspace_id, provider, model, status, started_at)
			  VALUES ('sess-29', 'ws-29', 'core', NULL, 'idle', '2026-09-02T00:00:01.000Z');
			INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at)
			  VALUES ('run-29', 'sess-29', 'p', '2026-09-02T00:00:02.000Z', '2026-09-02T00:00:03.000Z');
			INSERT INTO agent_checkpoints (id, workspace_id, session_id, run_id, user_message_seq, git_ref, git_commit, created_at)
			  VALUES ('cp-29', 'ws-29', 'sess-29', 'run-29', 1, 'refs/core/checkpoints/ws-29/cp-29', '0123456789abcdef', '2026-09-02T00:00:02.000Z');
			INSERT INTO agent_checkpoints (id, workspace_id, session_id, run_id, user_message_seq, git_ref, git_commit, created_at)
			  VALUES ('cp-29-foreign', 'ws-29', 'sess-29', 'run-29', 2, 'refs/heads/malini/ws-29', '0123456789abcdef', '2026-09-02T00:00:02.500Z');
			INSERT INTO agent_run_changes (run_id, checkpoint_id, before_commit, after_commit, after_ref, captured_at)
			  VALUES ('run-29', 'cp-29', '0123456789abcdef', 'fedcba9876543210', 'refs/core/run-changes/ws-29/rc-29', '2026-09-02T00:00:04.000Z');
			INSERT INTO agent_user_baselines (id, workspace_id, session_id, run_id, git_ref, git_commit, created_at)
			  VALUES ('ub-29', 'ws-29', 'sess-29', 'run-29', 'refs/core/user-baselines/ws-29/ub-29', 'abcdefabcdefabcd', '2026-09-02T00:00:01.500Z');
			INSERT INTO agent_attachments (id, workspace_id, run_id, display_name, relative_path, media_type, size, sha256, state, created_at, expires_at, bound_at, removed_at)
			  VALUES ('att-29', 'ws-29', 'run-29', 'a.txt', '.core/agent-attachments/att-29/a.txt', 'text/plain', 1, '${'c'.repeat(64)}', 'bound', '2026-09-02T00:00:02.000Z', NULL, '2026-09-02T00:00:02.100Z', NULL);
			INSERT INTO agent_attachments (id, workspace_id, run_id, display_name, relative_path, media_type, size, sha256, state, created_at, expires_at, bound_at, removed_at)
			  VALUES ('att-29-foreign', 'ws-29', NULL, 'b.txt', 'docs/b.txt', 'text/plain', 1, '${'d'.repeat(64)}', 'staged', '2026-09-02T00:00:02.200Z', '2026-09-03T00:00:00.000Z', NULL, NULL);
		`);

		migrate(db);

		const refs = (sql: string): string[] => all<{ v: string }>(db, sql).map((row) => row.v);
		expect(refs('SELECT git_ref AS v FROM agent_checkpoints ORDER BY id')).toEqual([
			'refs/malini/checkpoints/ws-29/cp-29',
			'refs/heads/malini/ws-29',
		]);
		expect(refs('SELECT after_ref AS v FROM agent_run_changes')).toEqual([
			'refs/malini/run-changes/ws-29/rc-29',
		]);
		expect(refs('SELECT git_ref AS v FROM agent_user_baselines')).toEqual([
			'refs/malini/user-baselines/ws-29/ub-29',
		]);
		expect(refs('SELECT relative_path AS v FROM agent_attachments ORDER BY id')).toEqual([
			'.malini/agent-attachments/att-29/a.txt',
			'docs/b.txt',
		]);
		migrate(db);
		expect(refs('SELECT git_ref AS v FROM agent_checkpoints ORDER BY id')[0]).toBe(
			'refs/malini/checkpoints/ws-29/cp-29',
		);
		db.close();
	});

	it('v29 leaves local__ project ids alone', () => {
		const db = ladderDatabase(27);
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at, core_workspace_id)
			  VALUES ('local__acme__widgets', 'Widgets', '/tmp/widgets', 'main', '2026-09-03T00:00:00.000Z', '');
			INSERT INTO projects (id, name, repo_path, default_branch, created_at, core_workspace_id)
			  VALUES ('cw-scope__local__acme__gadgets', 'Gadgets', '/tmp/gadgets', 'main', '2026-09-03T00:00:00.000Z', 'cw-scope');
		`);

		migrate(db);

		expect(
			all<{ id: string }>(db, 'SELECT id FROM projects ORDER BY id').map((row) => row.id),
		).toEqual(['cw-scope__local__acme__gadgets', 'local__acme__widgets']);
		db.close();
	});

	it('the attachment schema enforces the bound-run state shape', () => {
		const db = openMigratedDatabase(':memory:');
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at) VALUES ('p', 'p', '/tmp/p', 'main', '2026-07-11T00:00:00Z');
			INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at) VALUES ('w', 'p', 'w', '/tmp/w', 'codex/w', 'main', 'active', '2026-07-11T00:00:00Z');
		`);
		const sha = '0'.repeat(64);
		expect(() =>
			db.exec(
				`INSERT INTO agent_attachments (id, workstream_id, run_id, display_name, relative_path, media_type, size, sha256, state, created_at, expires_at, bound_at, removed_at)
				 VALUES ('att-00000000000000000000000000000000', 'w', NULL, 'a.txt', '.malini/agent-attachments/a', 'text/plain', 1, '${sha}', 'bound', '2026-07-11T00:00:00Z', NULL, '2026-07-11T00:00:00Z', NULL)`,
			),
		).toThrow();
		expect(() =>
			db.exec(
				`INSERT INTO agent_attachments (id, workstream_id, run_id, display_name, relative_path, media_type, size, sha256, state, created_at, expires_at, bound_at, removed_at)
				 VALUES ('att-11111111111111111111111111111111', 'w', 'run-impossible', 'b.txt', '.malini/agent-attachments/b', 'text/plain', 1, '${sha}', 'staged', '2026-07-11T00:00:00Z', '2026-07-12T00:00:00Z', NULL, NULL)`,
			),
		).toThrow();
		db.close();
	});

	it('a fresh database carries no Core scope and indexes routines by status alone', () => {
		const db = openMigratedDatabase(':memory:');
		for (const table of SCOPED_TABLES) {
			expect(columnsOf(db, table)).not.toContain('core_workspace_id');
		}
		expect(indexNames(db)).toEqual(ALL_INDEXES);
		expect(indexColumns(db, 'idx_routines_status')).toEqual(['status']);
		expect(indexColumns(db, 'idx_routine_suggestions_cluster')).toEqual(['cluster_key']);
		db.close();
	});

	it('v30 drops the Core scope from a populated v29 database without losing rows', () => {
		const db = ladderDatabase(29);
		db.exec(`
			INSERT INTO projects (id, core_workspace_id, name, repo_path, default_branch, created_at) VALUES
			  ('local__acme__widgets', 'local', 'Widgets', '/tmp/widgets', 'main', '2026-09-20T00:00:00.000Z'),
			  ('local__acme__gadgets', 'local', 'Gadgets', '/tmp/gadgets', 'main', '2026-09-20T00:00:01.000Z');
			INSERT INTO workspaces (id, core_workspace_id, project_id, name, path, branch, base_branch, status, created_at) VALUES
			  ('ws-30-a', 'local', 'local__acme__widgets', 'A', '/tmp/ws-30-a', 'agentic/ws-30-a', 'main', 'active', '2026-09-20T00:00:02.000Z'),
			  ('ws-30-b', 'local', 'local__acme__gadgets', 'B', '/tmp/ws-30-b', 'malini/ws-30-b', 'main', 'archived', '2026-09-20T00:00:03.000Z');
			INSERT INTO agent_sessions (id, workspace_id, model, status, started_at)
			  VALUES ('sess-30', 'ws-30-a', 'anthropic/claude-sonnet-4-6', 'idle', '2026-09-20T00:00:04.000Z');
			INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at)
			  VALUES ('run-30', 'sess-30', 'ship it', '2026-09-20T00:00:05.000Z', '2026-09-20T00:00:06.000Z');
			INSERT INTO connected_repositories (id, core_workspace_id, full_name, default_branch, local_path, remote_url, created_at) VALUES
			  ('repo-30-a', 'local', 'acme/widgets', 'main', '/tmp/widgets', NULL, '2026-09-20T00:00:07.000Z'),
			  ('repo-30-b', 'local', 'acme/gadgets', 'main', NULL, 'https://github.com/acme/gadgets.git', '2026-09-20T00:00:08.000Z');
			INSERT INTO workspace_routines (id, core_workspace_id, status, origin, label, trigger_when, run_json, evidence_json, created_at, updated_at) VALUES
			  ('rt-30-a', 'local', 'routine', 'user', 'Tests', 'after a run', '{"command":"pnpm test","args":[]}', '[]', '2026-09-20T00:00:09.000Z', '2026-09-20T00:00:09.000Z'),
			  ('rt-30-b', 'local', 'draft', 'suggested', 'Lint', 'after a run', '{"command":"pnpm lint","args":[]}', '[]', '2026-09-20T00:00:10.000Z', '2026-09-20T00:00:10.000Z');
			INSERT INTO routine_gated_runs (id, routine_id, workspace_id, run_key, event, payload_json, state, created_at, decided_at)
			  VALUES ('gr-30', 'rt-30-a', 'ws-30-a', 'key-30', 'malini.run.completed', '{}', 'pending', '2026-09-20T00:00:11.000Z', NULL);
			INSERT INTO routine_suggestions (id, core_workspace_id, cluster_key, status, evidence_json, created_at, updated_at) VALUES
			  ('sg-30-first', 'local', 'update dependencies', 'dismissed', '[]', '2026-09-20T00:00:12.000Z', '2026-09-20T00:00:12.000Z'),
			  ('sg-30-other-scope', 'cw-other', 'update dependencies', 'open', '[]', '2026-09-20T00:00:13.000Z', '2026-09-20T00:00:13.000Z'),
			  ('sg-30-unique', 'local', 'open pull request', 'open', '[]', '2026-09-20T00:00:14.000Z', '2026-09-20T00:00:14.000Z');
		`);
		const rowidsBefore = (
			[
				['projects', 'projects'],
				['workspaces', 'workstreams'],
				['connected_repositories', 'connected_repositories'],
				['workspace_routines', 'routines'],
			] as const
		).map(([legacy, current]) => [current, rowids(db, legacy)] as const);
		const suggestionRowidsBefore = rowids(db, 'routine_suggestions');

		migrate(db);

		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		for (const table of SCOPED_TABLES) {
			expect(columnsOf(db, table)).not.toContain('core_workspace_id');
		}
		for (const [table, before] of rowidsBefore) {
			expect(rowids(db, table)).toEqual(before);
		}
		expect(
			all<{ id: string }>(db, 'SELECT id FROM projects ORDER BY id').map((row) => row.id),
		).toEqual(['local__acme__gadgets', 'local__acme__widgets']);
		expect(
			all<{ id: string; branch: string }>(db, 'SELECT id, branch FROM workstreams ORDER BY id'),
		).toEqual([
			{ id: 'ws-30-a', branch: 'agentic/ws-30-a' },
			{ id: 'ws-30-b', branch: 'malini/ws-30-b' },
		]);
		expect(rowids(db, 'routine_suggestions')).toEqual(
			suggestionRowidsBefore.filter((row) => (row as { id: string }).id !== 'sg-30-other-scope'),
		);
		expect(all(db, 'SELECT id, cluster_key, status FROM routine_suggestions ORDER BY id')).toEqual([
			{ id: 'sg-30-first', cluster_key: 'update dependencies', status: 'dismissed' },
			{ id: 'sg-30-unique', cluster_key: 'open pull request', status: 'open' },
		]);
		for (const table of ['agent_sessions', 'agent_runs', 'routine_gated_runs']) {
			expect(scalar(db, `SELECT COUNT(*) FROM ${table}`)).toBe(1);
		}
		expect(foreignKeyErrors(db)).toBe(0);
		expect(indexNames(db)).toEqual(ALL_INDEXES);
		expect(indexColumns(db, 'idx_routines_status')).toEqual(['status']);
		expect(indexColumns(db, 'idx_routine_suggestions_cluster')).toEqual(['cluster_key']);
		expect(() =>
			db.exec(
				"INSERT INTO routine_suggestions (id, cluster_key, status, evidence_json, created_at, updated_at) VALUES ('sg-30-dup', 'open pull request', 'open', '[]', '2026-09-20T00:00:15.000Z', '2026-09-20T00:00:15.000Z')",
			),
		).toThrow(/UNIQUE/u);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		db.close();
	});

	it('a fresh database names workstreams and routines, never workspaces', () => {
		const db = openMigratedDatabase(':memory:');
		expect(schemaMentioning(db, 'workspace')).toEqual([]);
		expect(foreignKeyTargets(db)).toEqual(
			expect.arrayContaining([
				'agent_sessions.workstream_id -> workstreams',
				'routine_gated_runs.routine_id -> routines',
			]),
		);
		db.close();
	});

	it('v31 renames the workstream tables, columns, values and indexes of a populated v30 database', () => {
		const db = ladderDatabase(30);
		seedV30(db);
		const before = V31_RENAMED_TABLES.map(
			([legacy, current]) => [current, rowidsOf(db, legacy)] as const,
		);
		expect(schemaMentioning(db, 'workspace').length).toBeGreaterThan(0);

		migrate(db);

		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(appTables(db)).toEqual(ALL_TABLES);
		for (const [table, rowidsBefore] of before) {
			expect(rowidsOf(db, table), table).toEqual(rowidsBefore);
			expect(rowidsBefore.length, table).toBeGreaterThan(0);
		}
		expect(rowidsOf(db, 'workstreams')).toEqual([1, 3]);
		for (const table of ['agent_interactions', 'agent_permission_rules', 'docker_containers']) {
			expect(rowidsOf(db, table)[0], table).toBe(2);
		}
		expect(schemaMentioning(db, 'workspace')).toEqual([]);
		for (const table of appTables(db)) {
			expect(columnsOf(db, table), table).not.toContain('workspace_id');
		}
		expect(foreignKeyErrors(db)).toBe(0);
		expect(foreignKeyTargets(db)).toContain('routine_gated_runs.routine_id -> routines');
		expect(foreignKeyTargets(db).filter((key) => key.endsWith('-> workstreams'))).toEqual([
			'agent_attachments.workstream_id -> workstreams',
			'agent_checkpoints.workstream_id -> workstreams',
			'agent_interactions.workstream_id -> workstreams',
			'agent_permission_rules.workstream_id -> workstreams',
			'agent_sessions.workstream_id -> workstreams',
			'agent_user_baselines.workstream_id -> workstreams',
			'workstream_commit_runs.workstream_id -> workstreams',
		]);
		expect(indexNames(db)).toEqual(ALL_INDEXES);
		expect(indexColumns(db, 'idx_agent_sessions_workstream_archived_started')).toEqual([
			'workstream_id',
			'archived_at',
			'started_at',
		]);
		expect(indexColumns(db, 'idx_agent_permission_rules_active_workstream')).toEqual([
			'workstream_id',
			'permission_fingerprint',
		]);
		expect(indexColumns(db, 'idx_routine_gated_runs_workstream_state')).toEqual([
			'workstream_id',
			'state',
		]);

		expect(
			all(db, 'SELECT id, workstream_id, display_name FROM agent_sessions ORDER BY id'),
		).toEqual([
			{ id: 'sess-31-a', workstream_id: 'ws-31-a', display_name: 'First' },
			{ id: 'sess-31-c', workstream_id: 'ws-31-c', display_name: 'Second' },
		]);
		expect(
			all(
				db,
				'SELECT request_id, scope, intended_response_json, response_json FROM agent_interactions ORDER BY request_id',
			),
		).toEqual([
			{
				request_id: 'req-once',
				scope: 'once',
				intended_response_json: '{"decision":"deny","scope":"once"}',
				response_json: '{"decision":"deny","scope":"once"}',
			},
			{
				request_id: 'req-pending',
				scope: null,
				intended_response_json: null,
				response_json: null,
			},
			{
				request_id: 'req-remembered',
				scope: 'workstream',
				intended_response_json: '{"decision":"allow","permission":{},"scope":"workstream"}',
				response_json: '{"decision":"allow","permission":{},"scope":"workstream"}',
			},
		]);
		expect(
			all(
				db,
				'SELECT id, scope, workstream_id, session_id, last_used_at, revoked_at FROM agent_permission_rules ORDER BY id',
			),
		).toEqual([
			{
				id: 'rule-31-session',
				scope: 'session',
				workstream_id: 'ws-31-a',
				session_id: 'sess-31-a',
				last_used_at: null,
				revoked_at: '2026-09-22T00:00:09.000Z',
			},
			{
				id: 'rule-31-workstream',
				scope: 'workstream',
				workstream_id: 'ws-31-a',
				session_id: null,
				last_used_at: '2026-09-22T00:00:08.000Z',
				revoked_at: null,
			},
		]);
		expect(
			all(
				db,
				'SELECT container_id, workstream_id, owner, released_at, app_pid FROM docker_containers ORDER BY container_id',
			),
		).toEqual([
			{
				container_id: 'ctr-31-a',
				workstream_id: 'ws-31-a',
				owner: 'workstream',
				released_at: null,
				app_pid: 4242,
			},
			{
				container_id: 'ctr-31-shared',
				workstream_id: null,
				owner: 'shared',
				released_at: '2026-09-22T00:00:12.000Z',
				app_pid: null,
			},
		]);
		expect(
			all(db, 'SELECT id, routine_id, workstream_id, state FROM routine_gated_runs ORDER BY id'),
		).toEqual([
			{ id: 'gr-31-a', routine_id: 'rt-31-a', workstream_id: 'ws-31-a', state: 'pending' },
			{ id: 'gr-31-b', routine_id: 'rt-31-b', workstream_id: 'ws-31-c', state: 'confirmed' },
		]);
		expect(
			all(
				db,
				'SELECT git_ref FROM agent_checkpoints UNION ALL SELECT git_ref FROM agent_user_baselines',
			),
		).toEqual([
			{ git_ref: 'refs/malini/checkpoints/ws-31-a/cp-31' },
			{ git_ref: 'refs/malini/user-baselines/ws-31-a/ub-31' },
		]);
		expect(all(db, 'SELECT relative_path FROM agent_attachments')).toEqual([
			{ relative_path: '.malini/agent-attachments/att-31/a.txt' },
		]);

		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(indexNames(db)).toEqual(ALL_INDEXES);
		db.close();
	});

	it('v31 keeps the renamed constraints and cascades enforced', () => {
		const db = ladderDatabase(30);
		seedV30(db);
		migrate(db);
		db.exec('PRAGMA foreign_keys = ON;');

		expect(() =>
			db.exec(
				`INSERT INTO agent_permission_rules (id, scope, workstream_id, session_id, permission_fingerprint, permission_json, created_request_id, created_at)
				 VALUES ('rule-dup', 'workstream', 'ws-31-a', NULL, '${'b'.repeat(64)}', '{}', 'req-dup', '2026-09-22T00:01:00.000Z')`,
			),
		).toThrow(/UNIQUE/u);
		expect(() =>
			db.exec(
				`INSERT INTO agent_permission_rules (id, scope, workstream_id, session_id, permission_fingerprint, permission_json, created_request_id, created_at)
				 VALUES ('rule-legacy', 'workspace', 'ws-31-c', NULL, '${'d'.repeat(64)}', '{}', 'req-legacy', '2026-09-22T00:01:00.000Z')`,
			),
		).toThrow(/CHECK/u);
		expect(() =>
			db.exec(
				`INSERT INTO docker_containers (container_id, container_name, bundle_identifier, app_instance_id, workstream_id, compose_project, service, owner, cwd, started_at)
				 VALUES ('ctr-legacy', 'n', 'app.malini.desktop', 'i', 'ws-31-c', 'p', 's', 'workspace', '/tmp', '2026-09-22T00:01:00.000Z')`,
			),
		).toThrow(/CHECK/u);
		expect(() =>
			db.exec(
				"INSERT INTO agent_sessions (id, workstream_id, model, status, started_at) VALUES ('sess-orphan', 'ws-missing', NULL, 'idle', '2026-09-22T00:01:00.000Z')",
			),
		).toThrow(/FOREIGN KEY/u);

		db.exec("DELETE FROM routines WHERE id = 'rt-31-a';");
		expect(all(db, 'SELECT id FROM routine_gated_runs')).toEqual([{ id: 'gr-31-b' }]);
		db.exec("DELETE FROM agent_attachments WHERE workstream_id = 'ws-31-a';");
		db.exec("DELETE FROM agent_interactions WHERE workstream_id = 'ws-31-a';");
		db.exec("DELETE FROM agent_permission_rules WHERE workstream_id = 'ws-31-a';");
		expect(scalar(db, 'SELECT COUNT(*) FROM agent_permission_rules')).toBe(0);
		expect(foreignKeyErrors(db)).toBe(0);
		db.close();
	});

	it('v33 gives the inherited turns of a forked chat their restore point and drops the failure table', () => {
		const db = openMigratedDatabase(':memory:');
		db.exec(`
			${MIGRATION_0022_AGENT_RUN_CHECKPOINT_FAILURES}
			PRAGMA user_version = 32;
			INSERT INTO projects (id, name, repo_path, default_branch, created_at)
			  VALUES ('p', 'p', '/tmp/p', 'main', '2026-09-30T00:00:00.000Z');
			INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at)
			  VALUES ('ws', 'p', 'ws', '/tmp/ws', 'malini/ws', 'main', 'active', '2026-09-30T00:00:00.000Z');
			INSERT INTO agent_sessions (id, workstream_id, status, started_at)
			  VALUES ('parent', 'ws', 'idle', '2026-09-30T00:00:01.000Z');
			INSERT INTO agent_sessions (id, workstream_id, status, started_at, forked_from_session_id, fork_seq)
			  VALUES ('child', 'ws', 'idle', '2026-09-30T00:00:09.000Z', 'parent', 4);
			INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at)
			  VALUES ('run-kept', 'parent', 'one', '2026-09-30T00:00:02.000Z', '2026-09-30T00:00:03.000Z'),
			         ('run-unbound', 'parent', 'two', '2026-09-30T00:00:04.000Z', '2026-09-30T00:00:05.000Z');
			INSERT INTO agent_events (seq, session_id, run_id, event, emitted_at) VALUES
			  (1, 'parent', 'run-kept', 'user.message' || char(10) || '{"text":"one","checkpointId":"cp-kept"}', '2026-09-30T00:00:02.000Z'),
			  (3, 'parent', 'run-unbound', 'user.message' || char(10) || '{"text":"two"}', '2026-09-30T00:00:04.000Z'),
			  (7, 'child', 'run-kept', 'user.message' || char(10) || '{"text":"one","checkpointUnavailable":"inherited from parent chat"}', '2026-09-30T00:00:09.000Z'),
			  (8, 'child', 'run-unbound', 'user.message' || char(10) || '{"text":"two","checkpointUnavailable":"inherited from parent chat"}', '2026-09-30T00:00:09.000Z');
			INSERT INTO agent_checkpoints (id, workstream_id, session_id, run_id, user_message_seq, git_ref, git_commit, created_at) VALUES
			  ('cp-kept', 'ws', 'parent', 'run-kept', 1, 'refs/malini/checkpoints/ws/cp-kept', 'abc123', '2026-09-30T00:00:02.000Z'),
			  ('cp-unbound', 'ws', 'parent', 'run-unbound', NULL, 'refs/malini/checkpoints/ws/cp-unbound', 'def456', '2026-09-30T00:00:04.000Z');
		`);

		migrate(db);

		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(tableNames(db)).not.toContain('agent_run_checkpoint_failures');
		expect(
			all(
				db,
				"SELECT id, session_id, run_id, user_message_seq, git_ref, git_commit FROM agent_checkpoints WHERE session_id = 'child'",
			),
		).toEqual([
			{
				id: 'cp-kept.child',
				session_id: 'child',
				run_id: 'run-kept',
				user_message_seq: 7,
				git_ref: 'refs/malini/checkpoints/ws/cp-kept.child',
				git_commit: 'abc123',
			},
		]);
		expect(all(db, 'SELECT seq, event FROM agent_events ORDER BY seq')).toEqual([
			{ seq: 1, event: 'user.message\n{"text":"one","checkpointId":"cp-kept"}' },
			{ seq: 3, event: 'user.message\n{"text":"two"}' },
			{ seq: 7, event: 'user.message\n{"text":"one","checkpointId":"cp-kept.child"}' },
			{ seq: 8, event: 'user.message\n{"text":"two"}' },
		]);
		expect(foreignKeyErrors(db)).toBe(0);
		migrate(db);
		db.close();
	});

	it('a later schema bump does not replay the auxiliary repair against the scope-free schema', () => {
		const db = openMigratedDatabase(':memory:');
		expect(() => migrate(db, TARGET_USER_VERSION + 1)).not.toThrow();
		expect(userVersion(db)).toBe(TARGET_USER_VERSION + 1);
		expect(appTables(db)).toEqual(ALL_TABLES);
		expect(columnsOf(db, 'routines')).not.toContain('core_workspace_id');
		db.close();
	});
});
