import { existsSync } from 'node:fs';
import { readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutFinding } from '$contract/repositories';
import { listWorkstreamFiles } from '$main/git/diff';
import { initRealRepo, realGit, removeDir, tempDir } from '$main/git/fixtures.test-support';
import { createCheckpointSnapshot } from '$main/git/snapshots';
import { createNodeProcessRunner } from '$main/process/runner';
import {
	diagnoseCheckout,
	repairCheckout,
	STALE_LOCK_MS,
	type CheckoutCase,
} from './checkout-doctor';

const BRANCH = 'malini/ws1';

let root: string;
let base: string;
let checkout: string;
let admin: string;

function patient(snapshotRefs: readonly string[] = []): CheckoutCase {
	return {
		checkout,
		repository: base,
		branch: BRANCH,
		snapshotRefs,
		baseStart: async () => 'main',
		runner: createNodeProcessRunner(),
	};
}

async function files(): Promise<string[]> {
	return (await listWorkstreamFiles(checkout)).map((entry) => entry.path);
}

async function healed(finding: CheckoutFinding): Promise<void> {
	expect(await diagnoseCheckout(patient())).toBe(finding);
	await repairCheckout(patient());
	expect(await diagnoseCheckout(patient())).toBeNull();
	expect(await files()).toEqual(['seed.txt', 'work.txt']);
	expect(await readFile(join(checkout, 'work.txt'), 'utf8')).toBe('uncommitted\n');
}

beforeEach(async () => {
	root = await realpath(await tempDir('malini-checkout-doctor-'));
	base = join(root, 'base');
	checkout = join(root, 'workstreams', 'ws1');
	admin = join(base, '.git', 'worktrees', 'ws1');
	await initRealRepo(base);
	await realGit(base, ['worktree', 'add', '-q', checkout, '-b', BRANCH]);
	await writeFile(join(checkout, 'work.txt'), 'uncommitted\n');
});

afterEach(() => removeDir(root));

describe('diagnoseCheckout', () => {
	it('finds nothing wrong with a healthy checkout', async () => {
		expect(await diagnoseCheckout(patient())).toBeNull();
	});

	it('names a missing base repository, which no repair can bring back', async () => {
		await rm(admin, { recursive: true, force: true });
		expect(await diagnoseCheckout({ ...patient(), repository: null })).toBe(
			'base-repository-missing',
		);
	});

	it('leaves a young lock alone, since git may still hold it', async () => {
		await writeFile(join(admin, 'index.lock'), '');
		expect(await diagnoseCheckout(patient())).toBeNull();
	});
});

describe('repairCheckout', () => {
	it('writes back a missing .git link', async () => {
		await rm(join(checkout, '.git'));
		await healed('git-link-missing');
	});

	it('registers the checkout again when its admin folder is gone', async () => {
		await rm(admin, { recursive: true, force: true });
		await healed('admin-missing');
	});

	it('moves a stale index.lock aside', async () => {
		const lock = join(admin, 'index.lock');
		await writeFile(lock, '');
		const old = new Date(Date.now() - 2 * STALE_LOCK_MS);
		await utimes(lock, old, old);
		await healed('stale-lock');
		expect(existsSync(lock)).toBe(false);
		await realGit(checkout, ['add', 'work.txt']);
	});

	it('rebuilds a corrupt index from HEAD and keeps the working files', async () => {
		await writeFile(join(admin, 'index'), 'not an index');
		await healed('index-corrupt');
	});

	it('points a broken HEAD back at the branch', async () => {
		await writeFile(join(admin, 'HEAD'), 'nonsense\n');
		await healed('head-invalid');
		expect((await realGit(checkout, ['symbolic-ref', 'HEAD'])).trim()).toBe(`refs/heads/${BRANCH}`);
	});

	it('creates a missing folder again from its branch and its newest snapshot', async () => {
		await writeFile(join(checkout, 'seed.txt'), 'changed\n');
		const ref = 'refs/malini/checkpoints/ws1-run';
		await createCheckpointSnapshot(checkout, ref, 'run');
		await rm(checkout, { recursive: true, force: true });

		expect(await diagnoseCheckout(patient([ref]))).toBe('folder-missing');
		await repairCheckout(patient([ref]));

		expect(await diagnoseCheckout(patient([ref]))).toBeNull();
		expect(await files()).toEqual(['seed.txt', 'work.txt']);
		expect(await readFile(join(checkout, 'seed.txt'), 'utf8')).toBe('changed\n');
		expect(await readFile(join(checkout, 'work.txt'), 'utf8')).toBe('uncommitted\n');
		expect((await realGit(checkout, ['symbolic-ref', 'HEAD'])).trim()).toBe(`refs/heads/${BRANCH}`);
	});
});
