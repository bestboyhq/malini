import { describeError } from '$main/errors';
import { buildSpawnEnvironment } from '$main/process/environment';
import {
	boundedRunFailureReason,
	boundedRunLines,
	boundedRunSucceeded,
	runBounded,
	type BoundedRun,
	type ProcessRunner,
} from '$main/process/runner';
import type { MaliniDatabase } from '../db/driver';
import { markContainerReleased } from './records';
import { get, nowIso8601, run } from '../db/rows';
import { dockerBinary } from './cli';
import type { DockerOwnership, OwnedContainer } from './ownership';

export const STARTUP_RECLAIM_BUDGET_MS = 60_000;
export const UNFINISHED_TEARDOWN_SETTING = 'lifecycle.unfinished_teardown';
export const UNGROUPED_PROJECT = '<unknown>';

const CONTAINER_STOP_GRACE_MS = 5_000;
const LIVE_STATES = new Set(['running', 'restarting', 'paused', 'removing']);
const MISSING_STATE = 'missing';

export type ReclaimScope = 'started-by-this-run' | 'abandoned-by-a-previous-run';

export function containersToReclaim(
	scope: ReclaimScope,
	owned: readonly OwnedContainer[],
	ownerIsAlive: (pid: number) => boolean,
): OwnedContainer[] {
	return owned.filter((container) => {
		if (scope === 'started-by-this-run') return container.startedByThisInstance;
		if (container.startedByThisInstance) return false;
		return container.appPid === null ? true : !ownerIsAlive(container.appPid);
	});
}

export interface UnfinishedContainer {
	containerId: string;
	containerName: string;
	composeProject: string | null;
	reason: string;
}

export interface UnremovedNetwork {
	network: string;
	reason: string;
}

export interface NetworkSweep {
	removed: string[];
	left: UnremovedNetwork[];
}

export interface ContainerReclaim {
	removed: string[];
	unfinished: UnfinishedContainer[];
	networksRemoved: string[];
	networksLeft: UnremovedNetwork[];
	timedOut: boolean;
}

export function emptyReclaim(): ContainerReclaim {
	return { removed: [], unfinished: [], networksRemoved: [], networksLeft: [], timedOut: false };
}

export function reclaimIsClean(reclaim: ContainerReclaim): boolean {
	return reclaim.unfinished.length === 0 && !reclaim.timedOut;
}

export interface ContainerReaper {
	stopAndRemove(container: OwnedContainer, deadline: number): Promise<void>;
	removeProjectNetworks?(project: string, deadline: number): Promise<NetworkSweep>;
}

export class DockerCliReaper implements ContainerReaper {
	constructor(private readonly runner: ProcessRunner) {}

	private docker(args: readonly string[], deadline: number): Promise<BoundedRun> {
		return runBounded(this.runner, dockerBinary(), args, {
			deadline,
			env: buildSpawnEnvironment(),
		});
	}

	async stopAndRemove(container: OwnedContainer, deadline: number): Promise<void> {
		if (container.state === MISSING_STATE) return;
		const id = container.containerId;
		if (LIVE_STATES.has(container.state)) {
			const grace = Math.min(remaining(deadline), CONTAINER_STOP_GRACE_MS);
			const seconds = String(Math.max(1, Math.floor(grace / 1000)));
			try {
				await this.docker(
					['stop', '--time', seconds, id],
					Math.min(deadline, Date.now() + grace + 2_000),
				);
			} catch {}
		}
		const removed = await this.docker(['rm', '--force', '--volumes', id], deadline);
		if (!boundedRunSucceeded(removed) && !mentionsNoSuchContainer(removed)) {
			throw new Error(boundedRunFailureReason(removed, 'docker rm'));
		}
		const inspect = await this.docker(['inspect', '--format', '{{.Id}}', id], deadline);
		if (boundedRunSucceeded(inspect)) {
			throw new Error(`\`docker inspect\` still resolves container ${id}`);
		}
	}

	async removeProjectNetworks(project: string, deadline: number): Promise<NetworkSweep> {
		const listed = await this.docker(
			[
				'network',
				'ls',
				'--filter',
				`label=com.docker.compose.project=${project}`,
				'--format',
				'{{.Name}}',
			],
			deadline,
		);
		if (!boundedRunSucceeded(listed)) {
			throw new Error(boundedRunFailureReason(listed, 'docker network ls'));
		}
		const sweep: NetworkSweep = { removed: [], left: [] };
		for (const network of boundedRunLines(listed)) {
			if (Date.now() >= deadline) {
				sweep.left.push({
					network,
					reason: 'the shutdown budget ran out before this network was reached',
				});
				continue;
			}
			const attached = await this.docker(
				['network', 'inspect', '--format', '{{len .Containers}}', network],
				deadline,
			);
			if (!boundedRunSucceeded(attached)) {
				if (!mentionsMissing(attached)) {
					sweep.left.push({
						network,
						reason: boundedRunFailureReason(attached, 'docker network inspect'),
					});
				}
				continue;
			}
			const endpoints = attached.stdout.trim();
			if (endpoints !== '0') {
				sweep.left.push({
					network,
					reason: `${endpoints} container(s) this app does not own are still attached`,
				});
				continue;
			}
			const removed = await this.docker(['network', 'rm', network], deadline);
			if (boundedRunSucceeded(removed) || mentionsMissing(removed)) sweep.removed.push(network);
			else
				sweep.left.push({ network, reason: boundedRunFailureReason(removed, 'docker network rm') });
		}
		return sweep;
	}
}

