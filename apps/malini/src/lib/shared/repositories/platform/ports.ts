import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, isRecord, run } from '$main/db/rows';
import { describeError, isErrnoException } from '$main/errors';
import { parsePortNames, portVariable } from '../domain/port-names';
import { makeScratchFolder } from './scratch';

export const LEASED_PORT_RANGE = Object.freeze({ first: 40_000, last: 48_999 });
const WORKSPACE_FILE = join('.malini', 'workspace.json');
const PROBE_TIMEOUT_MS = 250;

export type PortProbe = (port: number) => Promise<boolean>;

export interface LeasedPort {
	readonly workstreamId: string;
	readonly name: string;
	readonly port: number;
}

export async function workstreamEnvironment(
	db: MaliniDatabase,
	workstreamId: string,
	checkout: string,
	log: (line: string) => void = console.warn,
	answers: PortProbe = answersOnLoopback,
): Promise<Readonly<Record<string, string>>> {
	const environment: Record<string, string> = { MALINI_WORKSTREAM_ID: workstreamId };
	try {
		environment['TMPDIR'] = await makeScratchFolder(workstreamId);
	} catch (error) {
		log(`malini: \`${workstreamId}\` has no scratch folder, ${describeError(error)}`);
	}
	for (const name of await listedPortNames(checkout, log)) {
		const port = await leasePort(db, workstreamId, name, answers);
		if (port === null) log(`malini: no free port is left for \`${name}\` in \`${workstreamId}\``);
		else environment[portVariable(name)] = String(port);
	}
	return environment;
}

export function leasedEnvironment(
	db: MaliniDatabase,
	workstreamId: string,
): Readonly<Record<string, string>> {
	return Object.fromEntries([
		['MALINI_WORKSTREAM_ID', workstreamId],
		...listLeasedPorts(db)
			.filter((lease) => lease.workstreamId === workstreamId)
			.map(({ name, port }) => [portVariable(name), String(port)]),
	]);
}

export function listLeasedPorts(db: MaliniDatabase): LeasedPort[] {
	return all<{ workstream_id: string; name: string; port: number }>(
		db,
		'SELECT workstream_id, name, port FROM workstream_ports ORDER BY port',
	).map((row) => ({ workstreamId: row.workstream_id, name: row.name, port: row.port }));
}

async function listedPortNames(
	checkout: string,
	log: (line: string) => void,
): Promise<readonly string[]> {
	let contents: string;
	try {
		contents = await readFile(join(checkout, WORKSPACE_FILE), 'utf8');
	} catch (error) {
		if (!isErrnoException(error) || error.code !== 'ENOENT')
			log(`malini: could not read ${WORKSPACE_FILE}: ${describeError(error)}`);
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(contents);
		const ports = isRecord(parsed) ? parsed.ports : undefined;
		return ports === undefined ? [] : parsePortNames(ports, `${WORKSPACE_FILE} ports`);
	} catch (error) {
		log(`malini: leased no ports, ${describeError(error)}`);
		return [];
	}
}

async function leasePort(
	db: MaliniDatabase,
	workstreamId: string,
	name: string,
	answers: PortProbe,
): Promise<number | null> {
	let port = leasedPort(db, workstreamId, name);
	const taken = new Set(listLeasedPorts(db).map((lease) => lease.port));
	for (
		let candidate = LEASED_PORT_RANGE.first;
		port === null && candidate <= LEASED_PORT_RANGE.last;
		candidate += 1
	) {
		if (taken.has(candidate) || (await answers(candidate))) continue;
		run(
			db,
			'INSERT OR IGNORE INTO workstream_ports (workstream_id, name, port) VALUES (?, ?, ?)',
			workstreamId,
			name,
			candidate,
		);
		port = leasedPort(db, workstreamId, name);
	}
	return port;
}

function leasedPort(db: MaliniDatabase, workstreamId: string, name: string): number | null {
	return (
		get<{ port: number }>(
			db,
			'SELECT port FROM workstream_ports WHERE workstream_id = ? AND name = ?',
			workstreamId,
			name,
		)?.port ?? null
	);
}

export async function answersOnLoopback(port: number): Promise<boolean> {
	const answered = await Promise.all(['127.0.0.1', '::1'].map((host) => answers(host, port)));
	return answered.includes(true);
}

function answers(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ host, port });
		const settle = (answered: boolean): void => {
			socket.destroy();
			resolve(answered);
		};
		socket.setTimeout(PROBE_TIMEOUT_MS, () => settle(true));
		socket.once('connect', () => settle(true));
		socket.once('error', (error: NodeJS.ErrnoException) => settle(error.code === 'ECONNRESET'));
	});
}
