import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describeError } from '$main/errors';
import { isFile } from '$main/fs/stat';
import type { MaliniDatabase } from '../db/driver';
import {
	durableContainerRecords,
	markContainerReleased,
	parseContainerOwner,
	recordStartedContainers,
	type ContainerOwner,
	type OwnedContainerRecord,
} from './records';
import { nowIso8601 } from '../db/rows';
import { listLiveContainers, type LiveContainer } from './cli';
import {
	APP_INSTANCE_ID,
	assertSafeComposeProjectName,
	assertSafeComposeServiceName,
	assertSafeLabelValue,
	composeLabelOverlayYaml,
	composeLabels,
	composeProjectName,
	ownershipLabels,
	LABEL_COMPOSE_PROJECT,
	LABEL_OWNER,
	LABEL_SERVICE,
	LABEL_WORKSTREAM,
	LABEL_APP,
	LEGACY_LABEL_WORKSPACE,
	LEGACY_OWNER_WORKSPACE,
	type OwnershipLabels,
} from './labels';
import type { ProcessRunner } from '$main/process/runner';
import type {
	ComposeLabelOverlay,
	DockerOwnershipHandshake,
	OwnedContainer,
	OwnershipEvidence,
	StartedContainerInput,
} from '../../contract/system';

export type {
	ComposeLabelOverlay,
	DockerOwnershipHandshake,
	OwnedContainer,
	OwnershipEvidence,
	StartedContainerInput,
};

export type { ContainerOwner, OwnedContainerRecord } from './records';

const OVERLAY_FILE_NAME = 'compose-labels.yml';
const OVERLAY_DIRECTORY = 'docker-ownership';
const MISSING_STATE = 'missing';

export function writeComposeLabelOverlay(
	appDataRoot: string,
	labels: OwnershipLabels,
): ComposeLabelOverlay {
	const directory = join(appDataRoot, OVERLAY_DIRECTORY, labels.composeProject, labels.service);
	try {
		mkdirSync(directory, { recursive: true });
	} catch (error) {
		throw new Error(`could not create the docker label overlay directory: ${describeError(error)}`);
	}
	const path = join(directory, OVERLAY_FILE_NAME);
	try {
		writeFileSync(path, composeLabelOverlayYaml(labels));
	} catch (error) {
		throw new Error(`could not write the docker label overlay: ${describeError(error)}`);
	}
	return { path, labels: Object.fromEntries(composeLabels(labels)) };
}

export function reconcileFrom(
	bundleIdentifier: string,
	records: readonly OwnedContainerRecord[],
	live: readonly LiveContainer[],
	appInstanceId: string = APP_INSTANCE_ID,
): OwnedContainer[] {
	const byId = new Map(records.map((record) => [record.containerId, record]));
	const owned: OwnedContainer[] = [];
	const seen = new Set<string>();
	for (const container of live) {
		const labeled = container.labels[LABEL_APP] === bundleIdentifier;
		const record = byId.get(container.id) ?? null;
		if (!labeled && !record) continue;
		const evidence: OwnershipEvidence = labeled
			? record
				? 'label-and-record'
				: 'label'
			: 'record';
		const label = (key: string): string | null => container.labels[key] ?? null;
		const instance = record?.appInstanceId ?? null;
		const labeledOwner = label(LABEL_OWNER);
		owned.push({
			containerId: container.id,
			containerName: container.name,
			state: container.state,
			bundleIdentifier,
			appInstanceId: instance,
			workstreamId:
				label(LABEL_WORKSTREAM) ?? label(LEGACY_LABEL_WORKSPACE) ?? record?.workstreamId ?? null,
			composeProject: label(LABEL_COMPOSE_PROJECT) ?? record?.composeProject ?? null,
			service: label(LABEL_SERVICE) ?? record?.service ?? null,
			owner: (labeledOwner ? tryParseOwner(labeledOwner) : null) ?? record?.owner ?? null,
			cwd: record?.cwd ?? null,
			startedAt: record?.startedAt ?? null,
			appPid: record?.appPid ?? null,
			evidence,
			startedByThisInstance: instance !== null && instance === appInstanceId,
		});
		seen.add(container.id);
	}
	for (const record of records) {
		if (seen.has(record.containerId)) continue;
		owned.push({
			containerId: record.containerId,
			containerName: record.containerName,
			state: MISSING_STATE,
			bundleIdentifier: record.bundleIdentifier,
			appInstanceId: record.appInstanceId,
			workstreamId: record.workstreamId,
			composeProject: record.composeProject,
			service: record.service,
			owner: record.owner,
			cwd: record.cwd,
			startedAt: record.startedAt,
			appPid: record.appPid,
			evidence: 'record',
			startedByThisInstance: record.appInstanceId === appInstanceId,
		});
	}
	owned.sort((left, right) => compareStrings(left.containerId, right.containerId));
	return owned;
}

