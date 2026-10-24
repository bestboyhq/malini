import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from './open';
import { openDatabase } from './driver';
import {
	BASELINE_USER_VERSION,
	SCHEMA,
	TARGET_USER_VERSION,
	migrate,
	tableNames,
	userVersion,
} from './migrations';
import { all, get, scalar } from './rows';

const ALL_TABLES = [
	'agent_actions',
	'agent_attachments',
	'agent_checkpoints',
	'agent_events',
	'agent_interactions',
	'agent_permission_rules',
	'agent_run_change_files',
	'agent_run_changes',
	'agent_runs',
	'agent_session_changes',
	'agent_sessions',
	'agent_user_baselines',
	'connected_repositories',
	'deleted_workstreams',
	'docker_containers',
	'hidden_repositories',
	'job_definitions',
	'job_experiment_results',
	'job_experiment_samples',
	'job_experiments',
	'job_outputs',
	'job_runs',
	'job_setups',
	'job_suggestions',
	'mcp_server_folder_offs',
	'mcp_server_listings',
	'projects',
	'scratchpads',
	'settings',
	'skill_choices',
	'workstream_commit_runs',
	'workstream_ship',
	'workstreams',
];

const ALL_INDEXES = [
	'idx_agent_actions_started',
	'idx_agent_attachments_run',
	'idx_agent_attachments_workstream_state_expiry',
	'idx_agent_checkpoints_session_obsoleted',
	'idx_agent_checkpoints_session_seq',
	'idx_agent_checkpoints_workstream_created',
	'idx_agent_events_run',
	'idx_agent_events_session_seq',
	'idx_agent_interactions_pending',
	'idx_agent_permission_rules_active_everywhere',
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
	'idx_job_experiments_definition',
	'idx_job_outputs_definition_created',
	'idx_job_runs_chat_session',
	'idx_job_runs_parent',
	'idx_job_runs_session',
	'idx_job_runs_status_created',
	'idx_job_setups_definition_created',
	'idx_job_suggestions_cluster',
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
			PRAGMA user_version = ${BASELINE_USER_VERSION - 1};`);
		expect(() => migrate(db)).toThrow(
			`schema version ${BASELINE_USER_VERSION - 1} predates the first release`,
		);
		expect(userVersion(db)).toBe(BASELINE_USER_VERSION - 1);
		expect(appTables(db)).toEqual(['settings']);
		db.close();
	});

	it('moves the skills of a preset into the jobs and job sessions that used it, then drops presets', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION};`);
		db.exec(`
			INSERT INTO skill_presets (id, name, skills, created_at, updated_at) VALUES
			  ('writer', 'Writer', '["humanizer","adr"]', '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z');
			INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, output, created_at, updated_at, skill_preset_id) VALUES
			  ('copy', 'Copy', 'Edit.', 'opus', 'high', 'workstream', 'none', '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z', 'writer'),
			  ('plain', 'Plain', 'Go.', 'opus', 'high', 'workstream', 'none', '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z', NULL),
			  ('gone', 'Gone', 'Go.', 'opus', 'high', 'workstream', 'none', '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z', 'deleted');
			INSERT INTO skill_choices (scope, owner_id, choice, updated_at) VALUES
			  ('session', 'preset-session', '{"kind":"preset","presetId":"writer"}', '2026-10-15T00:00:00Z'),
			  ('session', 'custom-session', '{"kind":"custom","skills":["dataviz"]}', '2026-10-15T00:00:00Z'),
			  ('session', 'all-session', '{"kind":"all"}', '2026-10-15T00:00:00Z'),
			  ('session', 'lost-session', '{"kind":"preset","presetId":"deleted"}', '2026-10-15T00:00:00Z'),
			  ('session', 'broken-session', 'not json', '2026-10-15T00:00:00Z'),
			  ('workstream', 'w', '{"kind":"custom","skills":["adr"]}', '2026-10-15T00:00:00Z');
		`);

		migrate(db);

		expect(userVersion(db)).toBe(TARGET_USER_VERSION);
		expect(appTables(db)).toEqual(ALL_TABLES);
		expect(
			all(db, 'SELECT id, skills FROM job_definitions WHERE builtin IS NULL ORDER BY id'),
		).toEqual([
			{ id: 'copy', skills: '["humanizer","adr"]' },
			{ id: 'gone', skills: '[]' },
			{ id: 'plain', skills: '[]' },
		]);
		expect(all(db, 'SELECT owner_id, choice FROM skill_choices ORDER BY owner_id')).toEqual([
			{ owner_id: 'custom-session', choice: '["dataviz"]' },
			{ owner_id: 'preset-session', choice: '["humanizer","adr"]' },
		]);
		db.close();
	});

	it('keeps remembered approvals and lets a rule hold everywhere, outside any workstream', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION};`);
		seedWorkstream(db);
		const fingerprint = 'a'.repeat(64);
		db.exec(`
			INSERT INTO agent_sessions (id, workstream_id, status, started_at) VALUES ('s', 'w', 'idle', '2026-10-20T00:00:00Z');
			INSERT INTO agent_permission_rules (id, scope, workstream_id, session_id, permission_fingerprint, permission_json, created_request_id, created_at)
			  VALUES ('kept', 'workstream', 'w', NULL, '${fingerprint}', '{}', 'approval-1', '2026-10-20T00:00:00Z');
		`);

		migrate(db);

		expect(all(db, 'SELECT id, scope, workstream_id FROM agent_permission_rules')).toEqual([
			{ id: 'kept', scope: 'workstream', workstream_id: 'w' },
		]);
		db.exec(`INSERT INTO agent_permission_rules (id, scope, workstream_id, session_id, permission_fingerprint, permission_json, created_request_id, created_at)
			VALUES ('everywhere', 'everywhere', NULL, NULL, '${fingerprint}', '{}', 'approval-2', '2026-10-21T00:00:00Z')`);
		expect(() =>
			db.exec(`INSERT INTO agent_permission_rules (id, scope, workstream_id, session_id, permission_fingerprint, permission_json, created_request_id, created_at)
				VALUES ('tied', 'everywhere', 'w', NULL, '${'b'.repeat(64)}', '{}', 'approval-3', '2026-10-21T00:00:00Z')`),
		).toThrow();
		expect(() =>
			db.exec(`INSERT INTO agent_permission_rules (id, scope, workstream_id, session_id, permission_fingerprint, permission_json, created_request_id, created_at)
				VALUES ('loose', 'workstream', NULL, NULL, '${'c'.repeat(64)}', '{}', 'approval-4', '2026-10-21T00:00:00Z')`),
		).toThrow();
		expect(indexNames(db)).toEqual(ALL_INDEXES);
		db.close();
	});

	it('drops the always-allowed open draft rules now that the agent runs the Open draft job', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION};`);
		seedWorkstream(db);
		const action = (value: string) =>
			JSON.stringify({
				capability: 'execute',
				resources: [{ kind: 'action', value, boundary: 'workstream' }],
			});
		db.exec(`
			INSERT INTO agent_permission_rules (id, scope, workstream_id, session_id, permission_fingerprint, permission_json, created_request_id, created_at) VALUES
			  ('draft', 'workstream', 'w', NULL, '${'a'.repeat(64)}', '${action('pull-requests.open-draft')}', 'approval-1', '2026-10-20T00:00:00Z'),
			  ('save', 'workstream', 'w', NULL, '${'b'.repeat(64)}', '${action('jobs.save')}', 'approval-2', '2026-10-20T00:00:00Z');
		`);

		migrate(db);

		expect(all(db, 'SELECT id FROM agent_permission_rules')).toEqual([{ id: 'save' }]);
		db.close();
	});

	it('turns routines into job triggers and Then chains, and a job ending into its Then', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION};`);
		seedWorkstream(db);
		const at = '2026-10-20T00:00:00Z';
		db.exec(`
			INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, output, builtin, created_at, updated_at) VALUES
			  ('docs', 'Update docs', 'Docs.', 'opus', 'high', 'new-workstream', 'draft', 'update-docs', '${at}', '${at}'),
			  ('main', 'Update from main', 'Old.', 'opus', 'high', 'workstream', 'none', 'update-from-main', '${at}', '${at}'),
			  ('log', 'Changelog', 'Log.', 'opus', 'high', 'workstream', 'merge', NULL, '${at}', '${at}'),
			  ('a', 'A', 'A.', 'opus', 'high', 'workstream', 'none', NULL, '${at}', '${at}'),
			  ('b', 'B', 'B.', 'opus', 'high', 'workstream', 'none', NULL, '${at}', '${at}'),
			  ('c', 'C', 'C.', 'opus', 'high', 'workstream', 'none', NULL, '${at}', '${at}'),
			  ('manual', 'Manual', 'M.', 'opus', 'high', 'workstream', 'none', NULL, '${at}', '${at}');
			INSERT INTO routines (id, status, origin, label, trigger_when, steps_json, evidence_json, created_at, updated_at) VALUES
			  ('own-log', 'routine', 'user', 'Changelog', 'on pull-requests:ship-changed where merged is set', '[{"job":"log"}]', '[]', '2026-10-20T00:00:01Z', '${at}'),
			  ('second-log', 'candidate', 'user', 'Again', 'on app:updated', '[{"job":"log"}]', '[]', '2026-10-20T00:00:02Z', '${at}'),
			  ('chain', 'candidate', 'user', 'Chain', 'when a new workstream is created', '[{"job":"a"},{"command":"x","args":[]},{"job":"b"}]', '[]', '2026-10-20T00:00:03Z', '${at}'),
			  ('pair', 'draft', 'user', 'Pair', 'when I run it', '[{"job":"b"},{"job":"c"}]', '[]', '2026-10-20T00:00:04Z', '${at}'),
			  ('by-hand', 'routine', 'user', 'By hand', 'when I run it', '[{"job":"manual"}]', '[]', '2026-10-20T00:00:05Z', '${at}');
			INSERT INTO routine_gated_runs (id, routine_id, workstream_id, run_key, event, payload_json, state, created_at, decided_at) VALUES
			  ('held', 'second-log', 'w', 'k1', 'app:updated', '{"to":"1.2.0"}', 'pending', '${at}', NULL),
			  ('done', 'second-log', 'w', 'k2', 'app:updated', '{}', 'rejected', '${at}', '${at}');
			INSERT INTO job_runs (id, definition_id, title, workstream_id, origin, status, created_at) VALUES
			  ('past', 'log', 'Changelog', 'w', 'routine', 'succeeded', '${at}');
			INSERT INTO routine_suggestions (id, cluster_key, status, evidence_json, created_at, updated_at) VALUES
			  ('idea', 'k', 'open', '[]', '${at}', '${at}');
			INSERT INTO agent_permission_rules (id, scope, workstream_id, session_id, permission_fingerprint, permission_json, created_request_id, created_at) VALUES
			  ('save-routines', 'workstream', 'w', NULL, '${'d'.repeat(64)}', '{"capability":"execute","resources":[{"kind":"action","value":"routines.save","boundary":"workstream"}]}', 'r1', '${at}'),
			  ('save-jobs', 'workstream', 'w', NULL, '${'e'.repeat(64)}', '{"capability":"execute","resources":[{"kind":"action","value":"jobs.save","boundary":"workstream"}]}', 'r2', '${at}');
		`);

		migrate(db);

		const builtinId = (builtin: string): unknown =>
			get<{ id: string }>(db, 'SELECT id FROM job_definitions WHERE builtin = ?', builtin)?.id;
		expect(
			all(
				db,
				`SELECT id, trigger_when, trigger_mode, then_job_id FROM job_definitions
				 WHERE builtin IS NULL OR builtin = 'update-docs' ORDER BY id`,
			),
		).toEqual([
			{
				id: 'a',
				trigger_when: 'on repositories:workstream-created',
				trigger_mode: 'ask',
				then_job_id: 'b',
			},
			{ id: 'b', trigger_when: null, trigger_mode: null, then_job_id: 'c' },
			{ id: 'c', trigger_when: null, trigger_mode: null, then_job_id: null },
			{ id: 'docs', trigger_when: null, trigger_mode: null, then_job_id: builtinId('open-draft') },
			{
				id: 'log',
				trigger_when: 'on pull-requests:ship-changed where merged is set',
				trigger_mode: 'auto',
				then_job_id: builtinId('merge'),
			},
			{ id: 'manual', trigger_when: null, trigger_mode: null, then_job_id: null },
		]);
		expect(
			all(
				db,
				"SELECT name, effort FROM job_definitions WHERE builtin IN ('open-draft', 'merge', 'update-from-main') ORDER BY name",
			),
		).toEqual([
			{ name: 'Merge', effort: 'low' },
			{ name: 'Open draft', effort: 'low' },
			{ name: 'Update from main', effort: 'low' },
		]);
		expect(
			all(
				db,
				'SELECT id, definition_id, workstream_id, repository_id, origin, status, context FROM job_runs ORDER BY id',
			),
		).toEqual([
			{
				id: 'held',
				definition_id: 'log',
				workstream_id: 'w',
				repository_id: 'p',
				origin: 'trigger',
				status: 'waiting',
				context: '{"event":"app:updated","payload":{"to":"1.2.0"}}',
			},
			{
				id: 'past',
				definition_id: 'log',
				workstream_id: 'w',
				repository_id: null,
				origin: 'trigger',
				status: 'succeeded',
				context: null,
			},
		]);
		expect(all(db, 'SELECT id FROM job_suggestions')).toEqual([{ id: 'idea' }]);
		expect(all(db, 'SELECT id FROM agent_permission_rules')).toEqual([{ id: 'save-jobs' }]);
		expect(appTables(db)).toEqual(ALL_TABLES);
		expect(indexNames(db)).toEqual(ALL_INDEXES);

		db.exec("DELETE FROM job_definitions WHERE id = 'b'");
		expect(scalar(db, "SELECT then_job_id IS NULL FROM job_definitions WHERE id = 'a'")).toBe(1);
		expect(() => db.exec("UPDATE job_definitions SET then_job_id = 'c' WHERE id = 'c'")).toThrow();
		expect(() =>
			db.exec("UPDATE job_definitions SET trigger_when = 'on app:updated' WHERE id = 'c'"),
		).toThrow();
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
