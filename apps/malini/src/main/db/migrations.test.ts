import { describe, expect, it } from 'vitest';
import { diagnosticsRecordedDuring } from '../diagnostics/test-support';
import { openMigratedDatabase } from './open';
import { openDatabase } from './driver';
import {
	BASELINE_USER_VERSION,
	MIGRATIONS,
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
	'agent_deliveries',
	'agent_event_packs',
	'agent_events',
	'agent_interactions',
	'agent_permission_rules',
	'agent_run_change_files',
	'agent_run_changes',
	'agent_run_tool_calls',
	'agent_runs',
	'agent_session_changes',
	'agent_sessions',
	'agent_user_baselines',
	'alarms',
	'automation_asks',
	'automation_definitions',
	'automation_experiment_results',
	'automation_experiment_samples',
	'automation_experiments',
	'automation_outputs',
	'automation_run_events',
	'automation_runs',
	'automation_setups',
	'automation_suggestions',
	'brain_captures',
	'chatgpt_account',
	'connected_repositories',
	'custom_sounds',
	'docker_containers',
	'event_log',
	'hidden_repositories',
	'installed_extensions',
	'lead_decisions',
	'mcp_server_folder_offs',
	'mcp_server_listings',
	'model_providers',
	'projects',
	'reconciler_decisions',
	'scratchpads',
	'secret_requests',
	'secrets',
	'settings',
	'shell_runs',
	'skill_choices',
	'workstream_commit_runs',
	'workstream_opened_files',
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
	'idx_agent_deliveries_from',
	'idx_agent_deliveries_waiting',
	'idx_agent_events_run',
	'idx_agent_events_session_seq',
	'idx_agent_interactions_pending',
	'idx_agent_permission_rules_active_everywhere',
	'idx_agent_permission_rules_active_repository',
	'idx_agent_permission_rules_active_session',
	'idx_agent_permission_rules_active_workstream',
	'idx_agent_permission_rules_effective',
	'idx_agent_run_changes_captured',
	'idx_agent_runs_chain',
	'idx_agent_runs_session_first_seq',
	'idx_agent_runs_session_obsoleted',
	'idx_agent_sessions_workstream_archived_started',
	'idx_agent_user_baselines_run',
	'idx_agent_user_baselines_workstream_created',
	'idx_alarms_due',
	'idx_automation_asks_repository',
	'idx_automation_experiments_definition',
	'idx_automation_outputs_definition_created',
	'idx_automation_run_events_event',
	'idx_automation_runs_chain',
	'idx_automation_runs_chat_session',
	'idx_automation_runs_definition_origin',
	'idx_automation_runs_parent',
	'idx_automation_runs_session',
	'idx_automation_runs_status_created',
	'idx_automation_setups_definition_created',
	'idx_automation_suggestions_session',
	'idx_docker_containers_bundle_released',
	'idx_docker_containers_project_service',
	'idx_event_log_cause',
	'idx_event_log_chain',
	'idx_event_log_emitted',
	'idx_event_log_unhandled',
	'idx_event_log_workstream_channel',
	'idx_lead_decisions_session',
	'idx_reconciler_decisions_chain',
	'idx_reconciler_decisions_created',
	'idx_reconciler_decisions_event',
	'idx_reconciler_decisions_open',
	'idx_secret_requests_session',
	'idx_shell_runs_anchor',
	'idx_shell_runs_session',
	'idx_workstreams_started_by',
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

	it('seeds DeepSeek, OpenCode and ChatGPT and defaults chats and jobs to Claude', () => {
		const db = openMigratedDatabase(':memory:');
		expect(
			all(
				db,
				'SELECT id, name, kind, base_url, subagent_model, api_key, plan FROM model_providers',
			),
		).toEqual([
			{
				id: 'deepseek',
				name: 'DeepSeek',
				kind: 'anthropic',
				base_url: 'https://api.deepseek.com/anthropic',
				subagent_model: 'deepseek-flash',
				api_key: null,
				plan: null,
			},
			{
				id: 'opencode',
				name: 'OpenCode',
				kind: 'anthropic',
				base_url: 'https://opencode.ai/inference/anthropic',
				subagent_model: null,
				api_key: null,
				plan: null,
			},
			{
				id: 'opencode-go',
				name: 'OpenCode Go',
				kind: 'anthropic',
				base_url: 'https://opencode.ai/inference/go/anthropic',
				subagent_model: null,
				api_key: null,
				plan: null,
			},
			{
				id: 'chatgpt',
				name: 'ChatGPT',
				kind: 'chatgpt',
				base_url: 'https://api.openai.com/v1',
				subagent_model: null,
				api_key: null,
				plan: null,
			},
		]);
		expect(
			JSON.parse(
				get<{ models: string }>(db, "SELECT models FROM model_providers WHERE id = 'opencode-go'")
					?.models ?? '',
			),
		).toContainEqual({
			id: 'hy4',
			label: 'Hy4',
			description: 'Text and images, 1M context',
			efforts: ['high'],
			family: 'Hy',
		});
		expect(
			JSON.parse(
				get<{ models: string }>(db, "SELECT models FROM model_providers WHERE id = 'opencode'")
					?.models ?? '',
			),
		).toContainEqual({
			id: 'claude-opus-5-5',
			label: 'Opus 5.5',
			description: 'Text and images, 1M context',
			efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
			family: 'claude-opus',
		});
		expect(
			JSON.parse(
				get<{ models: string }>(db, "SELECT models FROM model_providers WHERE id = 'deepseek'")
					?.models ?? '',
			),
		).toEqual([
			{
				id: 'deepseek-flash',
				label: 'DeepSeek V4.1 Flash',
				description: 'Text and images, 1M context',
				efforts: ['low', 'high', 'max'],
				family: 'deepseek-flash',
			},
			{
				id: 'deepseek-v4-pro',
				label: 'DeepSeek V4 Pro',
				description: 'Text only, 1M context',
				efforts: ['low', 'high', 'max'],
				family: 'deepseek-thinking',
			},
		]);
		for (const table of [
			'agent_sessions',
			'automation_definitions',
			'automation_setups',
			'automation_experiments',
		]) {
			expect(
				all(
					db,
					`SELECT name, dflt_value FROM pragma_table_info('${table}') WHERE name = 'provider'`,
				),
			).toEqual([{ name: 'provider', dflt_value: "'claude'" }]);
		}
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

	it('opens a database from a newer release untouched, and records the downgrade as an error', () => {
		const db = openDatabase(':memory:');
		db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			PRAGMA user_version = ${TARGET_USER_VERSION + 1};`);
		expect(diagnosticsRecordedDuring(() => migrate(db))).toEqual([
			expect.objectContaining({
				level: 'error',
				message: `malini: database schema ${TARGET_USER_VERSION + 1} is newer than this build's ${TARGET_USER_VERSION}`,
			}),
		]);
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
			all(db, 'SELECT id, skills FROM automation_definitions WHERE builtin IS NULL ORDER BY id'),
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

	it('records which workstream started each one from the agent calls that started them', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const startedBy = MIGRATIONS.findIndex((migration) =>
			migration.includes('ADD COLUMN started_by'),
		);
		for (const migration of MIGRATIONS.slice(0, startedBy)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + startedBy};`);
		seedWorkstream(db);
		const stream = (id: string) =>
			`('${id}', 'p', '${id}', '/tmp/${id}', 'malini/${id}', 'main', 'active', '2026-10-20T00:00:00Z')`;
		const call = (id: string, from: string, status: string, output: string) =>
			`('${id}', 's', 'r', '${from}', 'workstreams_create', '{}', '${status}', 'allowed', '${output}', '2026-10-20T00:00:00Z', '2026-10-20T00:00:01Z')`;
		db.exec(`
			INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at) VALUES
			  ${['child', 'orphan', 'failed', 'garbled'].map(stream).join(', ')};
			INSERT INTO agent_actions (id, session_id, run_id, workstream_id, tool, input_json, status, approval, output, started_at, finished_at) VALUES
			  ${call('a1', 'w', 'succeeded', '{"id":"child","chat":"sess-1"}')},
			  ${call('a2', 'gone', 'succeeded', '{"id":"orphan"}')},
			  ${call('a3', 'w', 'failed', 'Malini is still cloning')},
			  ${call('a4', 'w', 'succeeded', 'not json')};
		`);

		migrate(db);

		expect(all(db, 'SELECT id, started_by, scope FROM workstreams ORDER BY id')).toEqual([
			{ id: 'child', started_by: 'w', scope: null },
			{ id: 'failed', started_by: null, scope: null },
			{ id: 'garbled', started_by: null, scope: null },
			{ id: 'orphan', started_by: null, scope: null },
			{ id: 'w', started_by: null, scope: null },
		]);
		db.exec("UPDATE workstreams SET scope = 'owner:bestboyhq' WHERE id = 'w'");
		expect(() => db.exec("UPDATE workstreams SET scope = 'owner:' WHERE id = 'w'")).toThrow();
		db.exec("DELETE FROM workstreams WHERE id = 'w'");
		expect(get(db, "SELECT started_by FROM workstreams WHERE id = 'child'")).toEqual({
			started_by: null,
		});
		db.close();
	});

	it('keeps every job run, and lets a run come from a schedule and name the lead it starts', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const chains = MIGRATIONS.findIndex((migration) => migration.includes('WITH RECURSIVE chains'));
		for (const migration of MIGRATIONS.slice(0, chains)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + chains};`);
		db.exec(`
			INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, created_at, updated_at)
			  VALUES ('job', 'Triage', 'Triage.', 'opus', 'low', 'workstream', '2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z');
			INSERT INTO job_runs (id, definition_id, title, origin, status, context, created_at) VALUES
			  ('first', 'job', 'Triage', 'trigger', 'succeeded', '{}', '2026-10-20T00:00:00Z');
			INSERT INTO job_runs (id, definition_id, title, origin, status, parent_run_id, created_at) VALUES
			  ('next', 'job', 'Triage', 'then', 'queued', 'first', '2026-10-20T00:00:01Z');
		`);

		migrate(db);

		expect(
			all(
				db,
				'SELECT id, origin, context, parent_run_id, scope, chain_id, requests FROM automation_runs ORDER BY id',
			),
		).toEqual([
			{
				id: 'first',
				origin: 'trigger',
				context: '{}',
				parent_run_id: null,
				scope: null,
				chain_id: 'first',
				requests: 1,
			},
			{
				id: 'next',
				origin: 'then',
				context: null,
				parent_run_id: 'first',
				scope: null,
				chain_id: 'first',
				requests: 1,
			},
		]);
		const scheduled = (id: string, scope: string) =>
			`INSERT INTO automation_runs (id, definition_id, title, origin, status, scope, chain_id, created_at)
			 VALUES ('${id}', 'job', 'Triage', 'schedule', 'waiting', '${scope}', '${id}', '2026-10-21T00:00:00Z')`;
		db.exec(scheduled('home', 'home'));
		db.exec(scheduled('owner', 'owner:bestboyhq'));
		expect(() => db.exec(scheduled('nowhere', 'owner:'))).toThrow();
		expect(() => db.exec(scheduled('elsewhere', 'repository:malini'))).toThrow();
		db.exec("DELETE FROM automation_runs WHERE id = 'first'");
		expect(get(db, "SELECT parent_run_id FROM automation_runs WHERE id = 'next'")).toEqual({
			parent_run_id: null,
		});
		db.close();
	});

	it('marks a run that failed with an interruption as interrupted, and no other run', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const boundary = MIGRATIONS.findIndex((migration) => migration.includes('interrupted INTEGER'));
		for (const migration of MIGRATIONS.slice(0, boundary)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + boundary};`);
		const at = '2026-11-01T00:00:00Z';
		const ended = (id: string, status: string, detail: string) =>
			`INSERT INTO automation_runs (id, definition_id, title, origin, status, detail, chain_id, created_at)
			 VALUES ('${id}', 'job', 'Triage', 'manual', '${status}', '${detail}', '${id}', '${at}');`;
		db.exec(`
			INSERT INTO automation_definitions (id, name, instructions, model, effort, runs_in, builtin, created_at, updated_at)
			  VALUES ('job', 'Triage', 'Triage.', 'opus', 'low', 'workstream', NULL, '${at}', '${at}');
			${ended('closed', 'failed', 'Interrupted when Malini closed')}
			${ended('bridge', 'failed', 'interrupted: agent bridge restarted')}
			${ended('broken', 'failed', 'tests fail')}
			${ended('done', 'succeeded', 'Interrupted when Malini closed')}
		`);

		migrate(db);

		expect(all(db, 'SELECT id, interrupted FROM automation_runs ORDER BY id')).toEqual([
			{ id: 'bridge', interrupted: 1 },
			{ id: 'broken', interrupted: 0 },
			{ id: 'closed', interrupted: 1 },
			{ id: 'done', interrupted: 0 },
		]);
		db.close();
	});

	it('turns the internet off for every job you made, and keeps it on for the built-in ones', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const boundary = MIGRATIONS.findIndex((migration) => migration.includes('reaches_internet'));
		for (const migration of MIGRATIONS.slice(0, boundary)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + boundary};`);
		const at = '2026-11-01T00:00:00Z';
		db.exec(`
			INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, builtin, created_at, updated_at) VALUES
			  ('mine', 'Triage', 'Triage.', 'opus', 'low', 'workstream', NULL, '${at}', '${at}'),
			  ('fix', 'Fix checks', 'Fix.', 'opus', 'low', 'workstream', 'fix-checks', '${at}', '${at}');
		`);

		migrate(db);

		expect(
			all(
				db,
				"SELECT id, reaches_internet FROM automation_definitions WHERE id IN ('fix', 'mine') ORDER BY id",
			),
		).toEqual([
			{ id: 'fix', reaches_internet: 1 },
			{ id: 'mine', reaches_internet: 0 },
		]);
		db.close();
	});

	it('lets a run come from the Compatibility rule, and keeps every run and the events that started it', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const origin = MIGRATIONS.findIndex((migration) => migration.includes("'compatibility'"));
		for (const migration of MIGRATIONS.slice(0, origin)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + origin};`);
		const at = '2026-10-27T00:00:00Z';
		db.exec(`
			INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, builtin, created_at, updated_at) VALUES
			  ('job', 'Triage', 'Triage.', 'opus', 'low', 'workstream', NULL, '${at}', '${at}'),
			  ('pick', 'Reconcile events', 'Pick one.', 'haiku', 'low', 'workstream', 'reconcile', '${at}', '${at}');
			INSERT INTO job_runs (id, definition_id, title, origin, status, chain_id, requests, created_at) VALUES
			  ('first', 'job', 'Triage', 'trigger', 'succeeded', 'chain', 2, '${at}');
			INSERT INTO job_runs (id, definition_id, title, origin, status, parent_run_id, chain_id, created_at) VALUES
			  ('next', 'job', 'Triage', 'then', 'queued', 'first', 'chain', '${at}');
			INSERT INTO job_run_events (job_run_id, event_id) VALUES ('first', 7), ('next', 8);
			INSERT INTO settings (key, value) VALUES ('jobs.reconciler', 'off'), ('jobs.max-concurrent', '4');
		`);
		const runs = all(db, 'SELECT * FROM job_runs ORDER BY id');

		migrate(db);

		expect(all(db, 'SELECT * FROM automation_runs ORDER BY id')).toEqual(
			runs.map((row) => ({ ...row, interrupted: 0 })),
		);
		expect(
			all(db, 'SELECT automation_run_id, event_id FROM automation_run_events ORDER BY event_id'),
		).toEqual([
			{ automation_run_id: 'first', event_id: 7 },
			{ automation_run_id: 'next', event_id: 8 },
		]);
		expect(get(db, "SELECT name FROM automation_definitions WHERE id = 'pick'")).toEqual({
			name: 'Choose a reaction',
		});
		expect(
			all(
				db,
				"SELECT key FROM settings WHERE key IN ('jobs.reconciler', 'automations.max-concurrent')",
			),
		).toEqual([{ key: 'automations.max-concurrent' }]);
		db.exec(`INSERT INTO automation_runs (id, definition_id, title, origin, status, chain_id, created_at)
			VALUES ('check', 'job', 'Check compatibility', 'compatibility', 'queued', 'check', '${at}')`);
		expect(() =>
			db.exec(`INSERT INTO automation_runs (id, definition_id, title, origin, status, chain_id, created_at)
				VALUES ('odd', 'job', 'Odd', 'elsewhere', 'queued', 'odd', '${at}')`),
		).toThrow();
		db.exec("DELETE FROM automation_runs WHERE id = 'first'");
		expect(get(db, "SELECT parent_run_id FROM automation_runs WHERE id = 'next'")).toEqual({
			parent_run_id: null,
		});
		expect(all(db, 'SELECT automation_run_id FROM automation_run_events')).toEqual([
			{ automation_run_id: 'next' },
		]);
		db.close();
	});

	it('lets an event be the cause of another, keeping every event and its id, and turns on Resolve conflicts on a conflict', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const rebuilt = MIGRATIONS.findIndex((migration) => migration.includes('event_log_next'));
		for (const migration of MIGRATIONS.slice(0, rebuilt)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + rebuilt};`);
		const at = '2026-10-28T11:09:32.707Z';
		db.exec(`
			INSERT INTO event_log (id, channel, payload, workstream_id, cause_kind, cause_id, chain_id, emitted_at, handled_at)
			  VALUES (18147, 'pull-requests:pull-request-changed', '{}', 'w', 'job-run', 'run', 'chain', '${at}', '${at}'),
			         (18148, 'repositories:workstream-merge-conflicted', '{}', 'w', NULL, NULL, 'own', '${at}', NULL);
			DELETE FROM event_log WHERE id = 18148;
			INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, builtin, created_at, updated_at) VALUES
			  ('resolve', 'Resolve conflicts', 'Resolve.', 'opus', 'high', 'workstream', 'resolve-conflicts', '${at}', '${at}'),
			  ('fix', 'Fix checks', 'Fix.', 'opus', 'medium', 'workstream', 'fix-checks', '${at}', '${at}');
		`);
		const events = all<Record<string, unknown>>(db, 'SELECT * FROM event_log ORDER BY id');

		migrate(db);

		expect(all(db, 'SELECT * FROM event_log ORDER BY id')).toEqual(
			events.map((event) => ({ ...event, cause_kind: 'automation-run' })),
		);
		db.exec(`INSERT INTO event_log (channel, payload, workstream_id, cause_kind, cause_id, chain_id, emitted_at)
			VALUES ('repositories:workstream-merge-conflicted', '{}', 'w', 'event', '18147', 'chain', '${at}')`);
		expect(get(db, 'SELECT MAX(id) AS id FROM event_log')).toEqual({ id: 18149 });
		expect(() =>
			db.exec(`INSERT INTO event_log (channel, payload, cause_kind, cause_id, chain_id, emitted_at)
				VALUES ('app:started', '{}', 'elsewhere', 'x', 'chain', '${at}')`),
		).toThrow();
		expect(
			all(
				db,
				"SELECT id, trigger_when, trigger_mode FROM automation_definitions WHERE id IN ('fix', 'resolve') ORDER BY id",
			),
		).toEqual([
			{ id: 'fix', trigger_when: null, trigger_mode: null },
			{
				id: 'resolve',
				trigger_when: 'on repositories:workstream-merge-conflicted',
				trigger_mode: 'auto',
			},
		]);
		db.close();
	});

	it('forgets when to update from main before a merge, and the updates still pending, keeping the rest of shipping', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const dropped = MIGRATIONS.findIndex((migration) =>
			migration.includes('DROP COLUMN update_requests'),
		);
		for (const migration of MIGRATIONS.slice(0, dropped)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + dropped};`);
		seedWorkstream(db);
		db.exec(`
			INSERT INTO workstream_ship (workstream_id, phase, push_requests, update_requests, review_requests, updated_at)
			  VALUES ('w', 'draft', 1, 2, 3, '2026-10-27T00:00:00Z');
			INSERT INTO settings (key, value) VALUES
			  ('merge-queue.update-from-main', 'main-moves'), ('merge-queue.fix-attempts', '5');
		`);

		migrate(db);

		expect(get(db, 'SELECT phase, push_requests, review_requests FROM workstream_ship')).toEqual({
			phase: 'draft',
			push_requests: 1,
			review_requests: 3,
		});
		expect(
			all(
				db,
				"SELECT name FROM pragma_table_info('workstream_ship') WHERE name = 'update_requests'",
			),
		).toEqual([]);
		expect(all(db, "SELECT key FROM settings WHERE key LIKE 'merge-queue.%'")).toEqual([
			{ key: 'merge-queue.fix-attempts' },
		]);
		db.close();
	});

	it('keeps the fix attempts a merge spent on its current failure in one count per failure', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const counted = MIGRATIONS.findIndex((migration) =>
			migration.includes('ADD COLUMN fix_attempts'),
		);
		for (const migration of MIGRATIONS.slice(0, counted)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + counted};`);
		seedWorkstream(db);
		db.exec(`
			INSERT INTO workstream_ship (workstream_id, phase, failure_signature, attempts, checks_rerun_at, checks_rerun_head_sha, updated_at)
			  VALUES ('w', 'queued', 'checks:["test"]', 2, '2026-11-01T00:00:00Z', 'abc', '2026-11-01T00:00:00Z');
		`);

		migrate(db);

		expect(
			get(db, 'SELECT fix_attempts, checks_rerun_at, checks_rerun_head_sha FROM workstream_ship'),
		).toEqual({
			fix_attempts: JSON.stringify({ 'checks:["test"]': 2 }),
			checks_rerun_at: null,
			checks_rerun_head_sha: null,
		});
		expect(
			all(db, "SELECT name FROM pragma_table_info('workstream_ship') WHERE name = 'attempts'"),
		).toEqual([]);
		db.close();
	});

	it('turns on Update from main when main overlaps a workstream, keeping a trigger you set', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const armed = MIGRATIONS.findIndex((migration) =>
			migration.includes("builtin = 'update-from-main' AND trigger_when IS NULL"),
		);
		for (const migration of MIGRATIONS.slice(0, armed)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + armed};`);
		const at = '2026-10-31T00:00:00Z';
		db.exec(`
			INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, builtin, trigger_when, trigger_mode, created_at, updated_at) VALUES
			  ('main', 'Update from main', 'Merge.', 'opus', 'low', 'workstream', 'update-from-main', NULL, NULL, '${at}', '${at}'),
			  ('fix', 'Fix checks', 'Fix.', 'opus', 'high', 'workstream', 'fix-checks', NULL, NULL, '${at}', '${at}');
		`);
		const other = openDatabase(':memory:');
		other.exec(SCHEMA);
		for (const migration of MIGRATIONS.slice(0, armed)) other.exec(migration);
		other.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + armed};`);
		other.exec(`
			INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, builtin, trigger_when, trigger_mode, created_at, updated_at) VALUES
			  ('main', 'Update from main', 'Merge.', 'opus', 'low', 'workstream', 'update-from-main', 'on repositories:workstream-merge-conflicted', 'ask', '${at}', '${at}');
		`);

		migrate(db);
		migrate(other);

		expect(
			all(
				db,
				"SELECT id, trigger_when, trigger_mode FROM automation_definitions WHERE id IN ('main', 'fix') ORDER BY id",
			),
		).toEqual([
			{ id: 'fix', trigger_when: null, trigger_mode: null },
			{
				id: 'main',
				trigger_when: 'on repositories:workstream-base-overlapped where overlapping is true',
				trigger_mode: 'auto',
			},
		]);
		expect(
			all(other, "SELECT trigger_when, trigger_mode FROM automation_definitions WHERE id = 'main'"),
		).toEqual([
			{ trigger_when: 'on repositories:workstream-merge-conflicted', trigger_mode: 'ask' },
		]);
		db.close();
		other.close();
	});

	it('keeps Update from main on files you touch once the event fires for every workstream behind', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const overlapping = MIGRATIONS.findIndex((migration) =>
			migration.includes("'on repositories:workstream-base-overlapped where overlapping is true'"),
		);
		for (const migration of MIGRATIONS.slice(0, overlapping)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + overlapping};`);
		const at = '2026-11-01T00:00:00Z';
		db.exec(`
			INSERT INTO automation_definitions (id, name, instructions, model, effort, runs_in, builtin, trigger_when, trigger_mode, created_at, updated_at) VALUES
			  ('main', 'Update from main', 'Merge.', 'opus', 'low', 'workstream', 'update-from-main', 'on repositories:workstream-base-overlapped', 'off', '${at}', '${at}'),
			  ('mine', 'Rebase', 'Rebase.', 'opus', 'low', 'workstream', NULL, 'on repositories:workstream-base-overlapped', 'auto', '${at}', '${at}');
		`);

		migrate(db);

		expect(
			all(
				db,
				"SELECT id, trigger_when, trigger_mode FROM automation_definitions WHERE id IN ('main', 'mine') ORDER BY id",
			),
		).toEqual([
			{
				id: 'main',
				trigger_when: 'on repositories:workstream-base-overlapped where overlapping is true',
				trigger_mode: 'off',
			},
			{
				id: 'mine',
				trigger_when: 'on repositories:workstream-base-overlapped',
				trigger_mode: 'auto',
			},
		]);
		db.close();
	});

	it('lets a chat be a thread from a page, keeping every chat and what hangs off it', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const rebuilt = MIGRATIONS.findIndex((migration) => migration.includes('agent_sessions_next'));
		for (const migration of MIGRATIONS.slice(0, rebuilt)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + rebuilt};`);
		seedWorkstream(db);
		db.exec(`
			INSERT INTO agent_sessions (id, workstream_id, model, status, started_at, display_name, origin)
			  VALUES ('s', 'w', 'claude-opus-5-5', 'completed', '2026-10-27T00:00:00Z', 'Chat', 'job');
			INSERT INTO agent_runs (id, session_id, prompt, started_at) VALUES ('r', 's', 'hi', '2026-10-27T00:00:00Z');
			INSERT INTO agent_events (session_id, run_id, event, emitted_at) VALUES ('s', 'r', 'user.message' || char(10) || '{}', '2026-10-27T00:00:00Z');
			INSERT INTO agent_event_packs (session_id, events) VALUES ('s', x'00');
		`);

		migrate(db);

		expect(get(db, 'SELECT origin, display_name, status FROM agent_sessions')).toEqual({
			origin: 'automation',
			display_name: 'Chat',
			status: 'completed',
		});
		expect(scalar(db, 'SELECT count(*) FROM agent_runs')).toBe(1);
		expect(scalar(db, 'SELECT count(*) FROM agent_events')).toBe(1);
		expect(scalar(db, 'SELECT count(*) FROM agent_event_packs')).toBe(1);
		expect(all(db, 'PRAGMA foreign_key_check')).toEqual([]);
		expect(scalar(db, 'PRAGMA foreign_keys')).toBe(1);
		db.exec(
			"INSERT INTO agent_sessions (id, workstream_id, status, started_at, origin) VALUES ('t', 'w', 'idle', '2026-10-28T00:00:00Z', 'thread')",
		);
		expect(() =>
			db.exec(
				"INSERT INTO agent_sessions (id, workstream_id, status, started_at, origin) VALUES ('x', 'w', 'idle', '2026-10-28T00:00:00Z', 'nonsense')",
			),
		).toThrow();
		db.exec("DELETE FROM agent_event_packs WHERE session_id = 's'");
		expect(() => db.exec("DELETE FROM agent_sessions WHERE id = 's'")).toThrow();
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
			get<{ id: string }>(db, 'SELECT id FROM automation_definitions WHERE builtin = ?', builtin)
				?.id;
		expect(
			all(
				db,
				`SELECT id, trigger_when, trigger_mode, then_automation_id FROM automation_definitions
				 WHERE builtin IS NULL OR builtin = 'update-docs' ORDER BY id`,
			),
		).toEqual([
			{
				id: 'a',
				trigger_when: 'on repositories:workstream-created',
				trigger_mode: 'ask',
				then_automation_id: 'b',
			},
			{ id: 'b', trigger_when: null, trigger_mode: null, then_automation_id: 'c' },
			{ id: 'c', trigger_when: null, trigger_mode: null, then_automation_id: null },
			{
				id: 'docs',
				trigger_when: null,
				trigger_mode: null,
				then_automation_id: builtinId('open-draft'),
			},
			{
				id: 'log',
				trigger_when: 'on pull-requests:ship-changed where merged is set',
				trigger_mode: 'auto',
				then_automation_id: builtinId('merge'),
			},
			{ id: 'manual', trigger_when: null, trigger_mode: null, then_automation_id: null },
		]);
		expect(
			all(
				db,
				"SELECT name, effort FROM automation_definitions WHERE builtin IN ('open-draft', 'merge', 'update-from-main') ORDER BY name",
			),
		).toEqual([
			{ name: 'Merge', effort: 'low' },
			{ name: 'Open draft', effort: 'low' },
			{ name: 'Update from main', effort: 'low' },
		]);
		expect(
			all(
				db,
				'SELECT id, definition_id, workstream_id, repository_id, origin, status, context FROM automation_runs ORDER BY id',
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
		expect(all(db, 'SELECT id FROM automation_suggestions')).toEqual([]);
		expect(all(db, 'SELECT id FROM agent_permission_rules')).toEqual([{ id: 'save-jobs' }]);
		expect(appTables(db)).toEqual(ALL_TABLES);
		expect(indexNames(db)).toEqual(ALL_INDEXES);

		db.exec("DELETE FROM automation_definitions WHERE id = 'b'");
		expect(
			scalar(db, "SELECT then_automation_id IS NULL FROM automation_definitions WHERE id = 'a'"),
		).toBe(1);
		expect(() =>
			db.exec("UPDATE automation_definitions SET then_automation_id = 'c' WHERE id = 'c'"),
		).toThrow();
		expect(() =>
			db.exec("UPDATE automation_definitions SET trigger_when = 'on app:updated' WHERE id = 'c'"),
		).toThrow();
		db.close();
	});

	it('renames jobs to automations, keeping every automation, run, event and decision', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		const renamed = MIGRATIONS.findIndex((migration) =>
			migration.includes('ALTER TABLE job_definitions RENAME TO automation_definitions'),
		);
		for (const migration of MIGRATIONS.slice(0, renamed)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + renamed};`);
		seedWorkstream(db);
		const at = '2026-11-01T00:00:00Z';
		const grant = (id: string, value: string) =>
			`('${id}', 'everywhere', NULL, NULL, '${id.padEnd(64, '0')}', '{"capability":"execute","resources":[{"kind":"action","value":"${value}","boundary":"everywhere"}]}', 'request', '${at}')`;
		db.exec(`
			INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, builtin, trigger_when, trigger_mode, then_job_id, created_at, updated_at) VALUES
			  ('mine', 'Mine', 'List them with mcp__malini__jobs_list, then call jobs_run.', 'opus', 'high', 'workstream', NULL, 'on jobs:run-finished where run.status is failed', 'ask', 'fix', '${at}', '${at}'),
			  ('fix', 'Fix checks', 'Malini re-runs a failed GitHub Actions check once before this job starts.', 'opus', 'high', 'workstream', 'fix-checks', NULL, NULL, NULL, '${at}', '${at}');
			INSERT INTO job_runs (id, definition_id, title, workstream_id, origin, status, chain_id, created_at) VALUES
			  ('run', 'mine', 'Mine', 'w', 'trigger', 'succeeded', 'chain', '${at}');
			INSERT INTO job_run_events (job_run_id, event_id) VALUES ('run', 1);
			INSERT INTO agent_sessions (id, workstream_id, status, started_at, origin) VALUES ('s', 'w', 'completed', '${at}', 'job');
			INSERT INTO event_log (id, channel, payload, workstream_id, cause_kind, cause_id, chain_id, emitted_at) VALUES
			  (1, 'jobs:run-finished', '{"run":{"id":"run","thenJobId":null},"needsYou":{"jobRunId":"run"}}', 'w', 'job-run', 'run', 'chain', '${at}');
			INSERT INTO reconciler_decisions (id, event_id, channel, chain_id, facts, candidates, chosen, decided_by, status, job_run_id, created_at, finished_at) VALUES
			  ('d', 1, 'jobs:run-finished', 'chain', '[]', '[{"kind":"run-job","label":"Run Mine","definitionId":"mine","workstreamId":"w","context":""},{"kind":"wake-chat","label":"Wake","about":"job"}]', 0, 'rules', 'done', 'run', '${at}', '${at}');
			INSERT INTO workstream_ship (workstream_id, phase, active_job_run_id, updated_at) VALUES ('w', 'queued', 'run', '${at}');
			INSERT INTO settings (key, value) VALUES ('jobs.max-concurrent', '3');
			INSERT INTO agent_actions (id, session_id, run_id, tool, input_json, status, approval, started_at, finished_at) VALUES
			  ('a', 's', 'r', 'jobs_run', '{}', 'succeeded', 'allowed', '${at}', '${at}');
			INSERT INTO agent_permission_rules (id, scope, workstream_id, session_id, permission_fingerprint, permission_json, created_request_id, created_at) VALUES
			  ${grant('old', 'jobs.save')}, ${grant('kept', 'pull-requests.merge')};
		`);

		migrate(db);

		expect(
			all(
				db,
				"SELECT id, instructions, trigger_when, then_automation_id FROM automation_definitions WHERE id IN ('fix', 'mine') ORDER BY id",
			),
		).toEqual([
			{
				id: 'fix',
				instructions:
					'Malini re-runs a failed GitHub Actions check once before this automation starts.',
				trigger_when: null,
				then_automation_id: null,
			},
			{
				id: 'mine',
				instructions: 'List them with mcp__malini__automations_list, then call automations_run.',
				trigger_when: 'on automations:run-finished where run.status is failed',
				then_automation_id: 'fix',
			},
		]);
		expect(all(db, 'SELECT id, definition_id FROM automation_runs')).toEqual([
			{ id: 'run', definition_id: 'mine' },
		]);
		expect(all(db, 'SELECT automation_run_id FROM automation_run_events')).toEqual([
			{ automation_run_id: 'run' },
		]);
		expect(get(db, 'SELECT origin FROM agent_sessions')).toEqual({ origin: 'automation' });
		expect(get(db, 'SELECT channel, payload, cause_kind FROM event_log')).toEqual({
			channel: 'automations:run-finished',
			payload: '{"run":{"id":"run","thenAutomationId":null},"needsYou":{"automationRunId":"run"}}',
			cause_kind: 'automation-run',
		});
		expect(
			get(db, 'SELECT channel, candidates, automation_run_id FROM reconciler_decisions'),
		).toEqual({
			channel: 'automations:run-finished',
			candidates:
				'[{"kind":"run-automation","label":"Run Mine","definitionId":"mine","workstreamId":"w","context":""},{"kind":"wake-chat","label":"Wake","about":"automation"}]',
			automation_run_id: 'run',
		});
		expect(get(db, 'SELECT active_automation_run_id FROM workstream_ship')).toEqual({
			active_automation_run_id: 'run',
		});
		expect(get(db, "SELECT value FROM settings WHERE key = 'automations.max-concurrent'")).toEqual({
			value: '3',
		});
		expect(get(db, 'SELECT tool FROM agent_actions')).toEqual({ tool: 'automations_run' });
		expect(
			all(
				db,
				'SELECT id, revoked_at IS NOT NULL AS revoked FROM agent_permission_rules ORDER BY id',
			),
		).toEqual([
			{ id: 'kept', revoked: 0 },
			{ id: 'old', revoked: 1 },
		]);
		expect(all(db, 'PRAGMA foreign_key_check')).toEqual([]);
		db.exec("DELETE FROM automation_definitions WHERE id = 'mine'");
		expect(scalar(db, 'SELECT count(*) FROM automation_runs')).toBe(0);
		expect(() =>
			db.exec(
				"INSERT INTO agent_sessions (id, workstream_id, status, started_at, origin) VALUES ('j', 'w', 'idle', '${at}', 'job')",
			),
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

	it('counts the tool calls of each run, from the events before it and as new ones are written', () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION};`);
		seedWorkstream(db);
		db.exec(`
			INSERT INTO agent_sessions (id, workstream_id, status, started_at) VALUES ('s', 'w', 'idle', '2026-07-19T00:00:00Z');
			INSERT INTO agent_runs (id, session_id, prompt, started_at) VALUES
			  ('earlier', 's', 'go', '2026-07-19T00:00:01Z'),
			  ('later', 's', 'go', '2026-07-19T00:01:00Z');
			INSERT INTO agent_events (session_id, run_id, event, emitted_at) VALUES
			  ('s', 'earlier', 'tool.started' || char(10) || '{"name":"Bash","input":{}}', '2026-07-19T00:00:02Z'),
			  ('s', 'earlier', 'tool.started' || char(10) || '{"name":"Bash"}', '2026-07-19T00:00:03Z'),
			  ('s', 'earlier', 'tool.completed' || char(10) || '{"name":"Bash"}', '2026-07-19T00:00:04Z'),
			  ('s', 'earlier', 'tool.started' || char(10) || 'not json', '2026-07-19T00:00:05Z'),
			  ('s', 'earlier', 'tool.started' || char(10) || '{"name":"Skill","input":{"skill":"adr"}}', '2026-07-19T00:00:06Z');
		`);

		migrate(db);
		db.exec(`
			INSERT INTO agent_events (session_id, run_id, event, emitted_at) VALUES
			  ('s', 'later', 'tool.started' || char(10) || '{"input":{},"name":"mcp__malini__browser_open"}', '2026-07-19T00:01:01Z'),
			  ('s', 'later', 'tool.started' || char(10) || '{"name":"Read"}', '2026-07-19T00:01:02Z'),
			  ('s', 'later', 'tool.started' || char(10) || '{"name":"Read"}', '2026-07-19T00:01:03Z'),
			  ('s', 'later', 'tool.started' || char(10) || '{"toolCallId":"nameless"}', '2026-07-19T00:01:04Z'),
			  ('s', 'later', 'tool.started' || char(10) || '{"name":', '2026-07-19T00:01:05Z'),
			  ('s', 'later', 'tool.started' || char(10) || '{"name":"Skill","input":{"skill":"adr"}}', '2026-07-19T00:01:06Z'),
			  ('s', 'later', 'tool.started' || char(10) || '{"name":"Skill","input":{"skill":"svelte:svelte-code-writer"}}', '2026-07-19T00:01:07Z'),
			  ('s', 'later', 'tool.started' || char(10) || '{"name":"Read","input":{"skill":"not a skill call"}}', '2026-07-19T00:01:08Z');
		`);
		expect(
			all(
				db,
				'SELECT run_id, tool, skill, calls FROM agent_run_tool_calls ORDER BY run_id, tool, skill',
			),
		).toEqual([
			{ run_id: 'earlier', tool: 'Bash', skill: '', calls: 2 },
			{ run_id: 'earlier', tool: 'Skill', skill: 'adr', calls: 1 },
			{ run_id: 'later', tool: '', skill: '', calls: 1 },
			{ run_id: 'later', tool: 'Read', skill: '', calls: 3 },
			{ run_id: 'later', tool: 'Skill', skill: 'adr', calls: 1 },
			{ run_id: 'later', tool: 'Skill', skill: 'svelte:svelte-code-writer', calls: 1 },
			{ run_id: 'later', tool: 'mcp__malini__browser_open', skill: '', calls: 1 },
		]);

		db.exec("DELETE FROM agent_runs WHERE id = 'earlier'");
		expect(scalar(db, "SELECT COUNT(*) FROM agent_run_tool_calls WHERE run_id = 'earlier'")).toBe(
			0,
		);
		db.close();
	});

	it("keeps each run's tokens from its last final usage, from the events before it and as new ones are written", () => {
		const db = openDatabase(':memory:');
		db.exec(SCHEMA);
		db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION};`);
		seedWorkstream(db);
		db.exec(`
			INSERT INTO agent_sessions (id, workstream_id, status, started_at) VALUES ('s', 'w', 'idle', '2026-07-19T00:00:00Z');
			INSERT INTO agent_runs (id, session_id, prompt, started_at) VALUES
			  ('earlier', 's', 'go', '2026-07-19T00:00:01Z'),
			  ('later', 's', 'go', '2026-07-19T00:01:00Z'),
			  ('silent', 's', 'go', '2026-07-19T00:02:00Z');
			INSERT INTO agent_events (session_id, run_id, event, emitted_at) VALUES
			  ('s', 'earlier', 'usage.updated' || char(10) || '{"inputTokens":100,"outputTokens":7}', '2026-07-19T00:00:02Z'),
			  ('s', 'earlier', 'usage.updated' || char(10) || '{"inputTokens":250,"outputTokens":9,"interim":false}', '2026-07-19T00:00:03Z'),
			  ('s', 'earlier', 'usage.updated' || char(10) || '{"inputTokens":1,"interim":true}', '2026-07-19T00:00:04Z'),
			  ('s', 'earlier', 'usage.updated' || char(10) || 'not json', '2026-07-19T00:00:05Z');
		`);

		migrate(db);
		db.exec(`
			INSERT INTO agent_events (session_id, run_id, event, emitted_at) VALUES
			  ('s', 'later', 'usage.updated' || char(10) || '{"contextTokens":5,"interim":true}', '2026-07-19T00:01:01Z'),
			  ('s', 'later', 'usage.updated' || char(10) || '{"inputTokens":40}', '2026-07-19T00:01:02Z'),
			  ('s', 'later', 'usage.updated' || char(10) || '{"inputTokens":', '2026-07-19T00:01:03Z'),
			  ('s', 'silent', 'tool.started' || char(10) || '{"name":"Read"}', '2026-07-19T00:02:01Z');
		`);
		expect(all(db, 'SELECT id, input_tokens, output_tokens FROM agent_runs ORDER BY id')).toEqual([
			{ id: 'earlier', input_tokens: 250, output_tokens: 9 },
			{ id: 'later', input_tokens: 40, output_tokens: 0 },
			{ id: 'silent', input_tokens: 0, output_tokens: 0 },
		]);
		db.close();
	});

	it('renames the word-pair names to New workstream and updates Name chats unless you edited it', () => {
		const index = MIGRATIONS.findIndex((migration) => migration.includes("'New workstream'"));
		const sql = MIGRATIONS[index] ?? '';
		const quoted = (pattern: RegExp): string =>
			(pattern.exec(sql)?.[1] ?? '').replaceAll("''", "'");
		const before = quoted(/AND instructions = '((?:[^']|'')*)';/u);
		const after = quoted(/SET instructions = '((?:[^']|'')*)'/u);
		const migrated = (instructions: string): Database => {
			const db = openDatabase(':memory:');
			db.exec(SCHEMA);
			for (const migration of MIGRATIONS.slice(0, index)) db.exec(migration);
			db.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION + index};`);
			seedWorkstream(db);
			db.prepare(
				`INSERT INTO automation_definitions
				 (id, name, instructions, model, effort, runs_in, builtin, created_at, updated_at)
				 VALUES ('d', 'Name chats', ?, 'haiku', 'low', 'workstream', 'name-chats', '2026-07-19', '2026-07-19')`,
			).run(instructions);
			return db;
		};

		const db = migrated(before);
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at) VALUES ('q', 'q', '/tmp/q', 'main', '2026-07-19T00:00:00Z');
			INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at) VALUES
			  ('a', 'p', 'Electric Arc', '/tmp/a', 'malini/a', 'main', 'active', '2026-07-19T00:00:00Z'),
			  ('b', 'p', 'Swift Beacon 2', '/tmp/b', 'malini/b', 'main', 'active', '2026-07-19T00:00:00Z'),
			  ('c', 'p', 'Lunar Relay', '/tmp/c', 'malini/c', 'main', 'archived', '2026-07-19T00:00:00Z'),
			  ('d', 'p', 'Login bug', '/tmp/d', 'malini/d', 'main', 'active', '2026-07-19T00:00:00Z'),
			  ('e', 'q', 'Neon Pulse', '/tmp/e', 'malini/e', 'main', 'active', '2026-07-19T00:00:00Z');
		`);
		migrate(db);
		expect(all(db, 'SELECT id, name FROM workstreams ORDER BY id')).toEqual([
			{ id: 'a', name: 'New workstream' },
			{ id: 'b', name: 'New workstream 2' },
			{ id: 'c', name: 'New workstream' },
			{ id: 'd', name: 'Login bug' },
			{ id: 'e', name: 'New workstream' },
			{ id: 'w', name: 'w' },
		]);
		expect(get(db, "SELECT instructions FROM automation_definitions WHERE id = 'd'")).toEqual({
			instructions: after,
		});
		expect(after).toMatch(/^You name the work in a coding agent's chat/u);
		expect(before).toMatch(/^You name the tasks people give a coding agent/u);
		db.close();

		const edited = migrated('Name it after a fruit.');
		migrate(edited);
		expect(get(edited, "SELECT instructions FROM automation_definitions WHERE id = 'd'")).toEqual({
			instructions: 'Name it after a fruit.',
		});
		edited.close();
	});
});
