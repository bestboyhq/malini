import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { agentsMidTurn, needsFreshDevServer } from './dogfood.mjs';

test('an update waits for agents mid-turn, not for runs that only wait on commands', () => {
	const folder = mkdtempSync(join(tmpdir(), 'dogfood-'));
	const database = join(folder, 'malini.sqlite');
	const db = new DatabaseSync(database);
	db.exec(`
		CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, archived_at TEXT);
		CREATE TABLE agent_runs (id TEXT PRIMARY KEY, session_id TEXT, completed_at TEXT);
		CREATE TABLE agent_events (seq INTEGER PRIMARY KEY, run_id TEXT, event TEXT);
		INSERT INTO agent_sessions VALUES ('chat', NULL), ('archived', '2026-10-28');
		INSERT INTO agent_runs VALUES
			('working', 'chat', NULL),
			('serving', 'chat', NULL),
			('done', 'chat', '2026-10-28'),
			('gone', 'archived', NULL);
		INSERT INTO agent_events (run_id, event) VALUES
			('serving', 'background.updated' || char(10) || '{"waiting":true,"tasks":[{"kind":"command"}]}');
	`);
	try {
		assert.equal(agentsMidTurn(database), 1);
		db.exec(`UPDATE agent_runs SET completed_at = '2026-10-28' WHERE id = 'working'`);
		assert.equal(agentsMidTurn(database), 0);
		assert.equal(agentsMidTurn(join(folder, 'missing.sqlite')), 0);
	} finally {
		db.close();
		rmSync(folder, { recursive: true, force: true });
	}
});

test('source changes ride on the dev server watch', () => {
	assert.equal(
		needsFreshDevServer([
			'apps/malini/src/main/index.ts',
			'apps/malini/src/lib/chat/presentation/Chat.svelte',
			'packages/agent-bridge/src/cli.ts',
			'docs/packaging.md',
		]),
		false,
	);
});

test('a dependency change needs an install and a fresh dev server', () => {
	assert.equal(needsFreshDevServer(['pnpm-lock.yaml']), true);
	assert.equal(needsFreshDevServer(['packages/agent-bridge/package.json']), true);
	assert.equal(needsFreshDevServer(['pnpm-workspace.yaml']), true);
});

test('a build config change needs a fresh dev server', () => {
	assert.equal(needsFreshDevServer(['apps/malini/electron.vite.config.ts']), true);
	assert.equal(needsFreshDevServer(['apps/malini/svelte.config.mjs']), true);
	assert.equal(needsFreshDevServer(['tsconfig.base.json']), true);
	assert.equal(needsFreshDevServer(['packages/agent-bridge/scripts/generate-protocol.mjs']), true);
});

test('a launcher change needs a fresh dev server', () => {
	assert.equal(needsFreshDevServer(['apps/malini/scripts/dogfood.mjs']), true);
	assert.equal(needsFreshDevServer(['apps/malini/scripts/dev-bundle.mjs']), true);
	assert.equal(needsFreshDevServer(['apps/malini/scripts/version.mjs']), false);
});
