import type { MaliniDatabase } from './driver';
import { invariant } from '$main/errors';
import { all, scalar } from './rows';

export const MIGRATION_0001_INITIAL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paused','merged','archived')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS check_results (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  command TEXT NOT NULL,
  exit_code INTEGER NOT NULL,
  stdout TEXT NOT NULL,
  stderr TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  ran_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const MIGRATION_0002_AGENT_SESSIONS = `
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL CHECK (provider IN ('codex','claude','opencode','cursor')),
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle','running','waiting_for_approval','completed','failed')),
  started_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  prompt TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  summary TEXT,
  error TEXT,
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);
`;

export const MIGRATION_0003_AGENT_EVENTS = `
CREATE TABLE IF NOT EXISTS agent_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event TEXT NOT NULL,
  emitted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_events_session_seq ON agent_events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id);
`;

export const MIGRATION_0004_CORE_WORKSPACE_SCOPE = `
ALTER TABLE projects ADD COLUMN core_workspace_id TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN core_workspace_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_projects_core_workspace ON projects(core_workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspaces_core_workspace ON workspaces(core_workspace_id, created_at DESC);
`;

export const MIGRATION_0005_AGENT_CHECKPOINTS = `
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  run_id TEXT NOT NULL,
  user_message_seq INTEGER,
  git_ref TEXT NOT NULL UNIQUE,
  git_commit TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_workspace_created
  ON agent_checkpoints(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_session_seq
  ON agent_checkpoints(session_id, user_message_seq);
`;

export const MIGRATION_0006_PROVIDER_SESSION_ID = `
ALTER TABLE agent_sessions ADD COLUMN provider_session_id TEXT;
`;

export const MIGRATION_0007_AGENT_SESSION_DISPLAY_NAME = `
ALTER TABLE agent_sessions ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
`;

export const MIGRATION_0008_AGENT_SESSION_ARCHIVED_AT = `
ALTER TABLE agent_sessions ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_sessions_workspace_archived_started
  ON agent_sessions(workspace_id, archived_at, started_at DESC);
`;

export const MIGRATION_0009_REPAIR_LEGACY_TIMESTAMPS = `
UPDATE projects
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', CAST(substr(created_at, 18, length(created_at) - 18) AS INTEGER), 'unixepoch')
WHERE length(created_at) >= 28 AND substr(created_at, 1, 17) = '2026-07-03T00:00:' AND created_at NOT LIKE '%.%';

UPDATE workspaces
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', CAST(substr(created_at, 18, length(created_at) - 18) AS INTEGER), 'unixepoch')
WHERE length(created_at) >= 28 AND substr(created_at, 1, 17) = '2026-07-03T00:00:' AND created_at NOT LIKE '%.%';

UPDATE check_results
SET ran_at = strftime('%Y-%m-%dT%H:%M:%fZ', CAST(substr(ran_at, 18, length(ran_at) - 18) AS INTEGER), 'unixepoch')
WHERE length(ran_at) >= 28 AND substr(ran_at, 1, 17) = '2026-07-03T00:00:' AND ran_at NOT LIKE '%.%';

UPDATE agent_sessions
SET started_at = CASE
      WHEN length(started_at) >= 28 AND substr(started_at, 1, 17) = '2026-07-03T00:00:' AND started_at NOT LIKE '%.%'
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', CAST(substr(started_at, 18, length(started_at) - 18) AS INTEGER), 'unixepoch')
      ELSE started_at
    END,
    archived_at = CASE
      WHEN archived_at IS NOT NULL AND length(archived_at) >= 28 AND substr(archived_at, 1, 17) = '2026-07-03T00:00:' AND archived_at NOT LIKE '%.%'
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', CAST(substr(archived_at, 18, length(archived_at) - 18) AS INTEGER), 'unixepoch')
      ELSE archived_at
    END
WHERE (length(started_at) >= 28 AND substr(started_at, 1, 17) = '2026-07-03T00:00:' AND started_at NOT LIKE '%.%')
   OR (archived_at IS NOT NULL AND length(archived_at) >= 28 AND substr(archived_at, 1, 17) = '2026-07-03T00:00:' AND archived_at NOT LIKE '%.%');

UPDATE agent_runs
SET started_at = CASE
      WHEN length(started_at) >= 28 AND substr(started_at, 1, 17) = '2026-07-03T00:00:' AND started_at NOT LIKE '%.%'
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', CAST(substr(started_at, 18, length(started_at) - 18) AS INTEGER), 'unixepoch')
      ELSE started_at
    END,
    completed_at = CASE
      WHEN completed_at IS NOT NULL AND length(completed_at) >= 28 AND substr(completed_at, 1, 17) = '2026-07-03T00:00:' AND completed_at NOT LIKE '%.%'
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', CAST(substr(completed_at, 18, length(completed_at) - 18) AS INTEGER), 'unixepoch')
      ELSE completed_at
    END
WHERE (length(started_at) >= 28 AND substr(started_at, 1, 17) = '2026-07-03T00:00:' AND started_at NOT LIKE '%.%')
   OR (completed_at IS NOT NULL AND length(completed_at) >= 28 AND substr(completed_at, 1, 17) = '2026-07-03T00:00:' AND completed_at NOT LIKE '%.%');

UPDATE agent_events
SET emitted_at = strftime('%Y-%m-%dT%H:%M:%fZ', CAST(substr(emitted_at, 18, length(emitted_at) - 18) AS INTEGER), 'unixepoch')
WHERE length(emitted_at) >= 28 AND substr(emitted_at, 1, 17) = '2026-07-03T00:00:' AND emitted_at NOT LIKE '%.%';

UPDATE agent_checkpoints
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', CAST(substr(created_at, 18, length(created_at) - 18) AS INTEGER), 'unixepoch')
WHERE length(created_at) >= 28 AND substr(created_at, 1, 17) = '2026-07-03T00:00:' AND created_at NOT LIKE '%.%';
`;

