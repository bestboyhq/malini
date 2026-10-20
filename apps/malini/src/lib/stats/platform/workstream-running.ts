import { isDeepStrictEqual } from 'node:util';
import type { LiveEventEnvelope } from '$contract/agent';
import {
	CHAT_AGENT_EVENT_CHANNEL,
	STATS_WORKSTREAM_RUNNING_CHANGED_CHANNEL,
} from '$contract/events';
import type { RunningItem, WorkstreamRunning } from '$contract/stats';
import type { MaliniDatabase } from '$main/db/driver';
import { dockerBinary } from '$main/docker/cli';
import { describeError } from '$main/errors';
import type { EventBus } from '$main/events';
import { buildSpawnEnvironment, resolveToolPath } from '$main/process/environment';
import {
	boundedRunFailureReason,
	boundedRunSucceeded,
	runBounded,
	type BoundedRun,
	type ProcessRunner,
} from '$main/process/runner';
import {
	backgroundCommandSource,
	latestWorkstreamTurn,
	listOpenBackgroundCommands,
	type OpenBackgroundCommand,
} from '$lib/chat/chat.platform';
import { listWorkstreams } from '$shared/repositories/repositories.platform';
import { dockerRunning, parseDockerInspect, type DockerContainer } from './running-docker';
import {
	commandDetail,
	commandDirectory,
	fallbackServiceName,
	folderName,
	namingTask,
	nearestPackageName,
	parseServiceName,
	type ServiceName,
} from './running-names';
import { readPortsByFile, type PortTool } from './running-ports';

const POLL_MS = 5_000;
const DOCKER_SCAN_MS = 15_000;
const EVENT_DEBOUNCE_MS = 300;
const DOCKER_AFTER_COMMAND_MS = 1_000;
const LOOKUP_TIMEOUT_MS = 4_000;
const DOCKER_TIMEOUT_MS = 10_000;
const DOCKER_STOP_TIMEOUT_MS = 20_000;
const REFRESHING_EVENTS = new Set([
	'background.updated',
	'run.completed',
	'run.failed',
	'command.completed',
]);
const TOOL_FALLBACKS: Readonly<Record<PortTool, string>> = {
	lsof: '/usr/sbin/lsof',
	ps: '/bin/ps',
};

export interface WorkstreamRunningDeps {
	readonly db: MaliniDatabase;
	readonly events: EventBus;
	readonly runner: ProcessRunner;
	nameService(task: string): Promise<string>;
	stopBackgroundTask(sessionId: string, taskId: string): Promise<void>;
}

interface AgentCommand {
	readonly detail: string;
	readonly outputFile: string | null;
	readonly fallbackName: string;
	readonly namingTask: string | null;
}

type StopTarget =
	| { readonly origin: 'agent'; readonly sessionId: string; readonly taskId: string }
	| { readonly origin: 'docker'; readonly containerId: string };

export class WorkstreamRunningMonitor {
	readonly #deps: WorkstreamRunningDeps;
	#snapshot: readonly WorkstreamRunning[] = [];
	#built = false;
	#targets = new Map<string, StopTarget>();
	#commands = new Map<string, AgentCommand>();
	// ponytail: names are kept for the app's lifetime, prune them by age if that ever grows
	#names = new Map<string, ServiceName>();
	#naming = new Set<string>();
	#containers: readonly DockerContainer[] = [];
	#scanDocker = false;
	#queued: Promise<void> | null = null;
	#tail: Promise<void> = Promise.resolve();
	#unsubscribe: (() => void) | null = null;
	#stopped = false;
	#failureReported = false;
	#dockerTimer: NodeJS.Timeout | null = null;
	#pollTimer: NodeJS.Timeout | null = null;
	#eventTimer: NodeJS.Timeout | null = null;
	#dockerSoonTimer: NodeJS.Timeout | null = null;

	constructor(deps: WorkstreamRunningDeps) {
		this.#deps = deps;
	}

	start(): void {
		if (this.#unsubscribe) return;
		this.#stopped = false;
		this.#unsubscribe = this.#deps.events.subscribe(CHAT_AGENT_EVENT_CHANNEL, (envelope) =>
			this.#heard(envelope),
		);
		this.#dockerTimer = setInterval(() => void this.refresh(true), DOCKER_SCAN_MS);
		this.#dockerTimer.unref();
		void this.refresh(true);
	}

	stop(): void {
		this.#stopped = true;
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		for (const timer of [
			this.#dockerTimer,
			this.#pollTimer,
			this.#eventTimer,
			this.#dockerSoonTimer,
		]) {
			if (timer) clearTimeout(timer);
		}
		this.#dockerTimer = null;
		this.#pollTimer = null;
		this.#eventTimer = null;
		this.#dockerSoonTimer = null;
	}

