import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '$main/db/open';
import { seedWorkstream } from './test-support';
import { answersOnLoopback, listLeasedPorts, workstreamEnvironment } from './ports';
import { archiveWorkstreamRecord, deleteWorkstream } from './workstreams.repository';

const folders: string[] = [];

afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function checkoutListing(ports: unknown): string {
	const checkout = mkdtempSync(join(tmpdir(), 'malini-ports-'));
	folders.push(checkout);
	mkdirSync(join(checkout, '.malini'));
	writeFileSync(
		join(checkout, '.malini', 'workspace.json'),
		JSON.stringify({ schemaVersion: 1, ports }),
	);
	return checkout;
}

const ignore = (): void => {};

const busy =
	(...ports: number[]) =>
	async (port: number) =>
		ports.includes(port);

describe('named ports', () => {
	it('leases each listed name a port no other workstream holds and nothing answers on', async () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'w-1', '/tmp/w-1');
		seedWorkstream(db, 'w-2', '/tmp/w-2');
		const checkout = checkoutListing(['web', 'admin-api']);

		expect(await workstreamEnvironment(db, 'w-1', checkout, ignore, busy(40_000))).toEqual({
			MALINI_WORKSTREAM_ID: 'w-1',
			MALINI_PORT_WEB: '40001',
			MALINI_PORT_ADMIN_API: '40002',
		});
		expect(await workstreamEnvironment(db, 'w-2', checkout, ignore, busy())).toEqual({
			MALINI_WORKSTREAM_ID: 'w-2',
			MALINI_PORT_WEB: '40000',
			MALINI_PORT_ADMIN_API: '40003',
		});
		expect(
			await workstreamEnvironment(db, 'w-1', checkout, ignore, busy(40_001, 40_002)),
		).toMatchObject({
			MALINI_PORT_WEB: '40001',
			MALINI_PORT_ADMIN_API: '40002',
		});
	});

	it('gives its ports back when its workstream is archived or deleted', async () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'w-1', '/tmp/w-1');
		seedWorkstream(db, 'w-2', '/tmp/w-2');
		const checkout = checkoutListing(['web']);
		await workstreamEnvironment(db, 'w-1', checkout, ignore, busy());
		await workstreamEnvironment(db, 'w-2', checkout, ignore, busy());

		archiveWorkstreamRecord(db, 'w-1', {
			ref: null,
			at: '2026-11-17T00:00:00Z',
			savedForLater: false,
		});
		deleteWorkstream(db, 'w-2');

		expect(listLeasedPorts(db)).toEqual([]);
	});

	it('sets only the workstream id when the file lists no valid ports', async () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'w-1', '/tmp/w-1');
		const lines: string[] = [];

		for (const ports of [undefined, ['Web'], 'web']) {
			expect(
				await workstreamEnvironment(
					db,
					'w-1',
					checkoutListing(ports),
					(line) => lines.push(line),
					busy(),
				),
			).toEqual({ MALINI_WORKSTREAM_ID: 'w-1' });
		}
		expect(
			await workstreamEnvironment(
				db,
				'w-1',
				join(checkoutListing([]), 'no-checkout'),
				(line) => lines.push(line),
				busy(),
			),
		).toEqual({ MALINI_WORKSTREAM_ID: 'w-1' });
		expect(lines).toHaveLength(2);
		expect(listLeasedPorts(db)).toEqual([]);
	});

	it('sees a server that listens on the loopback', async () => {
		const server = await new Promise<Server>((resolve) => {
			const listening = createServer().listen(0, '127.0.0.1', () => resolve(listening));
		});
		const address = server.address();
		if (address === null || typeof address === 'string') throw new Error('no port');
		expect(await answersOnLoopback(address.port)).toBe(true);
		await new Promise((resolve) => server.close(resolve));
		expect(await answersOnLoopback(address.port)).toBe(false);
	});
});