export const MIGRATION_0010_AGENT_ATTACHMENTS = `
CREATE TABLE IF NOT EXISTS agent_attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
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
  UNIQUE(workspace_id, relative_path)
);
CREATE INDEX IF NOT EXISTS idx_agent_attachments_workspace_state_expiry
  ON agent_attachments(workspace_id, state, expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_attachments_run
  ON agent_attachments(run_id);
`;

export const MIGRATION_0011_WORKSPACE_PREVIEW_INTENTS = `
CREATE TABLE IF NOT EXISTS workspace_preview_intents (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  command TEXT NOT NULL CHECK (length(trim(command)) > 0),
  updated_at TEXT NOT NULL
);
`;

export const MIGRATION_0012_CORE_AGENT_PROVIDER = `
CREATE TABLE agent_sessions_v12 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL CHECK (provider IN ('core','codex','claude','opencode','cursor')),
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle','running','waiting_for_approval','completed','failed')),
  started_at TEXT NOT NULL,
  provider_session_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  archived_at TEXT
);

INSERT INTO agent_sessions_v12 (
  rowid,
  id,
  workspace_id,
  provider,
  model,
  status,
  started_at,
  provider_session_id,
  display_name,
  archived_at
)
SELECT
  rowid,
  id,
  workspace_id,
  provider,
  model,
  status,
  started_at,
  provider_session_id,
  display_name,
  archived_at
FROM agent_sessions;

DROP TABLE agent_sessions;
ALTER TABLE agent_sessions_v12 RENAME TO agent_sessions;
CREATE INDEX idx_agent_sessions_workspace_archived_started
  ON agent_sessions(workspace_id, archived_at, started_at DESC);
`;

export const MIGRATION_0013_OWNED_LOOP_ONLY = `
CREATE TABLE agent_sessions_v13 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL CHECK (provider = 'core'),
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle','running','waiting_for_approval','completed','failed')),
  started_at TEXT NOT NULL,
  provider_session_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  archived_at TEXT
);

INSERT INTO agent_sessions_v13 (
  rowid,
  id,
  workspace_id,
  provider,
  model,
  status,
  started_at,
  provider_session_id,
  display_name,
  archived_at
)
SELECT
  rowid,
  id,
  workspace_id,
  'core',
  CASE
    WHEN provider = 'claude'
      AND model IN ('claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5')
      THEN 'anthropic/' || model
    WHEN provider = 'codex'
      AND model IN ('gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4')
      THEN 'openai/' || model
    WHEN provider IN ('core', 'opencode')
      AND model IN (
        'anthropic/claude-opus-4-8',
        'anthropic/claude-sonnet-4-6',
        'anthropic/claude-haiku-4-5',
        'openai/gpt-5.6-sol',
        'openai/gpt-5.6-terra',
        'openai/gpt-5.5',
        'openai/gpt-5.4'
      )
      THEN model
    WHEN provider IN ('core', 'opencode')
      AND substr(model, 1, 9) = 'opencode/'
      AND length(substr(model, 10)) BETWEEN 1 AND 256
      AND substr(model, 10, 1) GLOB '[A-Za-z0-9]'
      AND substr(model, 10) NOT GLOB '*[^A-Za-z0-9._-]*'
      THEN model
    ELSE 'anthropic/claude-sonnet-4-6'
  END,
  status,
  started_at,
  NULL,
  display_name,
  archived_at
FROM agent_sessions;

DROP TABLE agent_sessions;
ALTER TABLE agent_sessions_v13 RENAME TO agent_sessions;
CREATE INDEX idx_agent_sessions_workspace_archived_started
  ON agent_sessions(workspace_id, archived_at, started_at DESC);
`;

export const MIGRATION_0014_AGENT_RUN_CHANGES = `
CREATE TABLE IF NOT EXISTS agent_run_changes (
  run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL REFERENCES agent_checkpoints(id) ON DELETE CASCADE,
  before_commit TEXT NOT NULL,
  after_commit TEXT NOT NULL,
  after_ref TEXT NOT NULL UNIQUE,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_run_change_files (
  run_id TEXT NOT NULL REFERENCES agent_run_changes(run_id) ON DELETE CASCADE,
  path TEXT NOT NULL CHECK (length(path) > 0),
  additions INTEGER NOT NULL CHECK (additions >= 0),
  deletions INTEGER NOT NULL CHECK (deletions >= 0),
  is_binary INTEGER NOT NULL CHECK (is_binary IN (0, 1)),
  PRIMARY KEY (run_id, path)
);

CREATE INDEX IF NOT EXISTS idx_agent_run_changes_captured
  ON agent_run_changes(captured_at, run_id);
`;

