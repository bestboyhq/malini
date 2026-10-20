import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { durableContainerRecords, recordStartedContainers } from './records';
import { openMigratedDatabase } from '../db/open';
import { get } from '../db/rows';
import { listLiveContainers, parseDockerPs, type LiveContainer } from './cli';
import {
	APP_INSTANCE_ID,
	LABEL_APP,
	LABEL_COMPOSE_PROJECT,
	LABEL_OWNER,
	LABEL_SERVICE,
	LABEL_WORKSTREAM,
	LEGACY_LABEL_WORKSPACE,
	LEGACY_OWNER_WORKSPACE,
	OWNERSHIP_LABEL_KEYS,
	assertSafeComposeProjectName,
	composeLabelOverlayYaml,
	composeProjectName,
	ownershipLabels,
	shortHash,
	type OwnershipLabels,
} from './labels';
import {
	DockerOwnership,
	reconcileFrom,
	resolveComposeFiles,
	writeComposeLabelOverlay,
	type OwnedContainerRecord,
} from './ownership';
import { removeAll } from '$main/fs/test-support';
import { ScriptedRunner } from '$main/process/test-support';

const BUNDLE = 'app.malini.desktop.dev';
const dirs: string[] = [];

afterEach(() => removeAll(dirs));

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'malini-docker-'));
	dirs.push(dir);
	return dir;
}

function labels(): OwnershipLabels {
	return ownershipLabels({
		bundleIdentifier: BUNDLE,
		appInstanceId: '0123abcd',
		workstreamId: 'ws-alpha',
		composeProject: 'malini-ws-alpha',
		service: 'mongo',
		owner: 'workstream',
	});
}

function record(id: string, project: string, workstream: string): OwnedContainerRecord {
	return {
		containerId: id,
		containerName: `${project}-svc-1`,
		bundleIdentifier: BUNDLE,
		appInstanceId: APP_INSTANCE_ID,
		workstreamId: workstream,
		composeProject: project,
		service: 'svc',
		owner: 'workstream',
		cwd: '/tmp/checkout',
		startedAt: '2026-07-26T00:00:00.000Z',
		releasedAt: null,
		appPid: process.pid,
	};
}

function live(
	id: string,
	name: string,
	state: string,
	entries: Array<[string, string]>,
): LiveContainer {
	return { id, name, state, labels: Object.fromEntries(entries) };
}

describe('compose file resolution', () => {
	const write = (directory: string, name: string): void => {
		writeFileSync(join(directory, name), 'services: {}\n');
	};

	it('prefers the modern name over the legacy one', () => {
		const root = tempDir();
		write(root, 'docker-compose.yml');
		write(root, 'compose.yaml');
		expect(resolveComposeFiles(root)).toEqual([join(root, 'compose.yaml')]);
	});

	it('still finds the legacy name on its own', () => {
		const root = tempDir();
		write(root, 'docker-compose.yml');
		const files = resolveComposeFiles(root);
		expect(files).toHaveLength(1);
		expect(files[0]?.endsWith('docker-compose.yml')).toBe(true);
	});

	it('includes an override file after the base', () => {
		const root = tempDir();
		write(root, 'docker-compose.yml');
		write(root, 'docker-compose.override.yml');
		const files = resolveComposeFiles(root);
		expect(files.map((file) => file.split('/').at(-1))).toEqual([
			'docker-compose.yml',
			'docker-compose.override.yml',
		]);
	});

	it('walks up to a parent directory', () => {
		const root = tempDir();
		write(root, 'compose.yaml');
		const nested = join(root, 'apps', 'api');
		mkdirSync(nested, { recursive: true });
		expect(resolveComposeFiles(nested)).toEqual([join(root, 'compose.yaml')]);
	});

	it('names the directory it searched when nothing is found', () => {
		const root = tempDir();
		const nested = join(root, 'empty');
		mkdirSync(nested);
		expect(() => resolveComposeFiles(nested)).toThrow(/no Compose file/);
		expect(() => resolveComposeFiles(nested)).toThrow(nested);
	});
});

