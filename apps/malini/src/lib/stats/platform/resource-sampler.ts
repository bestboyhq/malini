import { cpus, totalmem } from 'node:os';
import type { ResourceHistory, ResourceSample, ResourceUsage } from '$contract/stats';
import { dockerBinary } from '$main/docker/cli';
import { buildSpawnEnvironment, resolveToolPath } from '$main/process/environment';
import { boundedRunSucceeded, runBounded, type ProcessRunner } from '$main/process/runner';
import { RESOURCE_HISTORY_MS, RESOURCE_SAMPLE_INTERVAL_MS } from '../domain/resources';
import { DOCKER_STATS_FORMAT, parseDockerStats } from './docker-usage';
import { measureProcessTree, parseProcessTable, PROCESS_TABLE_ARGS } from './process-tree';

const DOCKER_INTERVAL_MS = 30_000;
const PS_TIMEOUT_MS = 4_000;
const DOCKER_STATS_TIMEOUT_MS = 20_000;

export interface ResourceSamplerDeps {
	readonly runner: ProcessRunner;
	readonly appProcessId: number;
	browserTabProcessIds(): number[];
	agentHostProcessId(): number | null;
	runningContainerIds(): Promise<string[]>;
	sampled(sample: ResourceSample): void;
	readonly now?: () => number;
}

export class ResourceSampler {
	readonly #deps: ResourceSamplerDeps;
	readonly #cores = Math.max(1, cpus().length);
	#samples: ResourceSample[] = [];
	#timer: NodeJS.Timeout | null = null;
	#sampling = false;
	#docker: ResourceUsage | null = null;
	#dockerReadAt = Number.NEGATIVE_INFINITY;
	#dockerReading = false;

	constructor(deps: ResourceSamplerDeps) {
		this.#deps = deps;
	}

	start(): void {
		if (this.#timer) return;
		void this.sample();
		this.#timer = setInterval(() => void this.sample(), RESOURCE_SAMPLE_INTERVAL_MS);
		this.#timer.unref();
	}

	stop(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}

	history(): ResourceHistory {
		return { machineMemoryBytes: totalmem(), samples: [...this.#samples] };
	}

	async sample(): Promise<void> {
		if (this.#sampling) return;
		this.#sampling = true;
		try {
			this.#readDockerWhenDue();
			const sample = await this.#measure();
			if (!sample) return;
			const horizon = sample.sampledAt - RESOURCE_HISTORY_MS;
			this.#samples = [...this.#samples.filter((kept) => kept.sampledAt > horizon), sample];
			this.#deps.sampled(sample);
		} finally {
			this.#sampling = false;
		}
	}

	async #measure(): Promise<ResourceSample | null> {
		const table = await this.#readProcessTable();
		if (table === null) return null;
		const tree = measureProcessTree(
			parseProcessTable(table),
			{
				app: this.#deps.appProcessId,
				browserTabs: new Set(this.#deps.browserTabProcessIds()),
				agentHost: this.#deps.agentHostProcessId(),
			},
			this.#cores,
		);
		if (tree.processes === 0) return null;
		const usage = this.#docker ? [...tree.usage, this.#docker] : tree.usage;
		return {
			sampledAt: (this.#deps.now ?? Date.now)(),
			memoryBytes: usage.reduce((sum, entry) => sum + entry.memoryBytes, 0),
			cpuPercent: usage.reduce((sum, entry) => sum + entry.cpuPercent, 0),
			processes: tree.processes,
			usage,
		};
	}

	async #readProcessTable(): Promise<string | null> {
		try {
			const run = await runBounded(
				this.#deps.runner,
				resolveToolPath('ps') ?? '/bin/ps',
				PROCESS_TABLE_ARGS,
				{ deadline: Date.now() + PS_TIMEOUT_MS, env: { LC_ALL: 'C' } },
			);
			return boundedRunSucceeded(run) ? run.stdout : null;
		} catch {
			return null;
		}
	}

	#readDockerWhenDue(): void {
		const now = Date.now();
		if (this.#dockerReading || now - this.#dockerReadAt < DOCKER_INTERVAL_MS) return;
		this.#dockerReading = true;
		this.#dockerReadAt = now;
		void (async () => {
			try {
				this.#docker = await this.#readDocker();
			} catch {
				this.#docker = null;
			} finally {
				this.#dockerReading = false;
			}
		})();
	}

	async #readDocker(): Promise<ResourceUsage | null> {
		const ids = await this.#deps.runningContainerIds();
		if (ids.length === 0) return null;
		const run = await runBounded(
			this.#deps.runner,
			dockerBinary(),
			['stats', '--no-stream', '--format', DOCKER_STATS_FORMAT, ...ids],
			{ deadline: Date.now() + DOCKER_STATS_TIMEOUT_MS, env: buildSpawnEnvironment() },
		);
		return boundedRunSucceeded(run) ? parseDockerStats(run.stdout, this.#cores) : null;
	}
}