export const MIGRATION_0015_AGENT_INTERACTIONS = `
CREATE TABLE IF NOT EXISTS agent_interactions (
  kind TEXT NOT NULL CHECK (kind IN ('approval', 'question')),
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_payload_json TEXT NOT NULL,
  permission_json TEXT,
  permission_fingerprint TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'dispatching', 'resolved')),
  intended_response_json TEXT,
  response_json TEXT,
  decision TEXT CHECK (decision IN ('allow', 'deny', 'answered')),
  scope TEXT CHECK (scope IN ('once', 'session', 'workspace')),
  source TEXT CHECK (source IN ('manual', 'auto')),
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  PRIMARY KEY (kind, session_id, run_id, request_id),
  CHECK (
    (state = 'pending' AND intended_response_json IS NULL AND response_json IS NULL
      AND decision IS NULL AND scope IS NULL AND source IS NULL AND decided_at IS NULL)
    OR
    (state = 'dispatching' AND intended_response_json IS NOT NULL AND response_json IS NULL
      AND decision IS NULL AND scope IS NULL AND source IS NULL AND decided_at IS NULL)
    OR
    (state = 'resolved' AND intended_response_json IS NOT NULL AND response_json IS NOT NULL
      AND decision IS NOT NULL AND source IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_interactions_pending
  ON agent_interactions(session_id, run_id, state, kind);

CREATE TABLE IF NOT EXISTS agent_permission_rules (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('session', 'workspace')),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
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
    OR (scope = 'workspace' AND session_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_permission_rules_active_session
  ON agent_permission_rules(session_id, permission_fingerprint)
  WHERE scope = 'session' AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_permission_rules_active_workspace
  ON agent_permission_rules(workspace_id, permission_fingerprint)
  WHERE scope = 'workspace' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_permission_rules_effective
  ON agent_permission_rules(workspace_id, session_id, permission_fingerprint, revoked_at);
`;

export const MIGRATION_0016_REPAIR_OWNED_LOOP_SESSIONS = `
CREATE TABLE agent_sessions_v16 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL CHECK (provider = 'core'),
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle','running','waiting_for_approval','completed','failed')),
  started_at TEXT NOT NULL,
  provider_session_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  archived_at TEXT
);

INSERT INTO agent_sessions_v16 (
  rowid, id, workspace_id, provider, model, status, started_at,
  provider_session_id, display_name, archived_at
)
SELECT
  rowid,
  id,
  workspace_id,
  'core',
  CASE
    WHEN provider = 'claude'
      AND model IN ('claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5')
      THEN 'anthropic/' || model
    WHEN provider = 'codex'
      AND model IN ('gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4')
      THEN 'openai/' || model
    WHEN provider IN ('core', 'opencode')
      AND model IN (
        'anthropic/claude-opus-4-8',
        'anthropic/claude-sonnet-4-6',
        'anthropic/claude-haiku-4-5',
        'openai/gpt-5.6-sol',
        'openai/gpt-5.6-terra',
        'openai/gpt-5.5',
        'openai/gpt-5.4'
      )
      THEN model
    WHEN provider IN ('core', 'opencode')
      AND substr(model, 1, 9) = 'opencode/'
      AND length(substr(model, 10)) BETWEEN 1 AND 256
      AND substr(model, 10, 1) GLOB '[A-Za-z0-9]'
      AND substr(model, 10) NOT GLOB '*[^A-Za-z0-9._-]*'
      THEN model
    ELSE 'anthropic/claude-sonnet-4-6'
  END,
  status,
  started_at,
  NULL,
  display_name,
  archived_at
FROM agent_sessions;

DROP TABLE agent_sessions;
ALTER TABLE agent_sessions_v16 RENAME TO agent_sessions;
CREATE INDEX idx_agent_sessions_workspace_archived_started
  ON agent_sessions(workspace_id, archived_at, started_at DESC);
`;

export const MIGRATION_0017_CLOSE_TERMINAL_INTERACTIONS = `
CREATE TABLE agent_interactions_v17 (
  kind TEXT NOT NULL CHECK (kind IN ('approval', 'question')),
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_payload_json TEXT NOT NULL,
  permission_json TEXT,
  permission_fingerprint TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'dispatching', 'resolved', 'closed')),
  intended_response_json TEXT,
  response_json TEXT,
  decision TEXT CHECK (decision IN ('allow', 'deny', 'answered')),
  scope TEXT CHECK (scope IN ('once', 'session', 'workspace')),
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

INSERT INTO agent_interactions_v17 (
  kind, session_id, workspace_id, run_id, request_id, request_payload_json,
  permission_json, permission_fingerprint, state, intended_response_json,
  response_json, decision, scope, source, requested_at, decided_at, closed_at
)
SELECT
  i.kind, i.session_id, i.workspace_id, i.run_id, i.request_id, i.request_payload_json,
  i.permission_json, i.permission_fingerprint,
  CASE
    WHEN i.state IN ('pending', 'dispatching') AND r.completed_at IS NOT NULL THEN 'closed'
    ELSE i.state
  END,
  i.intended_response_json, i.response_json, i.decision, i.scope, i.source,
  i.requested_at, i.decided_at,
  CASE
    WHEN i.state IN ('pending', 'dispatching') AND r.completed_at IS NOT NULL THEN r.completed_at
    ELSE NULL
  END
FROM agent_interactions i
JOIN agent_runs r ON r.id = i.run_id AND r.session_id = i.session_id;

DROP TABLE agent_interactions;
ALTER TABLE agent_interactions_v17 RENAME TO agent_interactions;
CREATE INDEX idx_agent_interactions_pending
  ON agent_interactions(session_id, run_id, state, kind);
`;

export const MIGRATION_0018_DOCKER_CONTAINERS = `
CREATE TABLE IF NOT EXISTS docker_containers (
  container_id TEXT PRIMARY KEY,
  container_name TEXT NOT NULL,
  bundle_identifier TEXT NOT NULL,
  app_instance_id TEXT NOT NULL,
  workspace_id TEXT,
  compose_project TEXT NOT NULL,
  service TEXT NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('workspace','shared','extension')),
  cwd TEXT NOT NULL,
  started_at TEXT NOT NULL,
  released_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_docker_containers_bundle_released
  ON docker_containers(bundle_identifier, released_at);
CREATE INDEX IF NOT EXISTS idx_docker_containers_project_service
  ON docker_containers(compose_project, service);
`;

export const MIGRATION_0019_DOCKER_CONTAINER_OWNER_PID = `
ALTER TABLE docker_containers ADD COLUMN app_pid INTEGER;
`;

