import { cpus, totalmem } from 'node:os';
import type { ResourceHistory, ResourceKindBreakdown, ResourceSample } from '$contract/stats';
import type { MemoryJournalEntry } from '$main/diagnostics/diagnostics-files';
import { dockerBinary } from '$main/docker/cli';
import { buildSpawnEnvironment, resolveToolPath } from '$main/process/environment';
import { boundedRunSucceeded, runBounded, type ProcessRunner } from '$main/process/runner';
import { RESOURCE_HISTORY_MS, RESOURCE_SAMPLE_INTERVAL_MS } from '../domain/resources';
import { DOCKER_STATS_FORMAT, parseDockerStats, type DockerUsage } from './docker-usage';
import {
	FOOTPRINT_TABLE_ARGS,
	heaviestOutside,
	journalProcess,
	launchersOf,
	LISTED_OUTSIDE,
	MEMORY_JOURNAL_INTERVAL_MS,
	parseFootprints,
	redactBreakdown,
} from './memory-journal';
import {
	measureProcessTree,
	parseProcessTable,
	PROCESS_TABLE_ARGS,
	type ProcessRoots,
	type ProcessRow,
	type ProcessTreeUsage,
} from './process-tree';
import {
	describeBreakdown,
	LISTED_PER_KIND,
	parseCommandLines,
	parseWorkingDirectories,
	unitsByKind,
	type WorkstreamPlace,
} from './resource-breakdown';

const DOCKER_INTERVAL_MS = 30_000;
const PS_TIMEOUT_MS = 4_000;
const LOOKUP_TIMEOUT_MS = 4_000;
const DOCKER_STATS_TIMEOUT_MS = 20_000;

export interface ResourceSamplerDeps {
	readonly runner: ProcessRunner;
	readonly appProcessId: number;
	browserTabs(): readonly BrowserTab[];
	agentHostProcessId(): number | null;
	runningContainerIds(): Promise<string[]>;
	workstreams(): readonly WorkstreamPlace[];
	sampled(sample: ResourceSample): void;
	journaled(entry: MemoryJournalEntry): void;
	readonly now?: () => number;
}

export interface BrowserTab {
	readonly processId: number;
	readonly title: string;
}

interface Measured {
	readonly tree: ProcessTreeUsage;
	readonly roots: ProcessRoots;
	readonly tabs: readonly BrowserTab[];
}