function tryParseOwner(value: string): ContainerOwner | null {
	if (value === LEGACY_OWNER_WORKSPACE) return 'workstream';
	try {
		return parseContainerOwner(value);
	} catch {
		return null;
	}
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

const COMPOSE_BASE_FILE_NAMES = [
	'compose.yaml',
	'compose.yml',
	'docker-compose.yaml',
	'docker-compose.yml',
] as const;

const COMPOSE_OVERRIDE_FILE_NAMES = [
	'compose.override.yaml',
	'compose.override.yml',
	'docker-compose.override.yaml',
	'docker-compose.override.yml',
] as const;

export function resolveComposeFiles(cwd: string): string[] {
	let directory: string | null = cwd;
	while (directory !== null) {
		const base = COMPOSE_BASE_FILE_NAMES.map((name) => join(directory as string, name)).find(
			isFile,
		);
		if (base !== undefined) {
			const files = [base];
			const override = COMPOSE_OVERRIDE_FILE_NAMES.map((name) =>
				join(directory as string, name),
			).find(isFile);
			if (override !== undefined) files.push(override);
			return files;
		}
		const parent = dirname(directory);
		directory = parent === directory ? null : parent;
	}
	throw new Error(
		`no Compose file found in ${cwd} or any parent directory (looked for ${COMPOSE_BASE_FILE_NAMES.join(', ')})`,
	);
}

export interface DockerOwnershipDeps {
	readonly db: MaliniDatabase;
	readonly runner: ProcessRunner;
	readonly appDataRoot: string;
	readonly bundleIdentifier: string;
	readonly appInstanceId?: string;
	readonly appPid?: number;
}

export class DockerOwnership {
	readonly bundleIdentifier: string;
	readonly appInstanceId: string;
	readonly appPid: number;
	private readonly db: MaliniDatabase;
	private readonly runner: ProcessRunner;
	private readonly appDataRoot: string;

	constructor(deps: DockerOwnershipDeps) {
		this.db = deps.db;
		this.runner = deps.runner;
		this.appDataRoot = deps.appDataRoot;
		this.bundleIdentifier = deps.bundleIdentifier;
		this.appInstanceId = deps.appInstanceId ?? APP_INSTANCE_ID;
		this.appPid = deps.appPid ?? process.pid;
	}

	claimService(input: {
		repository: string;
		scope: string;
		workstreamId: string;
		service: string;
		owner: string;
		composeProject?: string | null;
	}): DockerOwnershipHandshake {
		const owner = parseContainerOwner(input.owner);
		const composeFiles = resolveComposeFiles(input.repository);
		let project: string;
		if (typeof input.composeProject === 'string') {
			assertSafeComposeProjectName(input.composeProject);
			project = input.composeProject;
		} else {
			project = composeProjectName(input.repository, input.scope);
		}
		const labels = ownershipLabels({
			bundleIdentifier: this.bundleIdentifier,
			appInstanceId: this.appInstanceId,
			workstreamId: input.workstreamId,
			composeProject: project,
			service: input.service,
			owner,
		});
		const overlay = writeComposeLabelOverlay(this.appDataRoot, labels);
		return {
			bundleIdentifier: labels.bundleIdentifier,
			appInstanceId: labels.appInstanceId,
			composeProject: project,
			overlay,
			composeFiles,
		};
	}

	recordContainers(containers: readonly StartedContainerInput[]): void {
		const startedAt = nowIso8601();
		const records: Array<Omit<OwnedContainerRecord, 'releasedAt'>> = [];
		for (const container of containers) {
			assertSafeLabelValue('container id', container.containerId);
			assertSafeComposeProjectName(container.composeProject);
			assertSafeComposeServiceName(container.service);
			records.push({
				containerId: container.containerId,
				containerName: container.containerName,
				bundleIdentifier: this.bundleIdentifier,
				appInstanceId: this.appInstanceId,
				workstreamId: container.workstreamId ?? null,
				composeProject: container.composeProject,
				service: container.service,
				owner: parseContainerOwner(container.owner),
				cwd: container.cwd,
				startedAt,
				appPid: this.appPid,
			});
		}
		recordStartedContainers(this.db, records);
	}

	releaseContainer(containerId: string): void {
		markContainerReleased(this.db, containerId);
	}

	durableRecords(): OwnedContainerRecord[] {
		return durableContainerRecords(this.db, this.bundleIdentifier);
	}

	ownedContainerCount(): number {
		try {
			return this.durableRecords().filter((record) => record.appInstanceId === this.appInstanceId)
				.length;
		} catch {
			return 0;
		}
	}

	async reconcile(): Promise<OwnedContainer[]> {
		const records = this.durableRecords();
		const live = await listLiveContainers(this.runner);
		return reconcileFrom(this.bundleIdentifier, records, live, this.appInstanceId);
	}
}