export const MIGRATION_0020_BACKFILL_CORE_WORKSPACE_SCOPE = `
UPDATE workspaces
SET core_workspace_id = (
  SELECT p.core_workspace_id FROM projects p WHERE p.id = workspaces.project_id
)
WHERE core_workspace_id = ''
  AND EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = workspaces.project_id AND p.core_workspace_id <> ''
  );
`;

export const MIGRATION_0021_AGENT_USER_BASELINES = `
CREATE TABLE IF NOT EXISTS agent_user_baselines (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  run_id TEXT NOT NULL,
  git_ref TEXT NOT NULL UNIQUE,
  git_commit TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_user_baselines_workspace_created
  ON agent_user_baselines(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_user_baselines_run
  ON agent_user_baselines(run_id);
`;

export const MIGRATION_0022_AGENT_RUN_CHECKPOINT_FAILURES = `
CREATE TABLE IF NOT EXISTS agent_run_checkpoint_failures (
  run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
`;

export const MIGRATION_0023_CONNECTED_REPOSITORIES = `
CREATE TABLE IF NOT EXISTS connected_repositories (
  id TEXT PRIMARY KEY,
  core_workspace_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  local_path TEXT,
  remote_url TEXT,
  created_at TEXT NOT NULL
);
`;

export const MIGRATION_0024_WORKSPACE_ROUTINES = `
CREATE TABLE IF NOT EXISTS workspace_routines (
  id TEXT PRIMARY KEY,
  core_workspace_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','candidate','routine')),
  origin TEXT NOT NULL CHECK (origin IN ('user','suggested')),
  label TEXT NOT NULL,
  trigger_when TEXT NOT NULL,
  run_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspace_routines_scope_status
  ON workspace_routines(core_workspace_id, status);

CREATE TABLE IF NOT EXISTS routine_gated_runs (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES workspace_routines(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  run_key TEXT NOT NULL UNIQUE,
  event TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','confirmed','rejected')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK ((state = 'pending') = (decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_routine_gated_runs_workspace_state
  ON routine_gated_runs(workspace_id, state);
CREATE INDEX IF NOT EXISTS idx_routine_gated_runs_routine
  ON routine_gated_runs(routine_id);

CREATE TABLE IF NOT EXISTS routine_suggestions (
  id TEXT PRIMARY KEY,
  core_workspace_id TEXT NOT NULL,
  cluster_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','dismissed','accepted')),
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_suggestions_cluster
  ON routine_suggestions(core_workspace_id, cluster_key);
`;

export const MIGRATION_0025_AGENT_RUNS_OBSOLETED_AT = `ALTER TABLE agent_runs ADD COLUMN obsoleted_at TEXT;`;
export const MIGRATION_0025_AGENT_CHECKPOINTS_OBSOLETED_AT = `ALTER TABLE agent_checkpoints ADD COLUMN obsoleted_at TEXT;`;
export const MIGRATION_0025_AGENT_RUN_OBSOLETED_INDEX = `
CREATE INDEX IF NOT EXISTS idx_agent_runs_session_obsoleted
  ON agent_runs(session_id, obsoleted_at);
`;
export const MIGRATION_0025_AGENT_CHECKPOINT_OBSOLETED_INDEX = `
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_session_obsoleted
  ON agent_checkpoints(session_id, obsoleted_at);
`;

export const MIGRATION_0026_AGENT_SESSION_FORKED_FROM = `ALTER TABLE agent_sessions ADD COLUMN forked_from_session_id TEXT;`;
export const MIGRATION_0026_AGENT_SESSION_FORK_SEQ = `ALTER TABLE agent_sessions ADD COLUMN fork_seq INTEGER;`;

export const MIGRATION_0027_DROP_CHECKS_AND_PREVIEWS = `
DROP TABLE IF EXISTS check_results;
DROP TABLE IF EXISTS workspace_preview_intents;
`;

export const MIGRATION_0028_DROP_AGENT_PROVIDER = `
CREATE TABLE agent_sessions_v28 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle','running','waiting_for_approval','completed','failed')),
  started_at TEXT NOT NULL,
  provider_session_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  forked_from_session_id TEXT,
  fork_seq INTEGER
);

INSERT INTO agent_sessions_v28 (
  rowid,
  id,
  workspace_id,
  model,
  status,
  started_at,
  provider_session_id,
  display_name,
  archived_at,
  forked_from_session_id,
  fork_seq
)
SELECT
  rowid,
  id,
  workspace_id,
  model,
  status,
  started_at,
  provider_session_id,
  display_name,
  archived_at,
  forked_from_session_id,
  fork_seq
FROM agent_sessions;

DROP TABLE agent_sessions;
ALTER TABLE agent_sessions_v28 RENAME TO agent_sessions;
CREATE INDEX idx_agent_sessions_workspace_archived_started
  ON agent_sessions(workspace_id, archived_at, started_at DESC);
`;

export const MIGRATION_0029_CHECKPOINT_REFS = `
UPDATE agent_checkpoints
SET git_ref = 'refs/smack/' || substr(git_ref, 11)
WHERE git_ref LIKE 'refs/core/%';
`;

export const MIGRATION_0029_RUN_CHANGE_REFS = `
UPDATE agent_run_changes
SET after_ref = 'refs/smack/' || substr(after_ref, 11)
WHERE after_ref LIKE 'refs/core/%';
`;

export const MIGRATION_0029_USER_BASELINE_REFS = `
UPDATE agent_user_baselines
SET git_ref = 'refs/smack/' || substr(git_ref, 11)
WHERE git_ref LIKE 'refs/core/%';
`;

