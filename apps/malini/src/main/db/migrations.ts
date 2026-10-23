import type { MaliniDatabase } from './driver';
import { invariant } from '$main/errors';
import { all, scalar } from './rows';

export const BASELINE_USER_VERSION = 54;

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

const MIGRATIONS: readonly string[] = [
	`
ALTER TABLE job_definitions ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
UPDATE job_definitions
  SET skills = (SELECT skills FROM skill_presets WHERE skill_presets.id = job_definitions.skill_preset_id)
  WHERE skill_preset_id IN (SELECT id FROM skill_presets WHERE json_valid(skills));
ALTER TABLE job_definitions DROP COLUMN skill_preset_id;
DELETE FROM skill_choices WHERE scope != 'session' OR NOT json_valid(choice);
UPDATE skill_choices SET choice = CASE json_extract(choice, '$.kind')
  WHEN 'custom' THEN COALESCE(json_extract(choice, '$.skills'), 'null')
  WHEN 'preset' THEN COALESCE(
    (SELECT skills FROM skill_presets WHERE id = json_extract(skill_choices.choice, '$.presetId') AND json_valid(skills)),
    'null')
  ELSE 'null' END;
DELETE FROM skill_choices WHERE json_type(choice) != 'array' OR json_array_length(choice) = 0;
DROP TABLE skill_presets;
`,
	`
CREATE TABLE agent_interactions_next (
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
  scope TEXT CHECK (scope IN ('once', 'session', 'workstream', 'everywhere')),
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
INSERT INTO agent_interactions_next SELECT * FROM agent_interactions;
DROP TABLE agent_interactions;
ALTER TABLE agent_interactions_next RENAME TO agent_interactions;
CREATE INDEX idx_agent_interactions_pending
  ON agent_interactions(session_id, run_id, state, kind);

CREATE TABLE agent_permission_rules_next (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('session', 'workstream', 'everywhere')),
  workstream_id TEXT REFERENCES workstreams(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES agent_sessions(id) ON DELETE CASCADE,
  permission_fingerprint TEXT NOT NULL CHECK (length(permission_fingerprint) = 64),
  permission_json TEXT NOT NULL,
  created_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  CHECK (
    (scope = 'session' AND workstream_id IS NOT NULL AND session_id IS NOT NULL)
    OR (scope = 'workstream' AND workstream_id IS NOT NULL AND session_id IS NULL)
    OR (scope = 'everywhere' AND workstream_id IS NULL AND session_id IS NULL)
  )
);
INSERT INTO agent_permission_rules_next SELECT * FROM agent_permission_rules;
DROP TABLE agent_permission_rules;
ALTER TABLE agent_permission_rules_next RENAME TO agent_permission_rules;
CREATE UNIQUE INDEX idx_agent_permission_rules_active_session
  ON agent_permission_rules(session_id, permission_fingerprint)
  WHERE scope = 'session' AND revoked_at IS NULL;
CREATE UNIQUE INDEX idx_agent_permission_rules_active_workstream
  ON agent_permission_rules(workstream_id, permission_fingerprint)
  WHERE scope = 'workstream' AND revoked_at IS NULL;
CREATE UNIQUE INDEX idx_agent_permission_rules_active_everywhere
  ON agent_permission_rules(permission_fingerprint)
  WHERE scope = 'everywhere' AND revoked_at IS NULL;
CREATE INDEX idx_agent_permission_rules_effective
  ON agent_permission_rules(workstream_id, session_id, permission_fingerprint, revoked_at);
`,
	`
CREATE TABLE job_definitions_next (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL CHECK (effort IN ('low','medium','high','xhigh','max')),
  runs_in TEXT NOT NULL CHECK (runs_in IN ('workstream','new-workstream')),
  builtin TEXT UNIQUE CHECK (builtin IS NULL OR builtin IN ('name-chats','name-services','fix-checks','update-from-main','resolve-conflicts','address-review','check-compatibility','update-docs','open-draft','merge')),
  skills TEXT NOT NULL DEFAULT '[]',
  trigger_when TEXT,
  trigger_mode TEXT CHECK (trigger_mode IN ('off','ask','auto')),
  then_job_id TEXT REFERENCES job_definitions_next(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((trigger_when IS NULL) = (trigger_mode IS NULL)),
  CHECK (then_job_id IS NULL OR then_job_id != id)
);
INSERT INTO job_definitions_next
  (id, name, instructions, model, effort, runs_in, builtin, skills, created_at, updated_at)
  SELECT id, name, instructions, model, effort, runs_in, builtin, skills, created_at, updated_at
  FROM job_definitions;
INSERT INTO job_definitions_next
  (id, name, instructions, model, effort, runs_in, builtin, created_at, updated_at)
  VALUES
  (lower(hex(randomblob(16))), 'Open draft',
   'Commit this workstream''s changes, push its branch and open a draft pull request. When the workstream already has an open pull request, push to it instead.',
   'opus', 'low', 'workstream', 'open-draft',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (lower(hex(randomblob(16))), 'Merge',
   'Queue this workstream''s pull request to merge: Malini opens it when there is none, marks it ready, keeps it up to date with its base, fixes failing checks, answers bot reviews and merges it.',
   'opus', 'low', 'workstream', 'merge',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE job_definitions_next
  SET instructions = 'Merge this workstream''s base branch into it. When the merge stops on conflicts, Resolve conflicts finishes it.',
      effort = 'low'
  WHERE builtin = 'update-from-main';
UPDATE job_definitions_next
  SET then_job_id = (SELECT id FROM job_definitions_next WHERE builtin = 'open-draft')
  WHERE id IN (SELECT id FROM job_definitions WHERE output = 'draft');
UPDATE job_definitions_next
  SET then_job_id = (SELECT id FROM job_definitions_next WHERE builtin = 'merge')
  WHERE id IN (SELECT id FROM job_definitions WHERE output = 'merge');
WITH firsts AS (
  SELECT id, status, created_at, json_extract(steps_json, '$[0].job') AS job_id,
    CASE
      WHEN lower(trim(trigger_when)) LIKE 'on %' THEN trim(trigger_when)
      WHEN lower(trigger_when) LIKE '%workstream%' AND lower(trigger_when) LIKE '%creat%'
        THEN 'on repositories:workstream-created'
    END AS event_when
  FROM routines
  WHERE json_valid(steps_json) AND json_type(steps_json, '$[0].job') = 'text'
),
ranked AS (
  SELECT job_id, event_when, status,
    ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY created_at, id) AS rank
  FROM firsts
  WHERE event_when IS NOT NULL
)
UPDATE job_definitions_next
  SET trigger_when = ranked.event_when,
      trigger_mode = CASE ranked.status WHEN 'routine' THEN 'auto' WHEN 'candidate' THEN 'ask' ELSE 'off' END
  FROM ranked
  WHERE ranked.job_id = job_definitions_next.id AND ranked.rank = 1;
WITH job_steps AS (
  SELECT routines.id AS routine_id, routines.created_at, CAST(step.key AS INTEGER) AS position,
    json_extract(step.value, '$.job') AS job_id
  FROM routines, json_each(routines.steps_json) AS step
  WHERE json_valid(routines.steps_json) AND json_type(step.value, '$.job') = 'text'
),
steps AS (
  SELECT routine_id, created_at, job_id,
    ROW_NUMBER() OVER (PARTITION BY routine_id ORDER BY position) AS position
  FROM job_steps
),
links AS (
  SELECT this.job_id AS from_id, next.job_id AS to_id,
    ROW_NUMBER() OVER (
      PARTITION BY this.job_id ORDER BY this.created_at, this.routine_id, this.position
    ) AS rank
  FROM steps AS this
  JOIN steps AS next ON next.routine_id = this.routine_id AND next.position = this.position + 1
  WHERE NOT EXISTS (
      SELECT 1 FROM steps AS earlier
      WHERE earlier.routine_id = this.routine_id AND earlier.position <= this.position
        AND earlier.job_id = next.job_id
    )
)
UPDATE job_definitions_next
  SET then_job_id = links.to_id
  FROM links
  WHERE links.from_id = job_definitions_next.id AND links.rank = 1
    AND job_definitions_next.then_job_id IS NULL
    AND links.to_id IN (SELECT id FROM job_definitions_next);

CREATE TABLE job_runs_next (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES job_definitions_next(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  workstream_id TEXT,
  repository_id TEXT,
  session_id TEXT,
  agent_run_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('merge-queue','manual','trigger','then')),
  status TEXT NOT NULL CHECK (status IN ('waiting','queued','running','needs-you','succeeded','failed','cancelled')),
  context TEXT,
  detail TEXT,
  parent_run_id TEXT REFERENCES job_runs_next(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  chat_session_id TEXT,
  chat_after_run_id TEXT
);
INSERT INTO job_runs_next
  (id, definition_id, title, workstream_id, repository_id, session_id, agent_run_id, origin,
   status, context, detail, created_at, started_at, finished_at, chat_session_id, chat_after_run_id)
  SELECT id, definition_id, title, workstream_id, repository_id, session_id, agent_run_id,
    CASE origin WHEN 'routine' THEN 'trigger' ELSE origin END,
    status, context, detail, created_at, started_at, finished_at, chat_session_id, chat_after_run_id
  FROM job_runs;
INSERT INTO job_runs_next
  (id, definition_id, title, workstream_id, repository_id, origin, status, context, created_at)
  SELECT gated.id, job.id, job.name, NULLIF(gated.workstream_id, ''), workstreams.project_id,
    'trigger', 'waiting', json_object('event', gated.event, 'payload', json(gated.payload_json)),
    gated.created_at
  FROM routine_gated_runs AS gated
  JOIN routines ON routines.id = gated.routine_id
  JOIN job_definitions_next AS job ON job.id = json_extract(routines.steps_json, '$[0].job')
  LEFT JOIN workstreams ON workstreams.id = gated.workstream_id
  WHERE gated.state = 'pending' AND json_valid(routines.steps_json)
    AND json_valid(gated.payload_json);

DROP TABLE job_runs;
DROP TABLE job_definitions;
ALTER TABLE job_definitions_next RENAME TO job_definitions;
ALTER TABLE job_runs_next RENAME TO job_runs;
CREATE INDEX idx_job_runs_status_created ON job_runs(status, created_at);
CREATE INDEX idx_job_runs_session ON job_runs(session_id);
CREATE INDEX idx_job_runs_chat_session ON job_runs(chat_session_id);
CREATE INDEX idx_job_runs_parent ON job_runs(parent_run_id);

DROP TABLE routine_gated_runs;
DROP TABLE routines;
DROP INDEX idx_routine_suggestions_cluster;
ALTER TABLE routine_suggestions RENAME TO job_suggestions;
CREATE UNIQUE INDEX idx_job_suggestions_cluster ON job_suggestions(cluster_key);
DELETE FROM agent_permission_rules
  WHERE json_valid(permission_json)
    AND json_extract(permission_json, '$.resources[0].value') = 'routines.save';
`,
	`
CREATE TABLE job_setups (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES job_definitions(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  instructions TEXT NOT NULL,
  expected_rate REAL CHECK (expected_rate IS NULL OR (expected_rate >= 0 AND expected_rate <= 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_job_setups_definition_created ON job_setups(definition_id, created_at);

CREATE TABLE job_outputs (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES job_definitions(id) ON DELETE CASCADE,
  setup_id TEXT NOT NULL REFERENCES job_setups(id) ON DELETE CASCADE,
  input TEXT NOT NULL,
  output TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  CHECK ((output IS NULL) <> (error IS NULL))
);
CREATE INDEX idx_job_outputs_definition_created ON job_outputs(definition_id, created_at);

CREATE TABLE job_experiments (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES job_definitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  instructions TEXT NOT NULL,
  current INTEGER NOT NULL DEFAULT 0 CHECK (current IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_job_experiments_definition ON job_experiments(definition_id, created_at);

CREATE TABLE job_experiment_samples (
  definition_id TEXT NOT NULL REFERENCES job_definitions(id) ON DELETE CASCADE,
  output_id TEXT NOT NULL REFERENCES job_outputs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (definition_id, output_id)
);

CREATE TABLE job_experiment_results (
  experiment_id TEXT NOT NULL REFERENCES job_experiments(id) ON DELETE CASCADE,
  output_id TEXT NOT NULL REFERENCES job_outputs(id) ON DELETE CASCADE,
  output TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (experiment_id, output_id),
  CHECK ((output IS NULL) <> (error IS NULL))
);
`,
	`
CREATE TABLE mcp_server_listings (
  folder TEXT PRIMARY KEY,
  servers TEXT NOT NULL,
  listed_at TEXT NOT NULL
);

CREATE TABLE mcp_server_folder_offs (
  server_name TEXT NOT NULL,
  folder TEXT NOT NULL,
  PRIMARY KEY (server_name, folder)
);
`,
];

export const TARGET_USER_VERSION = BASELINE_USER_VERSION + MIGRATIONS.length;

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
	if (existing !== 0 && existing < BASELINE_USER_VERSION) {
		throw invariant(
			`schema version ${existing} predates the first release; open this database once with Malini 0.33.0 to upgrade it`,
		);
	}
	db.transaction(() => {
		if (existing === 0) db.exec(SCHEMA);
		const applied = Math.max(existing, BASELINE_USER_VERSION) - BASELINE_USER_VERSION;
		for (const migration of MIGRATIONS.slice(applied)) db.exec(migration);
		db.exec(`PRAGMA user_version = ${TARGET_USER_VERSION};`);
	});
}
