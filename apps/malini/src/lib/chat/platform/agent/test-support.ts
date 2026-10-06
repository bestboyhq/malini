import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { createEventBus, type EventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import {
	BRIDGE_CONTRACT_NAME,
	BRIDGE_HEARTBEAT_INTERVAL_MS,
	BRIDGE_PROTOCOL_VERSION,
} from './protocol';
import {
	createNodeProcessFactory,
	type BridgeProcessFactory,
	type BridgeSpawnSpec,
} from './process';
import type { BridgeSupervisorConfig } from './supervisor';

const FAKE_BRIDGE_SCRIPT = `
const readline = require('node:readline');
const fs = require('node:fs');
const nodePath = require('node:path');
const env = process.env;
const version = env.FAKE_BRIDGE_VERSION ? Number(env.FAKE_BRIDGE_VERSION) : __VERSION__;
const contract = env.FAKE_BRIDGE_CONTRACT || '__CONTRACT__';
const heartbeatMs = env.FAKE_BRIDGE_HEARTBEAT_MS === undefined ? 50 : Number(env.FAKE_BRIDGE_HEARTBEAT_MS);
const ackDelay = Number(env.FAKE_BRIDGE_ACK_DELAY_MS || 0);
const reverse = Number(env.FAKE_BRIDGE_REVERSE_ACKS || 0);
const approvalPath = env.FAKE_BRIDGE_APPROVAL_PATH || '/tmp/outside.txt';
const write = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
const makeCapability = (capabilityVersion, message) => ({
  state: 'ready',
  installed: true,
  authenticated: env.FAKE_BRIDGE_BAD_CAPABILITY ? false : true,
  version: capabilityVersion,
  account: { email: 'fixture@example.com', plan: 'Claude Max' },
  models: [{ id: 'default', label: 'Default', description: 'Fixture default', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }],
  defaultModel: 'default',
  message
});
if (env.FAKE_BRIDGE_STDERR_EXIT) {
  process.stderr.write(env.FAKE_BRIDGE_STDERR_EXIT + '\\n');
  process.exit(1);
}
write({
  type: 'bridge.ready',
  contractName: contract,
  protocolVersion: version,
  pid: process.pid,
  capabilities: [makeCapability('fixture-1.0.0', 'Ready')],
  heartbeatIntervalMs: __HEARTBEAT_INTERVAL__
});
let heartbeat = null;
if (heartbeatMs > 0) {
  heartbeat = setInterval(() => write({ type: 'bridge.heartbeat', protocolVersion: version, ts: Date.now() }), heartbeatMs);
}
const ack = (id, error) => {
  const frame = { type: 'bridge.command_ack', protocolVersion: version, id, accepted: error === undefined };
  if (error !== undefined) frame.error = error;
  if (ackDelay > 0) setTimeout(() => write(frame), ackDelay); else write(frame);
};
const pendingRuns = new Map();
const worktrees = new Map();
const event = (frame) => write(frame);
const completeRun = (sessionId, runId, summary) => {
  event({ type: 'assistant.delta', runId, contentId: 'c1', text: 'partial ' });
  event({ type: 'assistant.message', runId, contentId: 'c1', text: 'Hello from the fake bridge' });
  event({ type: 'usage.updated', runId, inputTokens: 10, outputTokens: 5, interim: true });
  event({ type: 'usage.updated', runId, inputTokens: 10, outputTokens: 5 });
  event({ type: 'run.completed', runId, summary, providerCursor: 'cursor-' + runId });
  event({ type: 'session.state', sessionId, status: 'completed' });
};
const handle = (command) => {
  switch (command.cmd) {
    case 'start_session':
      if (env.FAKE_BRIDGE_REJECT_START) return ack(command.id, env.FAKE_BRIDGE_REJECT_START);
      if (command.worktreePath) worktrees.set(command.sessionId, command.worktreePath);
      event({ type: 'session.state', sessionId: command.sessionId, status: 'idle', providerSessionId: 'prov-' + command.sessionId });
      return ack(command.id);
    case 'send_prompt': {
      if (env.FAKE_BRIDGE_REJECT_PROMPT) return ack(command.id, env.FAKE_BRIDGE_REJECT_PROMPT);
      ack(command.id);
      const { sessionId, runId, prompt } = command;
      if (prompt.includes('CRASH')) process.exit(3);
      event({ type: 'run.started', runId, sessionId });
      const edit = /EDIT:([^\\s]+)/.exec(prompt);
      if (edit) {
        const worktree = worktrees.get(sessionId);
        if (worktree) {
          fs.mkdirSync(worktree, { recursive: true });
          fs.writeFileSync(nodePath.join(worktree, edit[1]), 'agent edit ' + runId + '\\n');
          event({ type: 'file.changed', runId, path: edit[1] });
        }
      }
      if (prompt.includes('HANG')) { pendingRuns.set(runId, sessionId); return; }
      if (prompt.includes('APPROVAL')) {
        pendingRuns.set(runId, sessionId);
        event({ type: 'approval.requested', sessionId, runId, approvalId: 'approval-1', reason: 'read outside', toolName: 'read_file',
          permission: { capability: 'read', resources: [{ kind: 'path', value: approvalPath, canonicalValue: approvalPath, boundary: 'external' }] } });
        return;
      }
      if (prompt.includes('QUESTION')) {
        pendingRuns.set(runId, sessionId);
        event({ type: 'question.requested', sessionId, runId, questionId: 'question-1',
          questions: [{ id: 'q1', prompt: 'Which?', options: [{ label: 'A' }, { label: 'B', description: 'second' }], multiSelect: false, allowFreeText: false }] });
        return;
      }
      return completeRun(sessionId, runId, command.resumeAt ? 'done after ' + command.resumeAt : 'done');
    }
    case 'cancel_run': {
      event({ type: 'run.failed', runId: command.runId, error: 'cancelled', providerCursor: 'cursor-' + command.runId });
      pendingRuns.delete(command.runId);
      return ack(command.id);
    }
    case 'close_session':
      return ack(command.id);
    case 'approve': {
      ack(command.id);
      event({ type: 'tool.completed', runId: command.runId, name: 'read_file', output: { decision: command.decision, scope: command.scope } });
      completeRun(command.sessionId, command.runId, 'approved:' + command.decision + ':' + command.scope);
      pendingRuns.delete(command.runId);
      return;
    }
    case 'answer_question': {
      ack(command.id);
      completeRun(command.sessionId, command.runId, 'answered:' + JSON.stringify(command.answers));
      pendingRuns.delete(command.runId);
      return;
    }
    case 'refresh_capabilities': {
      if (!env.FAKE_BRIDGE_SKIP_CAPABILITIES_FRAME) {
        write({ type: 'bridge.capabilities', protocolVersion: version, capabilities: [makeCapability('fixture-2.0.0', 'Refreshed')] });
      }
      return ack(command.id);
    }
    case 'refresh_mcp_status': {
      event({ type: 'mcp.status', runId: command.runId, servers: [{ name: 'fs', status: 'connected' }] });
      return ack(command.id);
    }
    default:
      return ack(command.id, 'unknown command ' + command.cmd);
  }
};
const buffered = [];
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  const command = JSON.parse(line);
  if (reverse > 0) {
    buffered.push(command);
    if (buffered.length !== reverse) return;
    setTimeout(() => { for (const queued of buffered.splice(0).reverse()) ack(queued.id); }, 100);
    return;
  }
  handle(command);
});
input.on('close', () => { if (heartbeat) clearInterval(heartbeat); process.exit(0); });
`
	.replace('__VERSION__', String(BRIDGE_PROTOCOL_VERSION))
	.replace('__CONTRACT__', BRIDGE_CONTRACT_NAME)
	.replace('__HEARTBEAT_INTERVAL__', String(BRIDGE_HEARTBEAT_INTERVAL_MS));

export interface FakeBridge {
	readonly scriptPath: string;
	readonly dir: string;
	spawnSpec(env?: Readonly<Record<string, string>>): BridgeSpawnSpec;
	supervisorConfig(
		env?: Readonly<Record<string, string>>,
		overrides?: Partial<BridgeSupervisorConfig>,
	): BridgeSupervisorConfig;
	cleanup(): void;
}

export function writeFakeBridge(): FakeBridge {
	const dir = mkdtempSync(join(tmpdir(), 'malini-fake-bridge-'));
	const scriptPath = join(dir, 'fake-bridge.cjs');
	writeFileSync(scriptPath, FAKE_BRIDGE_SCRIPT);
	const factory: BridgeProcessFactory = createNodeProcessFactory();
	const spawnSpec = (env: Readonly<Record<string, string>> = {}): BridgeSpawnSpec => ({
		scriptPath,
		args: ['--stdio'],
		env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...env },
	});
	return {
		scriptPath,
		dir,
		spawnSpec,
		supervisorConfig(env = {}, overrides = {}) {
			return {
				processFactory: factory,
				spawn: spawnSpec(env),
				log: () => {},
				...overrides,
			};
		},
		cleanup() {
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

export function recordingEventBus(): EventBus & {
	readonly frames: Array<{ channel: string; payload: unknown }>;
} {
	const bus = createEventBus({ forwardToWindows: false });
	const frames: Array<{ channel: string; payload: unknown }> = [];
	return {
		frames,
		emit(channel, payload) {
			frames.push({ channel, payload });
			bus.emit(channel, payload);
		},
		subscribe: (channel, listener) => bus.subscribe(channel, listener),
	};
}

export interface TestContext {
	readonly context: MainContext;
	readonly db: MaliniDatabase;
	readonly events: ReturnType<typeof recordingEventBus>;
	readonly appDataRoot: string;
	cleanup(): void;
}

export function createTestContext(): TestContext {
	const appDataRoot = mkdtempSync(join(tmpdir(), 'malini-bridge-'));
	const db = openMigratedDatabase(':memory:');
	const events = recordingEventBus();
	const context: MainContext = {
		db,
		commands: new CommandRegistry(),
		events,
		appDataRoot,
		resourcesRoot: appDataRoot,
		isDev: true,
		appVersion: '0.0.0-test',
	};
	return {
		context,
		db,
		events,
		appDataRoot,
		cleanup() {
			db.close();
			rmSync(appDataRoot, { recursive: true, force: true });
		},
	};
}

export function seedWorkstream(
	db: MaliniDatabase,
	appDataRoot: string,
	workstreamId: string,
): string {
	const checkout = join(appDataRoot, 'workstreams', workstreamId);
	mkdirSync(checkout, { recursive: true });
	const now = new Date().toISOString();
	const projectId = `project-${workstreamId}`;
	run(
		db,
		'INSERT OR IGNORE INTO projects (id, name, repo_path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)',
		projectId,
		projectId,
		join(appDataRoot, 'repositories', projectId),
		'main',
		now,
	);
	run(
		db,
		'INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		workstreamId,
		projectId,
		workstreamId,
		checkout,
		`malini/${workstreamId}`,
		'main',
		'active',
		now,
	);
	return checkout;
}

export function seedSession(
	db: MaliniDatabase,
	sessionId: string,
	workstreamId: string,
	status = 'idle',
	model: string | null = 'sonnet',
): void {
	run(
		db,
		'INSERT INTO agent_sessions (id, workstream_id, model, status, started_at) VALUES (?, ?, ?, ?, ?)',
		sessionId,
		workstreamId,
		model,
		status,
		new Date().toISOString(),
	);
}

export function seedOpenRun(
	db: MaliniDatabase,
	runId: string,
	sessionId: string,
	prompt = 'do it',
): void {
	run(
		db,
		'INSERT INTO agent_runs (id, session_id, prompt, started_at) VALUES (?, ?, ?, ?)',
		runId,
		sessionId,
		prompt,
		new Date().toISOString(),
	);
}

export function externalReadPath(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'malini-external-')));
	return join(dir, 'outside.txt');
}

export async function waitFor(
	condition: () => boolean,
	timeoutMs = 5_000,
	label = 'condition',
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	if (!condition()) throw new Error(`timed out waiting for ${label}`);
}

export function envelopesOn(events: ReturnType<typeof recordingEventBus>): Array<{
	sessionId: string;
	runId: string;
	seq: number;
	event: Record<string, unknown>;
	ephemeral?: boolean;
}> {
	return events.frames
		.filter((frame) => frame.channel === 'chat:agent-event')
		.map(
			(frame) =>
				frame.payload as {
					sessionId: string;
					runId: string;
					seq: number;
					event: Record<string, unknown>;
					ephemeral?: boolean;
				},
		);
}
