import type { MaliniDatabase } from './driver';
import { invariant } from '$main/errors';
import { all, scalar } from './rows';

export const TARGET_USER_VERSION = 54;

export const SCHEMA = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE workstreams (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paused','merged','archived')),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  archived_ref TEXT,
  merged_pull_request_number INTEGER,
  merged_pull_request_url TEXT
);

CREATE TABLE deleted_workstreams (
  id TEXT PRIMARY KEY
);

CREATE TABLE connected_repositories (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  local_path TEXT,
  remote_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE hidden_repositories (
  repository_id TEXT PRIMARY KEY,
  hidden_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle','running','waiting_for_approval','completed','failed')),
  started_at TEXT NOT NULL,
  provider_session_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  forked_from_session_id TEXT,
  fork_seq INTEGER,
  origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user','job'))
);
CREATE INDEX idx_agent_sessions_workstream_archived_started
  ON agent_sessions(workstream_id, archived_at, started_at DESC);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  prompt TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  summary TEXT,
  error TEXT,
  obsoleted_at TEXT,
  automated INTEGER NOT NULL DEFAULT 0,
  profile TEXT,
  event_bytes INTEGER NOT NULL DEFAULT 0,
  first_seq INTEGER,
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX idx_agent_runs_session_obsoleted ON agent_runs(session_id, obsoleted_at);
CREATE INDEX idx_agent_runs_session_first_seq ON agent_runs(session_id, first_seq);

CREATE TABLE agent_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event TEXT NOT NULL,
  emitted_at TEXT NOT NULL
);
CREATE INDEX idx_agent_events_session_seq ON agent_events(session_id, seq);
CREATE INDEX idx_agent_events_run ON agent_events(run_id);
CREATE TRIGGER agent_events_count_run_bytes AFTER INSERT ON agent_events BEGIN
  UPDATE agent_runs SET
    event_bytes = event_bytes + LENGTH(NEW.event),
    first_seq = COALESCE(first_seq, NEW.seq)
  WHERE id = NEW.run_id AND session_id = NEW.session_id;
END;
CREATE TRIGGER agent_events_recount_run_bytes AFTER UPDATE OF event ON agent_events BEGIN
  UPDATE agent_runs SET event_bytes = event_bytes - LENGTH(OLD.event) + LENGTH(NEW.event)
  WHERE id = NEW.run_id AND session_id = NEW.session_id;
END;

CREATE TABLE agent_checkpoints (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  run_id TEXT NOT NULL,
  user_message_seq INTEGER,
  git_ref TEXT NOT NULL UNIQUE,
  git_commit TEXT NOT NULL,
  created_at TEXT NOT NULL,
  obsoleted_at TEXT
);
CREATE INDEX idx_agent_checkpoints_session_seq
  ON agent_checkpoints(session_id, user_message_seq);
CREATE INDEX idx_agent_checkpoints_session_obsoleted
  ON agent_checkpoints(session_id, obsoleted_at);
CREATE INDEX idx_agent_checkpoints_workstream_created
  ON agent_checkpoints(workstream_id, created_at DESC);