export class ResourceSampler {
	readonly #deps: ResourceSamplerDeps;
	readonly #cores = Math.max(1, cpus().length);
	#samples: ResourceSample[] = [];
	#timer: NodeJS.Timeout | null = null;
	#journalTimer: NodeJS.Timeout | null = null;
	#sampling = false;
	#journaling = false;
	#measured: Measured | null = null;
	#workingDirectories = new Map<number, string>();
	#docker: DockerUsage | null = null;
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
		void this.#journal();
		this.#journalTimer = setInterval(() => void this.#journal(), MEMORY_JOURNAL_INTERVAL_MS);
		this.#journalTimer.unref();
	}

	stop(): void {
		if (this.#timer) clearInterval(this.#timer);
		if (this.#journalTimer) clearInterval(this.#journalTimer);
		this.#timer = null;
		this.#journalTimer = null;
	}

	history(): ResourceHistory {
		return { machineMemoryBytes: totalmem(), samples: [...this.#samples] };
	}

	async breakdown(): Promise<ResourceKindBreakdown[]> {
		return this.#measured ? await this.#describe(this.#measured) : [];
	}

	async #journalEntry(): Promise<MemoryJournalEntry | null> {
		const [table, footprintTable] = await Promise.all([
			this.#readProcessTable(),
			this.#readBounded(resolveToolPath('top') ?? '/usr/bin/top', FOOTPRINT_TABLE_ARGS),
		]);
		if (table === null) return null;
		const footprints = parseFootprints(footprintTable);
		const rows = parseProcessTable(table).map((row) => ({
			...row,
			memoryBytes: footprints.byProcess.get(row.pid) ?? row.memoryBytes,
		}));
		const measured = this.#measureRows(rows);
		if (measured.tree.processes === 0) return null;
		const app = this.#deps.appProcessId;
		const launchers = launchersOf(rows, app);
		const outside = heaviestOutside(rows, app, launchers, LISTED_OUTSIDE);
		const [breakdown, commandLines] = await Promise.all([
			this.#describe(measured),
			this.#readCommandLines([...launchers, ...outside].map((row) => row.pid)),
		]);
		const heap = process.memoryUsage();
		return {
			schemaVersion: 1,
			occurredAt: new Date((this.#deps.now ?? Date.now)()).toISOString(),
			measure: footprints.byProcess.size > 0 ? 'footprint' : 'rss',
			app: {
				pid: app,
				startedAt: new Date(performance.timeOrigin).toISOString(),
				memoryBytes: measured.tree.usage.reduce((sum, entry) => sum + entry.memoryBytes, 0),
				processes: measured.tree.processes,
			},
			usage: measured.tree.usage.map(({ kind, memoryBytes, processes }) => ({
				kind,
				memoryBytes,
				processes,
			})),
			breakdown: redactBreakdown(breakdown),
			mainHeap: {
				heapUsedBytes: heap.heapUsed,
				heapTotalBytes: heap.heapTotal,
				externalBytes: heap.external,
				arrayBuffersBytes: heap.arrayBuffers,
			},
			machine: { totalBytes: totalmem(), physical: footprints.physical },
			launchers: launchers.map((row) => journalProcess(row, commandLines)),
			outside: outside.map((row) => journalProcess(row, commandLines)),
		};
	}

	async #journal(): Promise<void> {
		if (this.#journaling) return;
		this.#journaling = true;
		try {
			const entry = await this.#journalEntry();
			if (entry && this.#journalTimer) this.#deps.journaled(entry);
		} catch (error) {
			if (this.#journalTimer) throw error;
		} finally {
			this.#journaling = false;
		}
	}

	async #describe(measured: Measured): Promise<ResourceKindBreakdown[]> {
		const byKind = unitsByKind(measured.tree.units);
		const listed = [...byKind.values()].flatMap((units) => units.slice(0, LISTED_PER_KIND));
		const [commandLines, workingDirectories] = await Promise.all([
			this.#readCommandLines(listed.map((unit) => unit.heaviest.pid)),
			this.#readWorkingDirectories(
				measured.tree.units.flatMap((unit) => unit.agent ?? []),
				listed.flatMap((unit) => unit.agent ?? []),
			),
		]);
		return describeBreakdown(
			byKind,
			{
				roots: measured.roots,
				commandLines,
				tabTitles: tabTitles(measured.tabs),
				workingDirectories,
				workstreams: this.#deps.workstreams(),
			},
			this.#docker?.containers ?? [],
		);
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
		const measured = this.#measureRows(parseProcessTable(table));
		const { tree } = measured;
		if (tree.processes === 0) return null;
		this.#measured = measured;
		const usage = this.#docker ? [...tree.usage, this.#docker.usage] : tree.usage;
		return {
			sampledAt: (this.#deps.now ?? Date.now)(),
			memoryBytes: usage.reduce((sum, entry) => sum + entry.memoryBytes, 0),
			cpuPercent: usage.reduce((sum, entry) => sum + entry.cpuPercent, 0),
			processes: tree.processes,
			usage,
		};
	}

	#measureRows(rows: readonly ProcessRow[]): Measured {
		const tabs = this.#deps.browserTabs();
		const roots: ProcessRoots = {
			app: this.#deps.appProcessId,
			browserTabs: new Set(tabs.map((tab) => tab.processId)),
			agentHost: this.#deps.agentHostProcessId(),
		};
		return { tree: measureProcessTree(rows, roots, this.#cores), roots, tabs };
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

	async #readCommandLines(pids: readonly number[]): Promise<ReadonlyMap<number, string>> {
		if (pids.length === 0) return new Map();
		const run = await this.#readBounded(resolveToolPath('ps') ?? '/bin/ps', [
			'-ww',
			'-o',
			'pid=,args=',
			'-p',
			pids.join(','),
		]);
		return parseCommandLines(run);
	}

	async #readWorkingDirectories(
		live: readonly number[],
		wanted: readonly number[],
	): Promise<ReadonlyMap<number, string>> {
		const alive = new Set(live);
		for (const pid of this.#workingDirectories.keys()) {
			if (!alive.has(pid)) this.#workingDirectories.delete(pid);
		}
		const missing = [...new Set(wanted)].filter((pid) => !this.#workingDirectories.has(pid));
		if (missing.length === 0) return this.#workingDirectories;
		const run = await this.#readBounded(resolveToolPath('lsof') ?? '/usr/sbin/lsof', [
			'-a',
			'-d',
			'cwd',
			'-Fn',
			'-p',
			missing.join(','),
		]);
		for (const [pid, directory] of parseWorkingDirectories(run)) {
			this.#workingDirectories.set(pid, directory);
		}
		return this.#workingDirectories;
	}

	async #readBounded(file: string, args: readonly string[]): Promise<string> {
		try {
			const run = await runBounded(this.#deps.runner, file, args, {
				deadline: Date.now() + LOOKUP_TIMEOUT_MS,
				env: { LC_ALL: 'C' },
			});
			return run.stdout;
		} catch {
			return '';
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

	async #readDocker(): Promise<DockerUsage | null> {
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

function tabTitles(tabs: readonly BrowserTab[]): Map<number, string> {
	const titles = new Map<number, string>();
	for (const { processId, title } of tabs) {
		const known = titles.get(processId);
		titles.set(processId, known ? `${known}, ${title}` : title);
	}
	return titles;
}
