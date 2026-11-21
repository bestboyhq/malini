import { basename } from 'node:path';
import { isAtOrInsideDirectory } from '$main/fs/paths';
import type { RunningItem } from '$contract/stats';
import { isRecord } from '$main/db/rows';
import { LABEL_WORKSTREAM } from '$main/docker/labels';
import type { PathAliases } from '$shared/repositories/repositories.platform';

export const COMPOSE_PROJECT = 'com.docker.compose.project';
export const COMPOSE_SERVICE = 'com.docker.compose.service';
export const COMPOSE_DEPENDS_ON = 'com.docker.compose.depends_on';
export const COMPOSE_WORKING_DIR = 'com.docker.compose.project.working_dir';

export interface DockerContainer {
	readonly id: string;
	readonly name: string;
	readonly image: string;
	readonly startedAt: number;
	readonly ports: readonly number[];
	readonly labels: Readonly<Record<string, string>>;
	readonly bindSources: readonly string[];
}

export interface WorkstreamFolder {
	readonly id: string;
	readonly path: string;
}

export interface DockerRunning {
	readonly items: readonly RunningItem[];
	readonly behind: readonly string[];
}

export function parseDockerInspect(output: string): DockerContainer[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.flatMap((entry: unknown) => dockerContainer(entry) ?? []);
}

function dockerContainer(entry: unknown): DockerContainer | null {
	const container = record(entry);
	const id = container['Id'];
	const state = record(container['State']);
	if (typeof id !== 'string' || id === '' || state['Running'] !== true) return null;
	const config = record(container['Config']);
	const name = container['Name'];
	const image = config['Image'];
	const startedAt = typeof state['StartedAt'] === 'string' ? Date.parse(state['StartedAt']) : NaN;
	return {
		id,
		name: typeof name === 'string' ? name.replace(/^\//u, '') : id.slice(0, 12),
		image: typeof image === 'string' ? image : '',
		startedAt: Number.isFinite(startedAt) ? startedAt : 0,
		ports: hostPorts(record(container['NetworkSettings'])['Ports']),
		labels: stringValues(config['Labels']),
		bindSources: bindSources(container['Mounts']),
	};
}

function bindSources(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry: unknown) => {
		const mount = record(entry);
		const source = mount['Source'];
		return mount['Type'] === 'bind' && typeof source === 'string' ? [source] : [];
	});
}

function hostPorts(value: unknown): number[] {
	const ports = new Set<number>();
	for (const bindings of Object.values(record(value))) {
		if (!Array.isArray(bindings)) continue;
		for (const binding of bindings) {
			const port = Number(record(binding)['HostPort']);
			if (Number.isInteger(port) && port > 0 && port <= 65_535) ports.add(port);
		}
	}
	return [...ports].sort((left, right) => left - right);
}

function stringValues(value: unknown): Record<string, string> {
	const strings: Record<string, string> = {};
	for (const [key, text] of Object.entries(record(value))) {
		if (typeof text === 'string') strings[key] = text;
	}
	return strings;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	return isRecord(value) ? value : {};
}

export function containerWorkstream(
	container: DockerContainer,
	workstreams: readonly WorkstreamFolder[],
): string | null {
	const [linked, ...others] = linkedWorkstreams(container, workstreams);
	return others.length === 0 ? (linked ?? null) : null;
}

export function linkedWorkstreams(
	container: DockerContainer,
	workstreams: readonly WorkstreamFolder[],
): string[] {
	const labelled = container.labels[LABEL_WORKSTREAM];
	if (labelled !== undefined && workstreams.some((workstream) => workstream.id === labelled)) {
		return [labelled];
	}
	const directory = container.labels[COMPOSE_WORKING_DIR];
	const composed = directory === undefined ? undefined : folderOf(directory, workstreams);
	if (composed !== undefined) return [composed];
	return [
		...new Set(container.bindSources.flatMap((source) => folderOf(source, workstreams) ?? [])),
	];
}

export function withAliases(
	folders: readonly WorkstreamFolder[],
	{ path: root, aliases }: PathAliases,
): WorkstreamFolder[] {
	return folders.flatMap((folder) => [
		folder,
		...(isAtOrInsideDirectory(root, folder.path)
			? aliases.map((alias) => ({ id: folder.id, path: alias + folder.path.slice(root.length) }))
			: []),
	]);
}

function folderOf(path: string, workstreams: readonly WorkstreamFolder[]): string | undefined {
	return workstreams.find((workstream) => isAtOrInsideDirectory(workstream.path, path))?.id;
}

export function dockerRunning(
	containers: readonly DockerContainer[],
	workstreams: readonly WorkstreamFolder[],
): Map<string, DockerRunning> {
	const byWorkstream = new Map<string, DockerContainer[]>();
	for (const container of containers) {
		const workstreamId = containerWorkstream(container, workstreams);
		if (workstreamId === null) continue;
		byWorkstream.set(workstreamId, [...(byWorkstream.get(workstreamId) ?? []), container]);
	}
	const running = new Map<string, DockerRunning>();
	for (const [workstreamId, list] of byWorkstream)
		running.set(workstreamId, foldDependencies(list));
	return running;
}

function foldDependencies(containers: readonly DockerContainer[]): DockerRunning {
	const dependencies = new Set(
		containers.flatMap((container) =>
			dependsOn(container).map((service) => serviceKey(container, service)),
		),
	);
	const items: RunningItem[] = [];
	const behind = new Set<string>();
	for (const container of containers) {
		const service = container.labels[COMPOSE_SERVICE];
		const name = service ?? container.name;
		if (service !== undefined && dependencies.has(serviceKey(container, service))) {
			behind.add(name);
			continue;
		}
		items.push({
			id: `docker:${container.id}`,
			origin: 'docker',
			name,
			kind: 'service',
			detail: container.image,
			group: composeGroup(container),
			startedAt: container.startedAt,
			ports: container.ports,
		});
	}
	return {
		items: items.sort((left, right) => left.name.localeCompare(right.name)),
		behind: [...behind].sort(),
	};
}

function composeGroup(container: DockerContainer): string | null {
	const project = container.labels[COMPOSE_PROJECT];
	if (project === undefined) return null;
	const folder = basename(container.labels[COMPOSE_WORKING_DIR] ?? '')
		.toLowerCase()
		.replaceAll(/[^a-z0-9_-]/gu, '');
	return project === folder ? null : project;
}

function dependsOn(container: DockerContainer): string[] {
	return (container.labels[COMPOSE_DEPENDS_ON] ?? '')
		.split(',')
		.map((entry) => entry.split(':')[0]?.trim() ?? '')
		.filter((service) => service !== '');
}

function serviceKey(container: DockerContainer, service: string): string {
	return `${container.labels[COMPOSE_PROJECT] ?? ''}\n${service}`;
}