CREATE TABLE agent_user_baselines (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  run_id TEXT NOT NULL,
  git_ref TEXT NOT NULL UNIQUE,
  git_commit TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_agent_user_baselines_run ON agent_user_baselines(run_id);
CREATE INDEX idx_agent_user_baselines_workstream_created
  ON agent_user_baselines(workstream_id, created_at DESC);

CREATE TABLE agent_run_changes (
  run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL REFERENCES agent_checkpoints(id) ON DELETE CASCADE,
  before_commit TEXT NOT NULL,
  after_commit TEXT NOT NULL,
  after_ref TEXT NOT NULL UNIQUE,
  captured_at TEXT NOT NULL
);
CREATE INDEX idx_agent_run_changes_captured ON agent_run_changes(captured_at, run_id);

CREATE TABLE agent_run_change_files (
  run_id TEXT NOT NULL REFERENCES agent_run_changes(run_id) ON DELETE CASCADE,
  path TEXT NOT NULL CHECK (length(path) > 0),
  additions INTEGER NOT NULL CHECK (additions >= 0),
  deletions INTEGER NOT NULL CHECK (deletions >= 0),
  is_binary INTEGER NOT NULL CHECK (is_binary IN (0, 1)),
  PRIMARY KEY (run_id, path)
);

CREATE TABLE agent_attachments (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
  run_id TEXT,
  display_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('staged','bound','removed','expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  bound_at TEXT,
  removed_at TEXT,
  CHECK (
    (state = 'bound' AND run_id IS NOT NULL AND bound_at IS NOT NULL AND expires_at IS NULL)
    OR
    (state != 'bound' AND run_id IS NULL AND bound_at IS NULL)
  ),
  UNIQUE(workstream_id, relative_path)
);
CREATE INDEX idx_agent_attachments_workstream_state_expiry
  ON agent_attachments(workstream_id, state, expires_at);
CREATE INDEX idx_agent_attachments_run ON agent_attachments(run_id);

CREATE TABLE agent_interactions (
  kind TEXT NOT NULL CHECK (kind IN ('approval', 'question')),
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_payload_json TEXT NOT NULL,
  permission_json TEXT,
  permission_fingerprint TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'dispatching', 'resolved', 'closed')),
  intended_response_json TEXT,
  response_json TEXT,
  decision TEXT CHECK (decision IN ('allow', 'deny', 'answered')),
  scope TEXT CHECK (scope IN ('once', 'session', 'workstream')),
  source TEXT CHECK (source IN ('manual', 'auto')),
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  closed_at TEXT,
  PRIMARY KEY (kind, session_id, run_id, request_id),
  CHECK (
    (state = 'pending' AND intended_response_json IS NULL AND response_json IS NULL
      AND decision IS NULL AND scope IS NULL AND source IS NULL AND decided_at IS NULL
      AND closed_at IS NULL)
    OR
    (state = 'dispatching' AND intended_response_json IS NOT NULL AND response_json IS NULL
      AND decision IS NULL AND scope IS NULL AND source IS NULL AND decided_at IS NULL
      AND closed_at IS NULL)
    OR
    (state = 'resolved' AND intended_response_json IS NOT NULL AND response_json IS NOT NULL
      AND decision IS NOT NULL AND source IS NOT NULL AND decided_at IS NOT NULL
      AND closed_at IS NULL)
    OR
    (state = 'closed' AND response_json IS NULL AND decision IS NULL AND scope IS NULL
      AND source IS NULL AND decided_at IS NULL AND closed_at IS NOT NULL)
  )
);
CREATE INDEX idx_agent_interactions_pending
  ON agent_interactions(session_id, run_id, state, kind);

CREATE TABLE agent_permission_rules (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('session', 'workstream')),
  workstream_id TEXT NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES agent_sessions(id) ON DELETE CASCADE,
  permission_fingerprint TEXT NOT NULL CHECK (length(permission_fingerprint) = 64),
  permission_json TEXT NOT NULL,
  created_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  CHECK (
    (scope = 'session' AND session_id IS NOT NULL)
    OR (scope = 'workstream' AND session_id IS NULL)
  )
);
CREATE UNIQUE INDEX idx_agent_permission_rules_active_session
  ON agent_permission_rules(session_id, permission_fingerprint)
  WHERE scope = 'session' AND revoked_at IS NULL;
CREATE UNIQUE INDEX idx_agent_permission_rules_active_workstream
  ON agent_permission_rules(workstream_id, permission_fingerprint)
  WHERE scope = 'workstream' AND revoked_at IS NULL;
CREATE INDEX idx_agent_permission_rules_effective
  ON agent_permission_rules(workstream_id, session_id, permission_fingerprint, revoked_at);

CREATE TABLE docker_containers (
  container_id TEXT PRIMARY KEY,
  container_name TEXT NOT NULL,
  bundle_identifier TEXT NOT NULL,
  app_instance_id TEXT NOT NULL,
  workstream_id TEXT,
  compose_project TEXT NOT NULL,
  service TEXT NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('workstream','shared','extension')),
  cwd TEXT NOT NULL,
  started_at TEXT NOT NULL,
  released_at TEXT,
  app_pid INTEGER
);
CREATE INDEX idx_docker_containers_bundle_released
  ON docker_containers(bundle_identifier, released_at);