describe('project names and labels', () => {
	it('keeps the existing project names byte for byte', () => {
		const cases: Array<[string, string, string]> = [
			['acmelabs/web', 'ws-alpha', 'acmelabs-web-ws-alpha'],
			['@Acme Labs/Web', 'Workstream #1', 'acme-labs-web-workstream-1'],
			['montpellier', '01JQ2Z8K7C9X4M5N6P7Q8R9S0T', 'montpellier-01jq2z8k7c9x4m5n6p7q8r9s0t'],
			[
				'a-very-long-repository-name-that-goes-on-and-on-for-quite-a-while-indeed',
				'workstream-identifier-that-is-also-long-0123456789',
				'a-very-long-repository-name-that-g-workstream-identifie-1qh324s',
			],
			['---', 'ws', 'repository-ws'],
			['', 'ws', 'repository-ws'],
		];
		for (const [repository, scope, expected] of cases) {
			const derived = composeProjectName(repository, scope);
			expect(derived, `${repository}/${scope}`).toBe(expected);
			expect(() => assertSafeComposeProjectName(derived)).not.toThrow();
		}
	});

	it('hashes like the renderer FNV-1a', () => {
		expect(shortHash('ws-alpha')).toBe('k7hu6m');
		expect(shortHash('Workstream #1')).toBe('3on4e0');
		expect(shortHash('01JQ2Z8K7C9X4M5N6P7Q8R9S0T')).toBe('1adul6h');
	});

	it('refuses an arbitrary project name before it reaches the daemon', () => {
		for (const rejected of [
			'Acme-Workstream',
			'-leading-hyphen',
			'has space',
			'has,comma',
			'has"quote',
			'',
			'a'.repeat(64),
		]) {
			expect(() => assertSafeComposeProjectName(rejected), rejected).toThrow(
				/Docker Compose project name must be/,
			);
		}
		expect(() => assertSafeComposeProjectName('repository_1')).not.toThrow();
	});

	it('refuses a label value that would break the overlay', () => {
		for (const rejected of ['with space', 'with"quote', 'with,comma', 'with\nnewline', '']) {
			expect(() =>
				ownershipLabels({
					bundleIdentifier: BUNDLE,
					appInstanceId: '0123abcd',
					workstreamId: rejected,
					composeProject: 'malini-ws',
					service: 'svc',
					owner: 'workstream',
				}),
			).toThrow(/docker ownership workstream id must be/);
		}
	});

	it('declares every ownership label for the service in the overlay', () => {
		const yaml = composeLabelOverlayYaml(labels());
		expect(yaml).toContain('services:\n  mongo:\n    labels:\n');
		for (const key of OWNERSHIP_LABEL_KEYS) expect(yaml).toContain(`      ${key}: "`);
		expect(yaml).toContain(`${LABEL_APP}: "${BUNDLE}"`);
		expect(yaml).toContain(`${LABEL_WORKSTREAM}: "ws-alpha"`);
		expect(yaml).toContain(`${LABEL_OWNER}: "workstream"`);
	});

	it('keeps the overlay byte-identical across launches', () => {
		const first = ownershipLabels({ ...labels(), appInstanceId: 'instance-one' });
		const second = { ...first, appInstanceId: 'a-completely-different-instance' };
		expect(composeLabelOverlayYaml(first)).toBe(composeLabelOverlayYaml(second));
		expect(composeLabelOverlayYaml(first)).not.toContain('instance');
	});

	it('writes the overlay per project and service', () => {
		const root = tempDir();
		const overlay = writeComposeLabelOverlay(root, labels());
		expect(existsSync(overlay.path)).toBe(true);
		expect(overlay.path.endsWith('docker-ownership/malini-ws-alpha/mongo/compose-labels.yml')).toBe(
			true,
		);
		expect(overlay.labels[LABEL_APP]).toBe(BUNDLE);
		expect(Object.keys(overlay.labels)).toHaveLength(OWNERSHIP_LABEL_KEYS.length);
		expect(readFileSync(overlay.path, 'utf8')).toBe(composeLabelOverlayYaml(labels()));
	});
});