function mentionsNoSuchContainer(run: BoundedRun): boolean {
	const lowered = run.stderr.toLowerCase();
	return lowered.includes('no such container') || lowered.includes('is already in progress');
}

function mentionsMissing(run: BoundedRun): boolean {
	const lowered = run.stderr.toLowerCase();
	return lowered.includes('no such network') || lowered.includes('not found');
}

function remaining(deadline: number): number {
	return Math.max(0, deadline - Date.now());
}

export async function reclaimContainers(
	db: MaliniDatabase,
	ownership: DockerOwnership,
	scope: ReclaimScope,
	reaper: ContainerReaper,
	deadline: number,
	ownerIsAlive: (pid: number) => boolean,
): Promise<ContainerReclaim> {
	const owned = await ownership.reconcile();
	return reclaimFrom(db, scope, owned, reaper, deadline, ownerIsAlive);
}

export async function reclaimFrom(
	db: MaliniDatabase,
	scope: ReclaimScope,
	owned: readonly OwnedContainer[],
	reaper: ContainerReaper,
	deadline: number,
	ownerIsAlive: (pid: number) => boolean,
): Promise<ContainerReclaim> {
	const targets = containersToReclaim(scope, owned, ownerIsAlive);
	const byProject = groupByComposeProject(targets);
	const reclaim = emptyReclaim();
	for (const container of targets) {
		if (Date.now() >= deadline) {
			reclaim.timedOut = true;
			reclaim.unfinished.push(
				unfinished(container, 'the shutdown budget ran out before this container was reached'),
			);
			continue;
		}
		try {
			await reaper.stopAndRemove(container, deadline);
		} catch (error) {
			if (Date.now() >= deadline) reclaim.timedOut = true;
			reclaim.unfinished.push(unfinished(container, describeError(error)));
			continue;
		}
		try {
			markContainerReleased(db, container.containerId);
		} catch (error) {
			console.error(
				`environment: removed container ${container.containerId} but could not clear its record: ${describeError(error)}`,
			);
		}
		reclaim.removed.push(container.containerId);
	}
	await sweepProjectNetworks(byProject, reaper, deadline, reclaim);
	return reclaim;
}

async function sweepProjectNetworks(
	byProject: Map<string, OwnedContainer[]>,
	reaper: ContainerReaper,
	deadline: number,
	reclaim: ContainerReclaim,
): Promise<void> {
	if (!reaper.removeProjectNetworks) return;
	const removed = new Set(reclaim.removed);
	const emptied = [...byProject]
		.filter(
			([project, containers]) =>
				project !== UNGROUPED_PROJECT &&
				containers.every((container) => removed.has(container.containerId)),
		)
		.map(([project]) => project);
	for (const project of emptied) {
		if (Date.now() >= deadline) {
			reclaim.timedOut = true;
			reclaim.networksLeft.push({
				network: `${project}_*`,
				reason: "the shutdown budget ran out before this project's networks were reached",
			});
			continue;
		}
		try {
			const sweep = await reaper.removeProjectNetworks(project, deadline);
			reclaim.networksRemoved.push(...sweep.removed);
			reclaim.networksLeft.push(...sweep.left);
		} catch (error) {
			reclaim.networksLeft.push({ network: `${project}_*`, reason: describeError(error) });
		}
	}
}

export function groupByComposeProject(
	containers: readonly OwnedContainer[],
): Map<string, OwnedContainer[]> {
	const grouped = new Map<string, OwnedContainer[]>();
	for (const container of containers) {
		const project = container.composeProject ?? UNGROUPED_PROJECT;
		const bucket = grouped.get(project);
		if (bucket) bucket.push(container);
		else grouped.set(project, [container]);
	}
	return grouped;
}

function unfinished(container: OwnedContainer, reason: string): UnfinishedContainer {
	return {
		containerId: container.containerId,
		containerName: container.containerName,
		composeProject: container.composeProject,
		reason,
	};
}

export function recordUnfinishedTeardown(
	db: MaliniDatabase,
	phase: 'quit' | 'boot',
	reclaim: ContainerReclaim,
): void {
	const value = JSON.stringify({
		phase,
		recordedAt: nowIso8601(),
		timedOut: reclaim.timedOut,
		removed: reclaim.removed.length,
		unfinished: reclaim.unfinished,
		networksRemoved: reclaim.networksRemoved,
		networksLeft: reclaim.networksLeft,
	});
	try {
		run(
			db,
			`INSERT INTO settings (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
			UNFINISHED_TEARDOWN_SETTING,
			value,
		);
	} catch (error) {
		console.error(`environment: could not record the teardown result: ${describeError(error)}`);
	}
}

export function lastTeardownRecord(db: MaliniDatabase): string | null {
	try {
		const row = get<{ value: string }>(
			db,
			'SELECT value FROM settings WHERE key = ?',
			UNFINISHED_TEARDOWN_SETTING,
		);
		return row ? row.value : null;
	} catch {
		return null;
	}
}