CREATE INDEX idx_docker_containers_project_service
  ON docker_containers(compose_project, service);

CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft','candidate','routine')),
  origin TEXT NOT NULL CHECK (origin IN ('user','suggested')),
  label TEXT NOT NULL,
  trigger_when TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_routines_status ON routines(status);

CREATE TABLE routine_gated_runs (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  workstream_id TEXT NOT NULL,
  run_key TEXT NOT NULL UNIQUE,
  event TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','confirmed','rejected')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK ((state = 'pending') = (decided_at IS NULL))
);
CREATE INDEX idx_routine_gated_runs_routine ON routine_gated_runs(routine_id);
CREATE INDEX idx_routine_gated_runs_workstream_state
  ON routine_gated_runs(workstream_id, state);

CREATE TABLE routine_suggestions (
  id TEXT PRIMARY KEY,
  cluster_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','dismissed','accepted')),
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_routine_suggestions_cluster ON routine_suggestions(cluster_key);

CREATE TABLE workstream_commit_runs (
  workstream_id TEXT NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  threads_resolved_at TEXT,
  PRIMARY KEY (workstream_id, run_id)
);

CREATE TABLE workstream_ship (
  workstream_id TEXT PRIMARY KEY REFERENCES workstreams(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('local','draft','queued','needs-you')),
  step TEXT,
  pull_request_number INTEGER,
  pull_request_url TEXT,
  needs_you_reason TEXT,
  needs_you_detail TEXT,
  needs_you_job_run_id TEXT,
  queued_at TEXT,
  failure_signature TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  active_job_run_id TEXT,
  last_error TEXT,
  next_attempt_at TEXT,
  generated_title TEXT,
  generated_body TEXT,
  updated_at TEXT NOT NULL,
  addressed_reviews TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE job_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL CHECK (effort IN ('low','medium','high','xhigh','max')),
  runs_in TEXT NOT NULL CHECK (runs_in IN ('workstream','new-workstream')),
  output TEXT NOT NULL CHECK (output IN ('none','draft','merge')),
  builtin TEXT UNIQUE CHECK (builtin IS NULL OR builtin IN ('name-chats','name-services','fix-checks','update-from-main','address-review','check-compatibility','update-docs')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  skill_preset_id TEXT
);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES job_definitions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  workstream_id TEXT,
  repository_id TEXT,
  session_id TEXT,
  agent_run_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('merge-queue','manual','routine')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','needs-you','succeeded','failed','cancelled')),
  context TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  chat_session_id TEXT,
  chat_after_run_id TEXT
);
CREATE INDEX idx_job_runs_status_created ON job_runs(status, created_at);
CREATE INDEX idx_job_runs_session ON job_runs(session_id);
CREATE INDEX idx_job_runs_chat_session ON job_runs(chat_session_id);

CREATE TABLE skill_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  skills TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  emoji TEXT
);

CREATE TABLE skill_choices (
  scope TEXT NOT NULL CHECK (scope IN ('workstream','session')),
  owner_id TEXT NOT NULL,
  choice TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, owner_id)
);

CREATE TABLE scratchpads (
  repository_full_name TEXT PRIMARY KEY COLLATE NOCASE,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function userVersion(db: MaliniDatabase): number {
	return scalar(db, 'PRAGMA user_version');
}

export function tableNames(db: MaliniDatabase): string[] {
	return all<{ name: string }>(
		db,
		"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
	).map((row) => row.name);
}

export function migrate(db: MaliniDatabase): void {
	const existing = userVersion(db);
	if (existing >= TARGET_USER_VERSION) return;
	if (existing !== 0) {
		throw invariant(
			`schema version ${existing} predates the first release; open this database once with Malini 0.33.0 to upgrade it`,
		);
	}
	db.transaction(() => {
		db.exec(SCHEMA);
		db.exec(`PRAGMA user_version = ${TARGET_USER_VERSION};`);
	});
}