describe('docker ps parsing and reconciliation', () => {
	it('parses docker ps output into labeled containers', () => {
		const parsed = parseDockerPs(
			`abc123\tmalini-ws-a-svc-1\trunning\t${LABEL_APP}=${BUNDLE},${LABEL_WORKSTREAM}=ws-a\n` +
				'def456\tunrelated\texited\t\n',
		);
		expect(parsed).toHaveLength(2);
		expect(parsed[0]?.id).toBe('abc123');
		expect(parsed[0]?.state).toBe('running');
		expect(parsed[0]?.labels[LABEL_WORKSTREAM]).toBe('ws-a');
		expect(parsed[1]?.labels).toEqual({});
	});

	it('reconciles exactly across both channels', () => {
		const records = [
			record('id-record-only', 'malini-ws-c', 'ws-c'),
			record('id-both', 'malini-ws-a', 'ws-a'),
		];
		const containers = [
			live('id-both', 'malini-ws-a-svc-1', 'running', [
				[LABEL_APP, BUNDLE],
				[LABEL_WORKSTREAM, 'ws-a'],
				[LABEL_COMPOSE_PROJECT, 'malini-ws-a'],
				[LABEL_SERVICE, 'svc'],
				[LABEL_OWNER, 'workstream'],
			]),
			live('id-label-only', 'malini-ws-b-svc-1', 'exited', [
				[LABEL_APP, BUNDLE],
				[LABEL_WORKSTREAM, 'ws-b'],
			]),
			live('id-other-bundle', 'prod-svc-1', 'running', [[LABEL_APP, 'app.malini.desktop']]),
			live('id-foreign', 'someone-elses-postgres', 'running', []),
		];
		const owned = reconcileFrom(BUNDLE, records, containers);
		expect(owned.map((container) => container.containerId)).toEqual([
			'id-both',
			'id-label-only',
			'id-record-only',
		]);
		const byId = (id: string) => owned.find((container) => container.containerId === id)!;
		expect(byId('id-both').evidence).toBe('label-and-record');
		expect(byId('id-label-only').evidence).toBe('label');
		expect(byId('id-record-only').evidence).toBe('record');
		expect(byId('id-record-only').state).toBe('missing');
		expect(byId('id-label-only').workstreamId).toBe('ws-b');
		expect(byId('id-both').startedByThisInstance).toBe(true);
		expect(byId('id-label-only').startedByThisInstance).toBe(false);
		expect(byId('id-label-only').appInstanceId).toBeNull();
	});

	it('reads the workstream and owner from labels written before the workstream rename', () => {
		const containers = [
			live('id-legacy', 'malini-ws-l-svc-1', 'running', [
				[LABEL_APP, BUNDLE],
				[LEGACY_LABEL_WORKSPACE, 'ws-l'],
				[LABEL_OWNER, LEGACY_OWNER_WORKSPACE],
			]),
		];
		const [legacy] = reconcileFrom(BUNDLE, [], containers);
		expect(legacy?.evidence).toBe('label');
		expect(legacy?.workstreamId).toBe('ws-l');
		expect(legacy?.owner).toBe('workstream');
	});

	it('treats an unreachable daemon as an error, not an empty list', async () => {
		const runner = new ScriptedRunner().onCommand('docker', ['ps'], {
			kind: 'exit',
			code: 1,
			stderr: 'Cannot connect to the Docker daemon\n',
		});
		await expect(listLiveContainers(runner)).rejects.toThrow(
			'`docker ps` failed: Cannot connect to the Docker daemon',
		);
		const missing = new ScriptedRunner().onCommand('docker', ['ps'], {
			kind: 'spawn-failure',
			error: 'spawn docker ENOENT',
		});
		await expect(listLiveContainers(missing)).rejects.toThrow(/could not run `docker ps`/);
	});
});