export const MIGRATION_0029_ATTACHMENT_PATHS = `
UPDATE agent_attachments
SET relative_path = '.smack/' || substr(relative_path, 7)
WHERE relative_path LIKE '.core/%';
`;

export const MIGRATION_0029_SMACK_IDENTIFIERS: readonly (readonly [
	table: string,
	statement: string,
])[] = [
	['agent_checkpoints', MIGRATION_0029_CHECKPOINT_REFS],
	['agent_run_changes', MIGRATION_0029_RUN_CHANGE_REFS],
	['agent_user_baselines', MIGRATION_0029_USER_BASELINE_REFS],
	['agent_attachments', MIGRATION_0029_ATTACHMENT_PATHS],
];

export const MIGRATION_0030_DROP_PROJECT_SCOPE = `
DROP INDEX IF EXISTS idx_projects_core_workspace;
ALTER TABLE projects DROP COLUMN core_workspace_id;
`;

export const MIGRATION_0030_DROP_WORKSTREAM_SCOPE = `
DROP INDEX IF EXISTS idx_workspaces_core_workspace;
ALTER TABLE workspaces DROP COLUMN core_workspace_id;
`;

export const MIGRATION_0030_DROP_CONNECTED_REPOSITORY_SCOPE = `
ALTER TABLE connected_repositories DROP COLUMN core_workspace_id;
`;

export const MIGRATION_0030_DROP_ROUTINE_SCOPE = `
DROP INDEX IF EXISTS idx_workspace_routines_scope_status;
ALTER TABLE workspace_routines DROP COLUMN core_workspace_id;
CREATE INDEX IF NOT EXISTS idx_workspace_routines_status ON workspace_routines(status);
`;

export const MIGRATION_0030_DROP_SUGGESTION_SCOPE = `
DROP INDEX IF EXISTS idx_routine_suggestions_cluster;
DELETE FROM routine_suggestions
WHERE rowid NOT IN (SELECT MIN(rowid) FROM routine_suggestions GROUP BY cluster_key);
ALTER TABLE routine_suggestions DROP COLUMN core_workspace_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_suggestions_cluster
  ON routine_suggestions(cluster_key);
`;

export const MIGRATION_0030_DROP_WORKSPACE_SCOPE: readonly (readonly [
	table: string,
	statement: string,
])[] = [
	['projects', MIGRATION_0030_DROP_PROJECT_SCOPE],
	['workspaces', MIGRATION_0030_DROP_WORKSTREAM_SCOPE],
	['connected_repositories', MIGRATION_0030_DROP_CONNECTED_REPOSITORY_SCOPE],
	['workspace_routines', MIGRATION_0030_DROP_ROUTINE_SCOPE],
	['routine_suggestions', MIGRATION_0030_DROP_SUGGESTION_SCOPE],
];

export const MIGRATION_0031_RENAME_WORKSPACES = `
ALTER TABLE workspaces RENAME TO workstreams;
`;

export const MIGRATION_0031_RENAME_WORKSPACE_ROUTINES = `
DROP INDEX IF EXISTS idx_workspace_routines_status;
ALTER TABLE workspace_routines RENAME TO routines;
CREATE INDEX IF NOT EXISTS idx_routines_status ON routines(status);
`;

export const MIGRATION_0031_AGENT_SESSIONS_WORKSTREAM = `
DROP INDEX IF EXISTS idx_agent_sessions_workspace_archived_started;
ALTER TABLE agent_sessions RENAME COLUMN workspace_id TO workstream_id;
CREATE INDEX IF NOT EXISTS idx_agent_sessions_workstream_archived_started
  ON agent_sessions(workstream_id, archived_at, started_at DESC);
`;

export const MIGRATION_0031_AGENT_CHECKPOINTS_WORKSTREAM = `
DROP INDEX IF EXISTS idx_agent_checkpoints_workspace_created;
ALTER TABLE agent_checkpoints RENAME COLUMN workspace_id TO workstream_id;
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_workstream_created
  ON agent_checkpoints(workstream_id, created_at DESC);
`;

export const MIGRATION_0031_AGENT_USER_BASELINES_WORKSTREAM = `
DROP INDEX IF EXISTS idx_agent_user_baselines_workspace_created;
ALTER TABLE agent_user_baselines RENAME COLUMN workspace_id TO workstream_id;
CREATE INDEX IF NOT EXISTS idx_agent_user_baselines_workstream_created
  ON agent_user_baselines(workstream_id, created_at DESC);
`;

export const MIGRATION_0031_AGENT_ATTACHMENTS_WORKSTREAM = `
DROP INDEX IF EXISTS idx_agent_attachments_workspace_state_expiry;
ALTER TABLE agent_attachments RENAME COLUMN workspace_id TO workstream_id;
CREATE INDEX IF NOT EXISTS idx_agent_attachments_workstream_state_expiry
  ON agent_attachments(workstream_id, state, expires_at);
`;

export const MIGRATION_0031_ROUTINE_GATED_RUNS_WORKSTREAM = `
DROP INDEX IF EXISTS idx_routine_gated_runs_workspace_state;
ALTER TABLE routine_gated_runs RENAME COLUMN workspace_id TO workstream_id;
CREATE INDEX IF NOT EXISTS idx_routine_gated_runs_workstream_state
  ON routine_gated_runs(workstream_id, state);
`;