	async snapshot(): Promise<readonly WorkstreamRunning[]> {
		if (!this.#built) await this.refresh(true);
		return this.#snapshot;
	}

	refresh(scanDocker = false): Promise<void> {
		this.#scanDocker ||= scanDocker;
		if (!this.#queued) {
			this.#queued = this.#after(this.#tail);
			this.#tail = this.#queued;
		}
		return this.#queued;
	}

	async #after(previous: Promise<void>): Promise<void> {
		await previous;
		this.#queued = null;
		const scanDocker = this.#scanDocker;
		this.#scanDocker = false;
		await this.#build(scanDocker);
	}

	async stopItems(workstreamId: string, itemIds: readonly string[]): Promise<void> {
		const listed = new Set(
			this.#snapshot
				.find((workstream) => workstream.workstreamId === workstreamId)
				?.items.map((item) => item.id),
		);
		const targets = itemIds.flatMap((id) => (listed.has(id) ? (this.#targets.get(id) ?? []) : []));
		if (targets.length === 0) return;
		const stopped = await Promise.allSettled(targets.map((target) => this.#stopTarget(target)));
		await this.refresh(targets.some((target) => target.origin === 'docker'));
		const failed = stopped.find((outcome) => outcome.status === 'rejected');
		if (failed) {
			const reason: unknown = failed.reason;
			throw reason;
		}
	}

	async #stopTarget(target: StopTarget): Promise<void> {
		if (target.origin === 'agent') {
			await this.#deps.stopBackgroundTask(target.sessionId, target.taskId);
			return;
		}
		const run = await runBounded(this.#deps.runner, dockerBinary(), ['stop', target.containerId], {
			deadline: Date.now() + DOCKER_STOP_TIMEOUT_MS,
			env: buildSpawnEnvironment(),
		});
		if (!boundedRunSucceeded(run)) throw new Error(boundedRunFailureReason(run, 'docker stop'));
	}

	#heard(envelope: LiveEventEnvelope): void {
		const type = envelope.event['type'];
		if (envelope.ephemeral || typeof type !== 'string' || !REFRESHING_EVENTS.has(type)) return;
		if (this.#eventTimer) clearTimeout(this.#eventTimer);
		this.#eventTimer = setTimeout(() => {
			this.#eventTimer = null;
			void this.refresh();
		}, EVENT_DEBOUNCE_MS);
		this.#eventTimer.unref();
		if (type !== 'command.completed') return;
		if (this.#dockerSoonTimer) clearTimeout(this.#dockerSoonTimer);
		this.#dockerSoonTimer = setTimeout(() => {
			this.#dockerSoonTimer = null;
			void this.refresh(true);
		}, DOCKER_AFTER_COMMAND_MS);
		this.#dockerSoonTimer.unref();
	}

	async #build(scanDocker: boolean): Promise<void> {
		try {
			await this.#rebuild(scanDocker);
		} catch (error) {
			if (this.#stopped || this.#failureReported) return;
			this.#failureReported = true;
			console.warn(`malini: could not read what keeps running: ${describeError(error)}`);
		}
	}