describe('durable records', () => {
	it('stops claiming a released container but keeps it auditable', () => {
		const db = openMigratedDatabase(':memory:');
		recordStartedContainers(db, [record('id-a', 'malini-ws-a', 'ws-a')]);
		expect(durableContainerRecords(db, BUNDLE)).toHaveLength(1);
		const ownership = new DockerOwnership({
			db,
			runner: new ScriptedRunner(),
			appDataRoot: tempDir(),
			bundleIdentifier: BUNDLE,
		});
		ownership.releaseContainer('id-a');
		expect(durableContainerRecords(db, BUNDLE)).toEqual([]);
		const row = get<{ released_at: string | null }>(
			db,
			"SELECT released_at FROM docker_containers WHERE container_id = 'id-a'",
		);
		expect(row?.released_at).toBeTruthy();
		db.close();
	});

	it('refreshes attribution on a restart instead of duplicating it', () => {
		const db = openMigratedDatabase(':memory:');
		const ownership = new DockerOwnership({
			db,
			runner: new ScriptedRunner(),
			appDataRoot: tempDir(),
			bundleIdentifier: BUNDLE,
			appInstanceId: 'instance-1',
			appPid: 4242,
		});
		ownership.recordContainers([
			{
				containerId: 'id-a',
				containerName: 'malini-ws-a-svc-1',
				workstreamId: 'ws-a',
				composeProject: 'malini-ws-a',
				service: 'svc',
				owner: 'workstream',
				cwd: '/tmp/checkout',
			},
		]);
		ownership.releaseContainer('id-a');
		ownership.recordContainers([
			{
				containerId: 'id-a',
				containerName: 'malini-ws-a-svc-2',
				workstreamId: 'ws-a',
				composeProject: 'malini-ws-a',
				service: 'svc',
				owner: 'workstream',
				cwd: '/tmp/checkout',
			},
		]);
		const records = ownership.durableRecords();
		expect(records).toHaveLength(1);
		expect(records[0]?.containerName).toBe('malini-ws-a-svc-2');
		expect(records[0]?.releasedAt).toBeNull();
		expect(records[0]?.appPid).toBe(4242);
		expect(records[0]?.appInstanceId).toBe('instance-1');
		expect(ownership.ownedContainerCount()).toBe(1);
		db.close();
	});

	it('refuses an owner the table does not allow', () => {
		const db = openMigratedDatabase(':memory:');
		expect(() =>
			db
				.prepare(
					`INSERT INTO docker_containers (container_id, container_name, bundle_identifier,
					   app_instance_id, workstream_id, compose_project, service, owner, cwd, started_at)
					 VALUES ('x', 'x', ?, 'i', NULL, 'p', 's', 'nonsense', '/tmp', 'now')`,
				)
				.run(BUNDLE),
		).toThrow();
		db.close();
	});

	it('validates every field of a recorded container', () => {
		const db = openMigratedDatabase(':memory:');
		const ownership = new DockerOwnership({
			db,
			runner: new ScriptedRunner(),
			appDataRoot: tempDir(),
			bundleIdentifier: BUNDLE,
		});
		const valid = {
			containerId: 'abc',
			containerName: 'n',
			composeProject: 'p',
			service: 's',
			owner: 'workstream',
			cwd: '/tmp',
		};
		expect(() => ownership.recordContainers([{ ...valid, owner: 'nobody' }])).toThrow(
			'docker container owner must be workstream, shared, or extension, not `nobody`',
		);
		expect(() => ownership.recordContainers([{ ...valid, containerId: 'has space' }])).toThrow(
			/docker ownership container id must be/,
		);
		expect(() => ownership.recordContainers([{ ...valid, composeProject: 'Bad' }])).toThrow(
			/Docker Compose project name must be/,
		);
		expect(() => ownership.recordContainers([{ ...valid, service: '-svc' }])).toThrow(
			/Docker Compose service name must be/,
		);
		db.close();
	});
});

describe('claiming a service', () => {
	it('returns the handshake with the overlay and the repository compose files', () => {
		const db = openMigratedDatabase(':memory:');
		const appDataRoot = tempDir();
		const repository = tempDir();
		writeFileSync(join(repository, 'compose.yaml'), 'services: {}\n');
		const ownership = new DockerOwnership({
			db,
			runner: new ScriptedRunner(),
			appDataRoot,
			bundleIdentifier: BUNDLE,
			appInstanceId: 'instance-1',
		});
		const handshake = ownership.claimService({
			repository,
			scope: 'ws-1',
			workstreamId: 'ws-1',
			service: 'db',
			owner: 'workstream',
		});
		expect(handshake.bundleIdentifier).toBe(BUNDLE);
		expect(handshake.appInstanceId).toBe('instance-1');
		expect(handshake.composeProject).toBe(composeProjectName(repository, 'ws-1'));
		expect(handshake.composeFiles).toEqual([join(repository, 'compose.yaml')]);
		expect(handshake.overlay.labels[LABEL_SERVICE]).toBe('db');
		expect(existsSync(handshake.overlay.path)).toBe(true);
		const explicit = ownership.claimService({
			repository,
			scope: 'ws-1',
			workstreamId: 'ws-1',
			service: 'db',
			owner: 'shared',
			composeProject: 'my-project',
		});
		expect(explicit.composeProject).toBe('my-project');
		expect(() =>
			ownership.claimService({
				repository,
				scope: 'ws-1',
				workstreamId: 'ws-1',
				service: 'db',
				owner: 'shared',
				composeProject: 'My Project',
			}),
		).toThrow(/Docker Compose project name must be/);
		db.close();
	});

	it('refuses a claim when the repository has no compose file, before writing anything', () => {
		const db = openMigratedDatabase(':memory:');
		const appDataRoot = tempDir();
		const repository = tempDir();
		const ownership = new DockerOwnership({
			db,
			runner: new ScriptedRunner(),
			appDataRoot,
			bundleIdentifier: BUNDLE,
		});
		expect(() =>
			ownership.claimService({
				repository,
				scope: 'ws-1',
				workstreamId: 'ws-1',
				service: 'db',
				owner: 'workstream',
			}),
		).toThrow(/no Compose file found/);
		expect(existsSync(join(appDataRoot, 'docker-ownership'))).toBe(false);
		db.close();
	});
});
