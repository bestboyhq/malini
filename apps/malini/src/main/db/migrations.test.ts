import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from './open';
import { openDatabase } from './driver';
import { TARGET_USER_VERSION, migrate, tableNames, userVersion } from './migrations';
import { all, get, scalar } from './rows';

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
	'deleted_workstreams',
	'docker_containers',
	'hidden_repositories',
	'job_definitions',
	'job_runs',
	'projects',
	'routine_gated_runs',
	'routine_suggestions',
	'routines',
	'scratchpads',
	'settings',
	'skill_choices',
	'skill_presets',
	'workstream_commit_runs',
	'workstream_ship',
	'workstreams',
];

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
	'idx_agent_runs_session_first_seq',
	'idx_agent_runs_session_obsoleted',
	'idx_agent_sessions_workstream_archived_started',
	'idx_agent_user_baselines_run',
	'idx_agent_user_baselines_workstream_created',
	'idx_docker_containers_bundle_released',
	'idx_docker_containers_project_service',
	'idx_job_runs_chat_session',
	'idx_job_runs_session',
	'idx_job_runs_status_created',
	'idx_routine_gated_runs_routine',
	'idx_routine_gated_runs_workstream_state',
	'idx_routine_suggestions_cluster',
	'idx_routines_status',
];

type Database = ReturnType<typeof openDatabase>;

function appTables(db: Database): string[] {
	return tableNames(db).filter((name) => !name.startsWith('sqlite_'));
}

function indexNames(db: Database): string[] {
	return all<{ name: string }>(
		db,
		"SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
	).map((row) => row.name);
}

function seedWorkstream(db: Database): void {
	db.exec(`
		INSERT INTO projects (id, name, repo_path, default_branch, created_at) VALUES ('p', 'p', '/tmp/p', 'main', '2026-07-19T00:00:00Z');
		INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at) VALUES ('w', 'p', 'w', '/tmp/w', 'malini/w', 'main', 'active', '2026-07-19T00:00:00Z');
	`);
}

describe('migrate', () => {
	it('creates every table and index and stamps the target user_version', () => {
		const db = openMigratedDatabase(':memory:');
		expect(appTables(db)).toEqual(ALL_TABLES);
		expect(indexNames(db)).toEqual(ALL_INDEXES);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(scalar(db, 'PRAGMA foreign_keys')).toBe(1);
		db.close();
	});

	it('is idempotent and keeps user_version on a second run', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db);
		migrate(db);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(scalar(db, 'SELECT COUNT(*) FROM workstreams')).toBe(1);
		db.close();
	});

	it('leaves a database from a newer release alone', () => {
		const db = openDatabase(':memory:');
		db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			PRAGMA user_version = ${TARGET_USER_VERSION + 1};`);
		expect(() => migrate(db)).not.toThrow();
		expect(userVersion(db)).toBe(TARGET_USER_VERSION + 1);
		expect(appTables(db)).toEqual(['settings']);
		db.close();
	});

	it('refuses a database older than the baseline and leaves it untouched', () => {
		const db = openDatabase(':memory:');
		db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			PRAGMA user_version = ${TARGET_USER_VERSION - 1};`);
		expect(() => migrate(db)).toThrow(
			`schema version ${TARGET_USER_VERSION - 1} predates the first release`,
		);
		expect(userVersion(db)).toBe(TARGET_USER_VERSION - 1);
		expect(appTables(db)).toEqual(['settings']);
		db.close();
	});

	it('rejects an invalid session status', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db);
		db.exec(
			"INSERT INTO agent_sessions (id, workstream_id, model, status, started_at) VALUES ('s', 'w', 'vendor/model-6', 'idle', '2026-07-19T00:00:00Z')",
		);
		expect(() =>
			db.exec(
				"INSERT INTO agent_sessions (id, workstream_id, model, status, started_at) VALUES ('illegal', 'w', NULL, 'nonsense', '2026-01-01T00:00:00Z')",
			),
		).toThrow();
		db.close();
	});

	it('the attachment schema enforces the bound-run state shape', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db);
		const sha = '0'.repeat(64);
		expect(() =>
			db.exec(
				`INSERT INTO agent_attachments (id, workstream_id, run_id, display_name, relative_path, media_type, size, sha256, state, created_at, expires_at, bound_at, removed_at)
				 VALUES ('att-0', 'w', NULL, 'a.txt', '.malini/agent-attachments/a', 'text/plain', 1, '${sha}', 'bound', '2026-07-11T00:00:00Z', NULL, '2026-07-11T00:00:00Z', NULL)`,
			),
		).toThrow();
		expect(() =>
			db.exec(
				`INSERT INTO agent_attachments (id, workstream_id, run_id, display_name, relative_path, media_type, size, sha256, state, created_at, expires_at, bound_at, removed_at)
				 VALUES ('att-1', 'w', 'run-impossible', 'b.txt', '.malini/agent-attachments/b', 'text/plain', 1, '${sha}', 'staged', '2026-07-11T00:00:00Z', '2026-07-12T00:00:00Z', NULL, NULL)`,
			),
		).toThrow();
		db.close();
	});

	it('counts the bytes of each run and its first event as events are written and rewritten', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db);
		db.exec(`
			INSERT INTO agent_sessions (id, workstream_id, status, started_at) VALUES ('s', 'w', 'idle', '2026-07-19T00:00:00Z');
			INSERT INTO agent_runs (id, session_id, prompt, started_at) VALUES ('r', 's', 'go', '2026-07-19T00:00:01Z');
			INSERT INTO agent_events (session_id, run_id, event, emitted_at) VALUES
			  ('s', 'r', 'abcd', '2026-07-19T00:00:02Z'),
			  ('s', 'r', 'efghij', '2026-07-19T00:00:03Z'),
			  ('other', 'r', 'ignored', '2026-07-19T00:00:04Z');
		`);
		const first = scalar(db, "SELECT MIN(seq) FROM agent_events WHERE session_id = 's'");
		expect(get(db, "SELECT event_bytes, first_seq FROM agent_runs WHERE id = 'r'")).toEqual({
			event_bytes: 10,
			first_seq: first,
		});

		db.exec(`UPDATE agent_events SET event = 'ab' WHERE seq = ${first}`);
		expect(scalar(db, "SELECT event_bytes FROM agent_runs WHERE id = 'r'")).toBe(8);
		db.close();
	});
});