	async #rebuild(scanDocker: boolean): Promise<void> {
		const { db } = this.#deps;
		const folders = listWorkstreams(db).map(({ id, path }) => ({ id, path }));
		const paths = new Map(folders.map(({ id, path }) => [id, path]));
		const agents = listOpenBackgroundCommands(db).flatMap((command) => {
			const path = paths.get(command.workstreamId);
			if (path === undefined) return [];
			const id = `agent:${command.sessionId}:${command.taskId}`;
			return [{ id, command, resolved: this.#agentCommand(id, command, path) }];
		});
		const [ports, containers] = await Promise.all([
			readPortsByFile(
				(tool, args) => this.#readTool(tool, args),
				agents.flatMap(({ resolved }) => resolved.outputFile ?? []),
			),
			scanDocker ? this.#scanContainers() : this.#containers,
		]);
		if (this.#stopped) return;
		this.#containers = containers;

		const agentItems = new Map<string, RunningItem[]>();
		const targets = new Map<string, StopTarget>();
		for (const { id, command, resolved } of agents) {
			if (resolved.namingTask !== null) this.#requestName(id, resolved.namingTask);
			const named = this.#names.get(id);
			const item: RunningItem = {
				id,
				origin: 'agent',
				name: named?.name ?? resolved.fallbackName,
				kind: named?.kind ?? 'service',
				detail: resolved.detail,
				group: null,
				startedAt: command.startedAt,
				ports: (resolved.outputFile === null ? undefined : ports.get(resolved.outputFile)) ?? [],
			};
			agentItems.set(command.workstreamId, [...(agentItems.get(command.workstreamId) ?? []), item]);
			targets.set(id, { origin: 'agent', sessionId: command.sessionId, taskId: command.taskId });
		}
		const docker = dockerRunning(containers, folders);
		for (const { items } of docker.values()) {
			for (const { id } of items) {
				targets.set(id, { origin: 'docker', containerId: id.slice('docker:'.length) });
			}
		}

		const snapshot = [...new Set([...agentItems.keys(), ...docker.keys()])]
			.sort()
			.flatMap((workstreamId): WorkstreamRunning[] => {
				const items = [
					...(agentItems.get(workstreamId) ?? []).sort(
						(left, right) => left.startedAt - right.startedAt,
					),
					...(docker.get(workstreamId)?.items ?? []),
				];
				if (items.length === 0) return [];
				const turn = latestWorkstreamTurn(db, workstreamId);
				return [{ workstreamId, items, behind: docker.get(workstreamId)?.behind ?? [], turn }];
			});
		for (const id of this.#commands.keys()) if (!targets.has(id)) this.#commands.delete(id);
		this.#targets = targets;
		this.#built = true;
		this.#poll(snapshot.length > 0);
		if (isDeepStrictEqual(snapshot, this.#snapshot)) return;
		this.#snapshot = snapshot;
		this.#deps.events.emit(STATS_WORKSTREAM_RUNNING_CHANGED_CHANNEL, snapshot);
	}

	#agentCommand(id: string, command: OpenBackgroundCommand, workstreamPath: string): AgentCommand {
		const known = this.#commands.get(id);
		if (known) return known;
		const source =
			command.toolCallId === null
				? null
				: backgroundCommandSource(this.#deps.db, command.sessionId, command.toolCallId);
		const text = source?.command ?? '';
		const directory = commandDirectory(text, workstreamPath);
		const packageName = nearestPackageName(directory, workstreamPath);
		const resolved: AgentCommand = {
			detail: commandDetail(text) || command.description,
			outputFile: source?.outputFile ?? null,
			fallbackName: fallbackServiceName(text, folderName(directory, workstreamPath)),
			namingTask: source === null ? null : namingTask(command.description, text, packageName),
		};
		if (resolved.outputFile !== null) this.#commands.set(id, resolved);
		return resolved;
	}

	#requestName(id: string, task: string): void {
		if (this.#naming.has(id)) return;
		this.#naming.add(id);
		void this.#name(id, task);
	}

	async #name(id: string, task: string): Promise<void> {
		let reply: string;
		try {
			reply = await this.#deps.nameService(task);
		} catch {
			return;
		}
		const name = parseServiceName(reply);
		if (name === null || this.#stopped) return;
		this.#names.set(id, name);
		await this.refresh();
	}

	#poll(running: boolean): void {
		if (running && !this.#pollTimer && this.#unsubscribe) {
			this.#pollTimer = setInterval(() => void this.refresh(), POLL_MS);
			this.#pollTimer.unref();
		} else if (!running && this.#pollTimer) {
			clearInterval(this.#pollTimer);
			this.#pollTimer = null;
		}
	}

	async #readTool(tool: PortTool, args: readonly string[]): Promise<string> {
		try {
			const run = await runBounded(
				this.#deps.runner,
				resolveToolPath(tool) ?? TOOL_FALLBACKS[tool],
				args,
				{ deadline: Date.now() + LOOKUP_TIMEOUT_MS, env: { LC_ALL: 'C' } },
			);
			return run.stdout;
		} catch {
			return '';
		}
	}

	async #scanContainers(): Promise<readonly DockerContainer[]> {
		const listed = await this.#docker(['ps', '-q', '--no-trunc']);
		if (listed === null || !boundedRunSucceeded(listed)) return [];
		const ids = listed.stdout
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line !== '');
		if (ids.length === 0) return [];
		const inspected = await this.#docker(['inspect', ...ids]);
		return inspected === null ? [] : parseDockerInspect(inspected.stdout);
	}

	async #docker(args: readonly string[]): Promise<BoundedRun | null> {
		try {
			return await runBounded(this.#deps.runner, dockerBinary(), args, {
				deadline: Date.now() + DOCKER_TIMEOUT_MS,
				env: buildSpawnEnvironment(),
			});
		} catch {
			return null;
		}
	}
}