export const MIGRATION_0031_AGENT_INTERACTIONS_WORKSTREAM = `
CREATE TABLE agent_interactions_v31 (
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

INSERT INTO agent_interactions_v31 (
  rowid, kind, session_id, workstream_id, run_id, request_id, request_payload_json,
  permission_json, permission_fingerprint, state, intended_response_json,
  response_json, decision, scope, source, requested_at, decided_at, closed_at
)
SELECT
  rowid, kind, session_id, workspace_id, run_id, request_id, request_payload_json,
  permission_json, permission_fingerprint, state,
  CASE
    WHEN json_valid(intended_response_json)
      AND json_extract(intended_response_json, '$.scope') = 'workspace'
    THEN json_set(intended_response_json, '$.scope', 'workstream')
    ELSE intended_response_json
  END,
  CASE
    WHEN json_valid(response_json) AND json_extract(response_json, '$.scope') = 'workspace'
    THEN json_set(response_json, '$.scope', 'workstream')
    ELSE response_json
  END,
  decision,
  CASE scope WHEN 'workspace' THEN 'workstream' ELSE scope END,
  source, requested_at, decided_at, closed_at
FROM agent_interactions;

DROP TABLE agent_interactions;
ALTER TABLE agent_interactions_v31 RENAME TO agent_interactions;
CREATE INDEX idx_agent_interactions_pending
  ON agent_interactions(session_id, run_id, state, kind);
`;

export const MIGRATION_0031_AGENT_PERMISSION_RULES_WORKSTREAM = `
CREATE TABLE agent_permission_rules_v31 (
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

INSERT INTO agent_permission_rules_v31 (
  rowid, id, scope, workstream_id, session_id, permission_fingerprint, permission_json,
  created_run_id, created_request_id, created_at, last_used_at, revoked_at
)
SELECT
  rowid, id, CASE scope WHEN 'workspace' THEN 'workstream' ELSE scope END, workspace_id,
  session_id, permission_fingerprint, permission_json, created_run_id, created_request_id,
  created_at, last_used_at, revoked_at
FROM agent_permission_rules;

DROP TABLE agent_permission_rules;
ALTER TABLE agent_permission_rules_v31 RENAME TO agent_permission_rules;
CREATE UNIQUE INDEX idx_agent_permission_rules_active_session
  ON agent_permission_rules(session_id, permission_fingerprint)
  WHERE scope = 'session' AND revoked_at IS NULL;
CREATE UNIQUE INDEX idx_agent_permission_rules_active_workstream
  ON agent_permission_rules(workstream_id, permission_fingerprint)
  WHERE scope = 'workstream' AND revoked_at IS NULL;
CREATE INDEX idx_agent_permission_rules_effective
  ON agent_permission_rules(workstream_id, session_id, permission_fingerprint, revoked_at);
`;

export const MIGRATION_0031_DOCKER_CONTAINERS_WORKSTREAM = `
CREATE TABLE docker_containers_v31 (
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

INSERT INTO docker_containers_v31 (
  rowid, container_id, container_name, bundle_identifier, app_instance_id, workstream_id,
  compose_project, service, owner, cwd, started_at, released_at, app_pid
)
SELECT
  rowid, container_id, container_name, bundle_identifier, app_instance_id, workspace_id,
  compose_project, service, CASE owner WHEN 'workspace' THEN 'workstream' ELSE owner END,
  cwd, started_at, released_at, app_pid
FROM docker_containers;

DROP TABLE docker_containers;
ALTER TABLE docker_containers_v31 RENAME TO docker_containers;
CREATE INDEX idx_docker_containers_bundle_released
  ON docker_containers(bundle_identifier, released_at);
CREATE INDEX idx_docker_containers_project_service
  ON docker_containers(compose_project, service);
`;

export const MIGRATION_0031_WORKSTREAM_NAMES: readonly (readonly [
	table: string,
	legacyColumn: string,
	statement: string,
])[] = [
	['workspaces', 'id', MIGRATION_0031_RENAME_WORKSPACES],
	['workspace_routines', 'id', MIGRATION_0031_RENAME_WORKSPACE_ROUTINES],
	['agent_sessions', 'workspace_id', MIGRATION_0031_AGENT_SESSIONS_WORKSTREAM],
	['agent_checkpoints', 'workspace_id', MIGRATION_0031_AGENT_CHECKPOINTS_WORKSTREAM],
	['agent_user_baselines', 'workspace_id', MIGRATION_0031_AGENT_USER_BASELINES_WORKSTREAM],
	['agent_attachments', 'workspace_id', MIGRATION_0031_AGENT_ATTACHMENTS_WORKSTREAM],
	['routine_gated_runs', 'workspace_id', MIGRATION_0031_ROUTINE_GATED_RUNS_WORKSTREAM],
	['agent_interactions', 'workspace_id', MIGRATION_0031_AGENT_INTERACTIONS_WORKSTREAM],
	['agent_permission_rules', 'workspace_id', MIGRATION_0031_AGENT_PERMISSION_RULES_WORKSTREAM],
	['docker_containers', 'workspace_id', MIGRATION_0031_DOCKER_CONTAINERS_WORKSTREAM],
];

export const MIGRATION_0032_CHECKPOINT_REFS = `
UPDATE agent_checkpoints
SET git_ref = 'refs/malini/' || substr(git_ref, 12)
WHERE git_ref LIKE 'refs/smack/%';
`;

export const MIGRATION_0032_RUN_CHANGE_REFS = `
UPDATE agent_run_changes
SET after_ref = 'refs/malini/' || substr(after_ref, 12)
WHERE after_ref LIKE 'refs/smack/%';
`;

export const MIGRATION_0032_USER_BASELINE_REFS = `
UPDATE agent_user_baselines
SET git_ref = 'refs/malini/' || substr(git_ref, 12)
WHERE git_ref LIKE 'refs/smack/%';
`;

export const MIGRATION_0032_ATTACHMENT_PATHS = `
UPDATE agent_attachments
SET relative_path = '.malini/' || substr(relative_path, 8)
WHERE relative_path LIKE '.smack/%';
`;

