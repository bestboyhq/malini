import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { durableContainerRecords, recordStartedContainers } from '$main/docker/records';
import { openDatabase, type MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { get } from '$main/db/rows';
import { LABEL_APP } from '$main/docker/labels';
import {
	DockerOwnership,
	reconcileFrom,
	type OwnedContainer,
	type OwnedContainerRecord,
} from '$main/docker/ownership';
import {
	DockerCliReaper,
	UNGROUPED_PROJECT,
	containersToReclaim,
	groupByComposeProject,
	lastTeardownRecord,
	reclaimFrom,
	reclaimIsClean,
	recordUnfinishedTeardown,
	type ContainerReaper,
	type NetworkSweep,
} from '$main/docker/reclaim';
import { processIsAlive, runBounded } from '$main/process/runner';
import {
	ConfirmedShutdown,
	emptyShutdownImpact,
	openAgentRunCount,
	readShutdownImpact,
	shutdownImpactIsEmpty,
	type ShutdownChildren,
} from './graceful-shutdown';
import { removeAll } from '$main/fs/test-support';
import { ScriptedRunner, sleep } from '$main/process/test-support';

const BUNDLE = 'app.malini.desktop.dev';
const INSTANCE = 'this-instance';
const dirs: string[] = [];
const databases: MaliniDatabase[] = [];

afterEach(() => {
	for (const db of databases.splice(0)) db.close();
	removeAll(dirs);
});

function openDb(): MaliniDatabase {
	const db = openMigratedDatabase(':memory:');
	databases.push(db);
	return db;
}

function owned(id: string, state: string, mine: boolean, pid: number | null): OwnedContainer {
	return {
		containerId: id,
		containerName: `malini-${id}-svc-1`,
		state,
		bundleIdentifier: BUNDLE,
		appInstanceId: mine ? INSTANCE : 'a-previous-run',
		workstreamId: 'ws-a',
		composeProject: 'malini-ws-a',
		service: 'svc',
		owner: 'workstream',
		cwd: '/tmp/checkout',
		startedAt: '2026-07-26T00:00:00.000Z',
		appPid: pid,
		evidence: 'label-and-record',
		startedByThisInstance: mine,
	};
}

function record(id: string, pid: number | null, instance: string): OwnedContainerRecord {
	return {
		containerId: id,
		containerName: `malini-${id}-svc-1`,
		bundleIdentifier: BUNDLE,
		appInstanceId: instance,
		workstreamId: 'ws-a',
		composeProject: 'malini-ws-a',
		service: 'svc',
		owner: 'workstream',
		cwd: '/tmp/checkout',
		startedAt: '2026-07-26T00:00:00.000Z',
		releasedAt: null,
		appPid: pid,
	};
}

function releasedAt(db: MaliniDatabase, containerId: string): string | null {
	const row = get<{ released_at: string | null }>(
		db,
		'SELECT released_at FROM docker_containers WHERE container_id = ?',
		containerId,
	);
	if (!row) throw new Error(`no row for ${containerId}`);
	return row.released_at;
}

function aReapedPid(): number {
	const child = spawnSync('/bin/sh', ['-c', 'exit 0']);
	if (child.pid === undefined) throw new Error('spawn');
	return child.pid;
}

class RecordingReaper implements ContainerReaper {
	readonly removed: string[] = [];
	stopAndRemove(container: OwnedContainer): Promise<void> {
		this.removed.push(container.containerId);
		return Promise.resolve();
	}
}

class WedgedReaper implements ContainerReaper {
	async stopAndRemove(_container: OwnedContainer, deadline: number): Promise<void> {
		while (Date.now() < deadline) await sleep(5);
		throw new Error('container is wedged in `Removing`');
	}
}

class SelectiveReaper implements ContainerReaper {
	readonly swept: string[] = [];
	constructor(private readonly refuses: string) {}
	stopAndRemove(container: OwnedContainer): Promise<void> {
		if (container.containerId === this.refuses)
			return Promise.reject(new Error('this one will not go'));
		return Promise.resolve();
	}
	removeProjectNetworks(project: string): Promise<NetworkSweep> {
		this.swept.push(project);
		return Promise.resolve({ removed: [`${project}_default`], left: [] });
	}
}

function inProject(id: string, project: string): OwnedContainer {
	return { ...owned(id, 'running', true, process.pid), composeProject: project };
}

const alwaysAlive = (): boolean => true;
const neverAlive = (): boolean => false;

describe('only what this app started', () => {
	it('never makes a container this app cannot prove it started a candidate', () => {
		const live = [
			{ id: 'mine', name: 'malini-ws-a-svc-1', state: 'running', labels: { [LABEL_APP]: BUNDLE } },
			{ id: 'someone-elses-postgres', name: 'postgres', state: 'running', labels: {} },
			{
				id: 'the-production-build',
				name: 'malini-prod-svc-1',
				state: 'running',
				labels: { [LABEL_APP]: 'app.malini.desktop' },
			},
		];
		const all = reconcileFrom(BUNDLE, [record('mine', process.pid, INSTANCE)], live, INSTANCE);
		const candidates = containersToReclaim('started-by-this-run', all, alwaysAlive);
		expect(candidates.map((container) => container.containerId)).toEqual(['mine']);
	});

	it('reclaims only what this run started at quit', () => {
		const containers = [
			owned('this-run', 'running', true, process.pid),
			owned('a-previous-run', 'running', false, aReapedPid()),
		];
		expect(
			containersToReclaim('started-by-this-run', containers, neverAlive).map((c) => c.containerId),
		).toEqual(['this-run']);
	});

	it('keeps a still-running sibling’s containers', () => {
		const containers = [owned('siblings', 'running', false, process.pid)];
		expect(containersToReclaim('abandoned-by-a-previous-run', containers, processIsAlive)).toEqual(
			[],
		);
	});

	it('reclaims a container whose owner was reaped on boot', () => {
		const dead = aReapedPid();
		expect(processIsAlive(dead)).toBe(false);
		const containers = [
			owned('abandoned', 'running', false, dead),
			owned('this-run', 'running', true, process.pid),
		];
		expect(
			containersToReclaim('abandoned-by-a-previous-run', containers, processIsAlive).map(
				(c) => c.containerId,
			),
		).toEqual(['abandoned']);
	});

	it('treats a container with no recorded owner as abandoned', () => {
		const containers = [owned('no-pid', 'running', false, null)];
		expect(
			containersToReclaim('abandoned-by-a-previous-run', containers, processIsAlive),
		).toHaveLength(1);
	});
});

describe('bookkeeping', () => {
	it('stops claiming a removed container', async () => {
		const db = openDb();
		recordStartedContainers(db, [record('gone', process.pid, INSTANCE)]);
		const reaper = new RecordingReaper();
		const reclaim = await reclaimFrom(
			db,
			'started-by-this-run',
			[owned('gone', 'running', true, process.pid)],
			reaper,
			Date.now() + 5_000,
			alwaysAlive,
		);
		expect(reclaim.removed).toEqual(['gone']);
		expect(reclaimIsClean(reclaim)).toBe(true);
		expect(reaper.removed).toEqual(['gone']);
		expect(releasedAt(db, 'gone')).not.toBeNull();
	});

	it('closes a record whose container is gone without touching the daemon', async () => {
		const db = openDb();
		recordStartedContainers(db, [record('vanished', process.pid, INSTANCE)]);
		const runner = new ScriptedRunner();
		const reclaim = await reclaimFrom(
			db,
			'started-by-this-run',
			[owned('vanished', 'missing', true, process.pid)],
			new DockerCliReaper(runner),
			Date.now() + 5_000,
			alwaysAlive,
		);
		expect(reclaim.removed).toEqual(['vanished']);
		expect(runner.spawns).toHaveLength(0);
		expect(releasedAt(db, 'vanished')).not.toBeNull();
	});
});

describe('the bound', () => {
	it('bounds the quit on a container that will not stop and leaves a retry behind', async () => {
		const db = openDb();
		for (const id of ['wedged', 'fine']) {
			recordStartedContainers(db, [record(id, process.pid, INSTANCE)]);
		}
		const budget = 300;
		const started = Date.now();
		const reclaim = await reclaimFrom(
			db,
			'started-by-this-run',
			[owned('wedged', 'running', true, process.pid), owned('fine', 'running', true, process.pid)],
			new WedgedReaper(),
			started + budget,
			alwaysAlive,
		);
		expect(Date.now() - started).toBeLessThan(budget * 6);
		expect(reclaim.timedOut).toBe(true);
		expect(reclaim.removed).toEqual([]);
		expect(new Set(reclaim.unfinished.map((entry) => entry.containerId))).toEqual(
			new Set(['wedged', 'fine']),
		);
		expect(reclaim.unfinished.some((entry) => entry.reason.includes('wedged'))).toBe(true);
		expect(reclaim.unfinished.some((entry) => entry.reason.includes('budget'))).toBe(true);
		for (const id of ['wedged', 'fine']) expect(releasedAt(db, id)).toBeNull();
	});

	it('records what the teardown could not finish', async () => {
		const db = openDb();
		recordStartedContainers(db, [record('wedged', process.pid, INSTANCE)]);
		const reclaim = await reclaimFrom(
			db,
			'started-by-this-run',
			[owned('wedged', 'running', true, process.pid)],
			new WedgedReaper(),
			Date.now() + 100,
			alwaysAlive,
		);
		recordUnfinishedTeardown(db, 'quit', reclaim);
		const recorded = lastTeardownRecord(db);
		expect(recorded).toContain('wedged');
		expect(recorded).toContain('"phase":"quit"');
		expect(recorded).toContain('"timedOut":true');
		expect(releasedAt(db, 'wedged')).toBeNull();
	});

	it('kills a child that never exits at the deadline', async () => {
		const runner = new ScriptedRunner().onCommand('docker', [], { kind: 'hang' });
		const started = Date.now();
		const run = await runBounded(runner, 'docker', ['stop', 'x'], { deadline: started + 200 });
		expect(run.exitCode).toBeNull();
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(runner.groupSignals.at(-1)?.signal).toBe('SIGKILL');
	});

	it('reports the status of a child that exits', async () => {
		const runner = new ScriptedRunner().onCommand('docker', [], {
			kind: 'exit',
			code: 3,
			stderr: 'boom\n',
		});
		const run = await runBounded(runner, 'docker', ['rm', 'x'], { deadline: Date.now() + 5_000 });
		expect(run.exitCode).toBe(3);
		expect(run.stderr).toBe('boom\n');
	});
});

describe('the docker CLI reaper', () => {
	it('stops, removes, and confirms with an independent inspect', async () => {
		const runner = new ScriptedRunner()
			.onCommand('docker', ['stop'], { kind: 'exit', code: 0 })
			.onCommand('docker', ['rm'], { kind: 'exit', code: 0 })
			.onCommand('docker', ['inspect'], { kind: 'exit', code: 1, stderr: 'No such object: abc\n' });
		await new DockerCliReaper(runner).stopAndRemove(
			owned('abc', 'running', true, process.pid),
			Date.now() + 60_000,
		);
		expect(runner.spawns.map((spawn) => spawn.args)).toEqual([
			['stop', '--time', '5', 'abc'],
			['rm', '--force', '--volumes', 'abc'],
			['inspect', '--format', '{{.Id}}', 'abc'],
		]);
	});

	it('skips the polite stop for a container that is not live and accepts an already-gone one', async () => {
		const runner = new ScriptedRunner()
			.onCommand('docker', ['rm'], {
				kind: 'exit',
				code: 1,
				stderr: 'Error: No such container: abc\n',
			})
			.onCommand('docker', ['inspect'], { kind: 'exit', code: 1 });
		await new DockerCliReaper(runner).stopAndRemove(
			owned('abc', 'exited', true, process.pid),
			Date.now() + 5_000,
		);
		expect(runner.spawns.map((spawn) => spawn.args[0])).toEqual(['rm', 'inspect']);
	});

	it('refuses to report a container removed while inspect still resolves it', async () => {
		const runner = new ScriptedRunner()
			.onCommand('docker', ['rm'], { kind: 'exit', code: 0 })
			.onCommand('docker', ['inspect'], { kind: 'exit', code: 0, stdout: 'abc\n' });
		await expect(
			new DockerCliReaper(runner).stopAndRemove(
				owned('abc', 'exited', true, 1),
				Date.now() + 5_000,
			),
		).rejects.toThrow('`docker inspect` still resolves container abc');
	});

	it('sweeps only empty networks and names the ones it left', async () => {
		const runner = new ScriptedRunner()
			.onCommand('docker', ['network', 'ls'], {
				kind: 'exit',
				code: 0,
				stdout: 'p_default\np_shared\n',
			})
			.on((_, args) => args[1] === 'inspect' && args[4] === 'p_default', {
				kind: 'exit',
				code: 0,
				stdout: '0\n',
			})
			.on((_, args) => args[1] === 'inspect' && args[4] === 'p_shared', {
				kind: 'exit',
				code: 0,
				stdout: '2\n',
			})
			.onCommand('docker', ['network', 'rm'], { kind: 'exit', code: 0 });
		const sweep = await new DockerCliReaper(runner).removeProjectNetworks('p', Date.now() + 5_000);
		expect(sweep.removed).toEqual(['p_default']);
		expect(sweep.left).toEqual([
			{ network: 'p_shared', reason: '2 container(s) this app does not own are still attached' },
		]);
		expect(runner.spawns[0]?.args).toEqual([
			'network',
			'ls',
			'--filter',
			'label=com.docker.compose.project=p',
			'--format',
			'{{.Name}}',
		]);
	});
});

describe('compose networks', () => {
	it('sweeps only a project this pass emptied', async () => {
		const db = openDb();
		for (const id of ['a1', 'a2', 'b1', 'b2']) {
			recordStartedContainers(db, [record(id, process.pid, INSTANCE)]);
		}
		const reaper = new SelectiveReaper('b2');
		const reclaim = await reclaimFrom(
			db,
			'started-by-this-run',
			[
				inProject('a1', 'malini-ws-a'),
				inProject('a2', 'malini-ws-a'),
				inProject('b1', 'malini-ws-b'),
				inProject('b2', 'malini-ws-b'),
			],
			reaper,
			Date.now() + 5_000,
			alwaysAlive,
		);
		expect(reaper.swept).toEqual(['malini-ws-a']);
		expect(reclaim.networksRemoved).toEqual(['malini-ws-a_default']);
		expect(reclaim.networksLeft).toEqual([]);
	});

	it('sweeps no networks when nothing was removed', async () => {
		const db = openDb();
		recordStartedContainers(db, [record('wedged', process.pid, INSTANCE)]);
		const reaper = new SelectiveReaper('wedged');
		const reclaim = await reclaimFrom(
			db,
			'started-by-this-run',
			[inProject('wedged', 'malini-ws-a')],
			reaper,
			Date.now() + 5_000,
			alwaysAlive,
		);
		expect(reaper.swept).toEqual([]);
		expect(reclaim.networksRemoved).toEqual([]);
		expect(reclaim.unfinished).toHaveLength(1);
	});

	it('sweeps nothing for a container with no compose project', async () => {
		const db = openDb();
		recordStartedContainers(db, [record('loose', process.pid, INSTANCE)]);
		const reaper = new SelectiveReaper('nothing');
		const reclaim = await reclaimFrom(
			db,
			'started-by-this-run',
			[{ ...owned('loose', 'running', true, process.pid), composeProject: null }],
			reaper,
			Date.now() + 5_000,
			alwaysAlive,
		);
		expect(reclaim.removed).toEqual(['loose']);
		expect(reaper.swept).toEqual([]);
	});

	it('groups containers by their compose project', () => {
		const a = { ...owned('a', 'running', true, null), composeProject: 'malini-ws-a' };
		const b = { ...owned('b', 'running', true, null), composeProject: 'malini-ws-a' };
		const c = { ...owned('c', 'running', true, null), composeProject: 'malini-ws-b' };
		const loose = { ...owned('d', 'running', true, null), composeProject: null };
		const grouped = groupByComposeProject([a, b, c, loose]);
		expect(grouped.size).toBe(3);
		expect(grouped.get('malini-ws-a')).toHaveLength(2);
		expect(grouped.get('malini-ws-b')).toHaveLength(1);
		expect(grouped.get(UNGROUPED_PROJECT)).toHaveLength(1);
	});
});

describe('the confirmed shutdown', () => {
	function children(
		overrides: Partial<ShutdownChildren> = {},
	): ShutdownChildren & { calls: string[] } {
		const calls: string[] = [];
		return {
			calls,
			cancelAgentRuns: () => {
				calls.push('agent-runs');
				return Promise.resolve(2);
			},
			...overrides,
		};
	}

	function ownershipWith(db: MaliniDatabase, runner: ScriptedRunner): DockerOwnership {
		const appDataRoot = mkdtempSync(join(tmpdir(), 'malini-shutdown-'));
		dirs.push(appDataRoot);
		return new DockerOwnership({
			db,
			runner,
			appDataRoot,
			bundleIdentifier: BUNDLE,
			appInstanceId: INSTANCE,
		});
	}

	it('reclaims, closes runs, and runs the destructive half once', async () => {
		const db = openDb();
		recordStartedContainers(db, [record('mine', process.pid, INSTANCE)]);
		const runner = new ScriptedRunner().onCommand('docker', ['ps'], {
			kind: 'exit',
			code: 0,
			stdout: `mine\tcore-mine-svc-1\trunning\t${LABEL_APP}=${BUNDLE}\nforeign\tpostgres\trunning\t\n`,
		});
		const reaper = new RecordingReaper();
		const kids = children();
		const shutdown = new ConfirmedShutdown({
			db,
			ownership: ownershipWith(db, runner),
			reaper,
			children: kids,
			ownerIsAlive: alwaysAlive,
		});
		const outcome = await shutdown.run(5_000);
		expect(outcome).toMatchObject({
			containersRemoved: ['mine'],
			containersUnfinished: [],
			networksRemoved: [],
			agentRunsClosed: 2,
			timedOut: false,
			alreadyReclaimed: false,
			errors: [],
		});
		expect(typeof outcome.durationMs).toBe('number');
		expect(reaper.removed).toEqual(['mine']);
		expect(kids.calls).toEqual(['agent-runs']);
		expect(durableContainerRecords(db, BUNDLE)).toEqual([]);
		expect(lastTeardownRecord(db)).toContain('"phase":"quit"');

		const again = await shutdown.run(5_000);
		expect(again.alreadyReclaimed).toBe(true);
		expect(again.containersRemoved).toEqual([]);
		expect(reaper.removed).toEqual(['mine']);
		expect(runner.spawns).toHaveLength(1);
		expect(kids.calls).toEqual(['agent-runs']);
	});

	it('never runs docker at quit when this run started no containers', async () => {
		const db = openDb();
		const runner = new ScriptedRunner().onCommand('docker', ['ps'], {
			kind: 'spawn-failure',
			error: 'spawn docker ENOENT',
		});
		const shutdown = new ConfirmedShutdown({
			db,
			ownership: ownershipWith(db, runner),
			reaper: new RecordingReaper(),
			children: children(),
			ownerIsAlive: alwaysAlive,
		});
		const outcome = await shutdown.run(5_000);
		expect(outcome.errors).toEqual([]);
		expect(outcome.agentRunsClosed).toBe(2);
		expect(runner.spawns).toHaveLength(0);
	});

	it('never fails the quit: an unreachable daemon and a failing step become errors', async () => {
		const db = openDb();
		recordStartedContainers(db, [record('mine', process.pid, INSTANCE)]);
		const runner = new ScriptedRunner().onCommand('docker', ['ps'], {
			kind: 'spawn-failure',
			error: 'spawn docker ENOENT',
		});
		const shutdown = new ConfirmedShutdown({
			db,
			ownership: ownershipWith(db, runner),
			reaper: new RecordingReaper(),
			children: children({
				cancelAgentRuns: () => Promise.reject(new Error('bridge gone')),
			}),
			ownerIsAlive: alwaysAlive,
		});
		const outcome = await shutdown.run(5_000);
		expect(outcome.errors).toHaveLength(2);
		expect(outcome.errors[0]).toMatch(
			/^could not enumerate owned containers: could not run `docker ps`: .*spawn docker ENOENT$/,
		);
		expect(outcome.errors.slice(1)).toEqual(['could not close open agent runs: bridge gone']);
		expect(outcome.agentRunsClosed).toBe(0);
	});

	it('reports a budget overrun as timed out and keeps the row claimed', async () => {
		const db = openDb();
		recordStartedContainers(db, [record('wedged', process.pid, INSTANCE)]);
		const runner = new ScriptedRunner().onCommand('docker', ['ps'], {
			kind: 'exit',
			code: 0,
			stdout: `wedged\tcore-wedged-svc-1\trunning\t${LABEL_APP}=${BUNDLE}\n`,
		});
		const shutdown = new ConfirmedShutdown({
			db,
			ownership: ownershipWith(db, runner),
			reaper: new WedgedReaper(),
			children: children(),
			ownerIsAlive: alwaysAlive,
		});
		const outcome = await shutdown.run(150);
		expect(outcome.timedOut).toBe(true);
		expect(outcome.containersUnfinished.map((entry) => entry.containerId)).toEqual(['wedged']);
		expect(outcome.containersUnfinished[0]?.composeProject).toBe('malini-ws-a');
		expect(releasedAt(db, 'wedged')).toBeNull();
	});
});

describe('ShutdownImpact', () => {
	it('has exactly the keys the renderer reads', () => {
		expect(readShutdownImpact({ agentRuns: () => 1, containers: () => 6 })).toEqual({
			agentRuns: 1,
			containers: 6,
		});
	});

	it('an idle app reports an empty impact, and a missing or failing source reads zero', () => {
		expect(shutdownImpactIsEmpty(emptyShutdownImpact())).toBe(true);
		expect(shutdownImpactIsEmpty({ ...emptyShutdownImpact(), containers: 1 })).toBe(false);
		const impact = readShutdownImpact({
			containers: () => {
				throw new Error('docker is down');
			},
			agentRuns: () => -3,
		});
		expect(impact).toEqual(emptyShutdownImpact());
	});

	it('counts open agent runs from the durable record, or zero before the table exists', () => {
		const db = openDatabase(':memory:');
		try {
			expect(openAgentRunCount(db)).toBe(0);
			db.exec(
				'CREATE TABLE agent_runs (id TEXT PRIMARY KEY, completed_at TEXT NULL); ' +
					"INSERT INTO agent_runs VALUES ('a', NULL), ('b', NULL), ('c', '2026-09-18T00:00:00Z');",
			);
			expect(openAgentRunCount(db)).toBe(2);
		} finally {
			db.close();
		}
	});
});