export const MIGRATION_0032_MALINI_IDENTIFIERS: readonly (readonly [
	table: string,
	statement: string,
])[] = [
	['agent_checkpoints', MIGRATION_0032_CHECKPOINT_REFS],
	['agent_run_changes', MIGRATION_0032_RUN_CHANGE_REFS],
	['agent_user_baselines', MIGRATION_0032_USER_BASELINE_REFS],
	['agent_attachments', MIGRATION_0032_ATTACHMENT_PATHS],
];

export const MIGRATION_0033_FORKED_TURN_CHECKPOINTS = `
INSERT INTO agent_checkpoints
  (id, workstream_id, session_id, run_id, user_message_seq, git_ref, git_commit, created_at)
SELECT p.id || '.' || e.session_id, p.workstream_id, e.session_id, e.run_id, e.seq,
       p.git_ref || '.' || e.session_id, p.git_commit, p.created_at
FROM agent_events e
JOIN agent_sessions s ON s.id = e.session_id AND s.forked_from_session_id IS NOT NULL
JOIN agent_runs r ON r.id = e.run_id AND r.session_id <> e.session_id
JOIN agent_checkpoints p ON p.run_id = e.run_id AND p.session_id = r.session_id
  AND p.user_message_seq IS NOT NULL AND p.obsoleted_at IS NULL
WHERE e.event LIKE 'user.message' || char(10) || '%'
  AND NOT EXISTS (
    SELECT 1 FROM agent_checkpoints c
    WHERE c.session_id = e.session_id AND c.user_message_seq = e.seq
  );

UPDATE agent_events
SET event = 'user.message' || char(10) || json_remove(
  COALESCE(
    (SELECT json_set(substr(agent_events.event, 14), '$.checkpointId', c.id)
     FROM agent_checkpoints c
     WHERE c.session_id = agent_events.session_id AND c.user_message_seq = agent_events.seq),
    substr(agent_events.event, 14)
  ),
  '$.checkpointUnavailable'
)
WHERE event LIKE 'user.message' || char(10) || '%'
  AND json_valid(substr(event, 14))
  AND json_type(substr(event, 14), '$.checkpointUnavailable') IS NOT NULL;

DROP TABLE IF EXISTS agent_run_checkpoint_failures;
`;

export const MIGRATION_0034_WORKSTREAM_COMMIT_RUNS = `
CREATE TABLE IF NOT EXISTS workstream_commit_runs (
  workstream_id TEXT NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (workstream_id, run_id)
);
`;

export const MIGRATION_0035_AGENT_RUNS_AUTOMATED = `ALTER TABLE agent_runs ADD COLUMN automated INTEGER NOT NULL DEFAULT 0;`;

export const MIGRATION_0036_COMMIT_RUN_THREADS_RESOLVED_AT = `ALTER TABLE workstream_commit_runs ADD COLUMN threads_resolved_at TEXT;`;

export const MIGRATION_0037_AGENT_RUNS_PROFILE = `ALTER TABLE agent_runs ADD COLUMN profile TEXT;`;

export const MIGRATION_0016_REPAIR_AGENTIC_AUXILIARY_SCHEMA: readonly string[] = [
	MIGRATION_0014_AGENT_RUN_CHANGES,
	MIGRATION_0015_AGENT_INTERACTIONS,
	MIGRATION_0021_AGENT_USER_BASELINES,
	MIGRATION_0022_AGENT_RUN_CHECKPOINT_FAILURES,
	MIGRATION_0023_CONNECTED_REPOSITORIES,
	MIGRATION_0024_WORKSPACE_ROUTINES,
];

export const TARGET_USER_VERSION = 37;

export function userVersion(db: MaliniDatabase): number {
	return scalar(db, 'PRAGMA user_version');
}

export function tableNames(db: MaliniDatabase): string[] {
	return all<{ name: string }>(
		db,
		"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
	).map((row) => row.name);
}

function columnExists(db: MaliniDatabase, table: string, column: string): boolean {
	return all<{ name: string }>(db, `PRAGMA table_info(${table})`).some(
		(row) => row.name === column,
	);
}

function addColumnIfMissing(db: MaliniDatabase, table: string, column: string, ddl: string): void {
	if (!columnExists(db, table, column)) db.exec(ddl);
}

function tableExists(db: MaliniDatabase, table: string): boolean {
	return all<{ name: string }>(db, `PRAGMA table_info(${table})`).length > 0;
}

export function migrate(db: MaliniDatabase, targetVersion = TARGET_USER_VERSION): void {
	const existing = userVersion(db);
	if (existing >= targetVersion) return;

	const repairOwnedLoopSessions = existing >= 13 && existing < 16;
	const foreignKeysWereEnabled = scalar(db, 'PRAGMA foreign_keys') !== 0;
	if (foreignKeysWereEnabled) db.exec('PRAGMA foreign_keys = OFF;');

	try {
		db.transaction(() => {
			if (existing < 1) db.exec(MIGRATION_0001_INITIAL);
			if (existing < 2) db.exec(MIGRATION_0002_AGENT_SESSIONS);
			if (existing < 3) db.exec(MIGRATION_0003_AGENT_EVENTS);
			if (existing < 4) db.exec(MIGRATION_0004_CORE_WORKSPACE_SCOPE);
			if (existing < 5) db.exec(MIGRATION_0005_AGENT_CHECKPOINTS);
			if (existing < 6) db.exec(MIGRATION_0006_PROVIDER_SESSION_ID);
			if (existing < 7) db.exec(MIGRATION_0007_AGENT_SESSION_DISPLAY_NAME);
			if (existing < 8) db.exec(MIGRATION_0008_AGENT_SESSION_ARCHIVED_AT);
			if (existing < 9) db.exec(MIGRATION_0009_REPAIR_LEGACY_TIMESTAMPS);
			if (existing < 10) db.exec(MIGRATION_0010_AGENT_ATTACHMENTS);
			if (existing < 11) db.exec(MIGRATION_0011_WORKSPACE_PREVIEW_INTENTS);
			if (existing < 12) db.exec(MIGRATION_0012_CORE_AGENT_PROVIDER);
			if (existing < 13) db.exec(MIGRATION_0013_OWNED_LOOP_ONLY);
			if (existing < 14) db.exec(MIGRATION_0014_AGENT_RUN_CHANGES);
			if (existing < 15) db.exec(MIGRATION_0015_AGENT_INTERACTIONS);
			if (repairOwnedLoopSessions) db.exec(MIGRATION_0016_REPAIR_OWNED_LOOP_SESSIONS);
			if (existing < 30) {
				for (const schema of MIGRATION_0016_REPAIR_AGENTIC_AUXILIARY_SCHEMA) db.exec(schema);
			}
			if (existing < 17) db.exec(MIGRATION_0017_CLOSE_TERMINAL_INTERACTIONS);
			if (existing < 18) db.exec(MIGRATION_0018_DOCKER_CONTAINERS);
			if (existing < 19) {
				addColumnIfMissing(
					db,
					'docker_containers',
					'app_pid',
					MIGRATION_0019_DOCKER_CONTAINER_OWNER_PID,
				);
			}
			if (existing < 20) db.exec(MIGRATION_0020_BACKFILL_CORE_WORKSPACE_SCOPE);
			if (existing < 21) db.exec(MIGRATION_0021_AGENT_USER_BASELINES);
			if (existing < 22) db.exec(MIGRATION_0022_AGENT_RUN_CHECKPOINT_FAILURES);
			if (existing < 23) db.exec(MIGRATION_0023_CONNECTED_REPOSITORIES);
			if (existing < 24) db.exec(MIGRATION_0024_WORKSPACE_ROUTINES);
			if (existing < 25) {
				if (tableExists(db, 'agent_runs')) {
					addColumnIfMissing(
						db,
						'agent_runs',
						'obsoleted_at',
						MIGRATION_0025_AGENT_RUNS_OBSOLETED_AT,
					);
					db.exec(MIGRATION_0025_AGENT_RUN_OBSOLETED_INDEX);
				}
				if (tableExists(db, 'agent_checkpoints')) {
					addColumnIfMissing(
						db,
						'agent_checkpoints',
						'obsoleted_at',
						MIGRATION_0025_AGENT_CHECKPOINTS_OBSOLETED_AT,
					);
					db.exec(MIGRATION_0025_AGENT_CHECKPOINT_OBSOLETED_INDEX);
				}
			}
			if (existing < 26 && tableExists(db, 'agent_sessions')) {
				addColumnIfMissing(
					db,
					'agent_sessions',
					'forked_from_session_id',
					MIGRATION_0026_AGENT_SESSION_FORKED_FROM,
				);
				addColumnIfMissing(db, 'agent_sessions', 'fork_seq', MIGRATION_0026_AGENT_SESSION_FORK_SEQ);
			}
			if (existing < 27) db.exec(MIGRATION_0027_DROP_CHECKS_AND_PREVIEWS);
			if (existing < 28 && tableExists(db, 'agent_sessions')) {
				db.exec(MIGRATION_0028_DROP_AGENT_PROVIDER);
			}
			if (existing < 29) {
				for (const [table, statement] of MIGRATION_0029_SMACK_IDENTIFIERS) {
					if (tableExists(db, table)) db.exec(statement);
				}
			}
			if (existing < 30) {
				for (const [table, statement] of MIGRATION_0030_DROP_WORKSPACE_SCOPE) {
					if (columnExists(db, table, 'core_workspace_id')) db.exec(statement);
				}
			}
			if (existing < 31) {
				for (const [table, legacyColumn, statement] of MIGRATION_0031_WORKSTREAM_NAMES) {
					if (columnExists(db, table, legacyColumn)) db.exec(statement);
				}
			}
			if (existing < 32) {
				for (const [table, statement] of MIGRATION_0032_MALINI_IDENTIFIERS) {
					if (tableExists(db, table)) db.exec(statement);
				}
			}
			if (existing < 33 && tableExists(db, 'agent_events')) {
				db.exec(MIGRATION_0033_FORKED_TURN_CHECKPOINTS);
			}
			if (existing < 34) db.exec(MIGRATION_0034_WORKSTREAM_COMMIT_RUNS);
			if (existing < 35 && tableExists(db, 'agent_runs')) {
				addColumnIfMissing(db, 'agent_runs', 'automated', MIGRATION_0035_AGENT_RUNS_AUTOMATED);
			}
			if (existing < 36) {
				addColumnIfMissing(
					db,
					'workstream_commit_runs',
					'threads_resolved_at',
					MIGRATION_0036_COMMIT_RUN_THREADS_RESOLVED_AT,
				);
			}
			if (existing < 37 && tableExists(db, 'agent_runs')) {
				addColumnIfMissing(db, 'agent_runs', 'profile', MIGRATION_0037_AGENT_RUNS_PROFILE);
			}

			const violation = all<{ table: string; rowid: number | null; parent: string }>(
				db,
				'PRAGMA foreign_key_check',
			)[0];
			if (violation) {
				throw invariant(
					`migration left a foreign-key violation in \`${violation.table}\` row ${String(violation.rowid)} referencing \`${violation.parent}\``,
				);
			}
			db.exec(`PRAGMA user_version = ${targetVersion};`);
		});
	} finally {
		if (foreignKeysWereEnabled) db.exec('PRAGMA foreign_keys = ON;');
	}
}
