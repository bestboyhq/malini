import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { readFile, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutFinding } from '$contract/repositories';
import { FreeSpaceError } from '$main/fs/free-space';
import { noPromptCredentialEnv } from '$main/git/credentials';
import { listWorkstreamFiles } from '$main/git/diff';
import { initRealRepo, realGit, removeDir, tempDir } from '$main/git/fixtures.test-support';
import { installGitRunnerForTests } from '$main/git/run';
import { createCheckpointSnapshot } from '$main/git/snapshots';
import { createNodeProcessRunner } from '$main/process/runner';
import {
	diagnoseCheckout,
	examineCheckout,
	repairCheckout,
	STALE_LOCK_MS,
	type CheckoutCase,
} from './checkout-doctor';
import { ensureBaseClone } from './clone.service';

const BRANCH = 'malini/ws1';

let root: string;
let base: string;
let checkout: string;
let admin: string;

function patient(snapshotRefs: readonly string[] = []): CheckoutCase {
	return {
		checkout,
		checkoutsRoot: root,
		repository: base,
		origin: null,
		branch: BRANCH,
		snapshotRefs,
		baseStart: async () => 'main',
		reclone: () => Promise.reject(new Error('this checkout has no origin')),
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

	it('names a missing base repository that has no origin to clone it from', async () => {
		await rm(admin, { recursive: true, force: true });
		const orphan = { ...patient(), repository: null };
		expect(await diagnoseCheckout(orphan)).toBe('base-repository-missing');
		expect(await repairCheckout(orphan)).toBeNull();
	});

	it('leaves a young lock alone, since git may still hold it', async () => {
		await writeFile(join(admin, 'index.lock'), '');
		expect(await diagnoseCheckout(patient())).toBeNull();
	});

	it('quotes the cause git gives for a lost HEAD commit, not the fetch it tried first', async () => {
		await realGit(base, ['config', 'uploadpack.allowFilter', 'true']);
		const partial = join(root, 'partial');
		const lost = join(root, 'workstreams', 'lost');
		await realGit(root, ['clone', '-q', '--filter=blob:none', `file://${base}`, partial]);
		await realGit(partial, ['worktree', 'add', '-q', lost, '-b', 'malini/lost']);
		await writeFile(join(lost, 'work.txt'), 'committed\n');
		await realGit(lost, ['add', 'work.txt']);
		await realGit(lost, [
			'-c',
			'user.name=t',
			'-c',
			'user.email=t@example.com',
			'commit',
			'-qm',
			'w',
		]);
		const head = (await realGit(lost, ['rev-parse', 'HEAD'])).trim();
		const object = join(partial, '.git', 'objects', head.slice(0, 2), head.slice(2));
		await rename(object, `${object}.lost`);
		const c = { ...patient(), checkout: lost, repository: partial, branch: 'malini/lost' };
		expect(await examineCheckout(c)).toEqual({
			finding: 'unknown',
			said: 'fatal: bad object HEAD',
		});
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

	it('links a checkout whose branch is gone to a new one, and reports no clone', async () => {
		await rm(admin, { recursive: true, force: true });
		await realGit(base, ['branch', '-D', BRANCH]);
		expect(await diagnoseCheckout(patient())).toBe('admin-missing');
		expect(await repairCheckout(patient())).toBeNull();
		expect(await diagnoseCheckout(patient())).toBeNull();
		expect(await files()).toEqual(['seed.txt', 'work.txt']);
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

describe('a base clone that is gone', () => {
	let checkouts: string;
	let origin: string;

	function cloneOf(source: string): Promise<string> {
		return ensureBaseClone({
			repoPath: source,
			checkoutsRoot: checkouts,
			githubToken: null,
			credentials: noPromptCredentialEnv,
			onProgress: () => undefined,
		});
	}

	function orphan(folder = checkout, branch = BRANCH, from = origin): CheckoutCase {
		return {
			checkout: folder,
			checkoutsRoot: checkouts,
			repository: existsSync(join(base, '.git')) ? base : null,
			origin: from,
			branch,
			snapshotRefs: ['refs/malini/checkpoints/ws1-run'],
			baseStart: async () => 'refs/remotes/origin/main',
			reclone: cloneOf,
			runner: createNodeProcessRunner(),
		};
	}

	async function status(folder = checkout): Promise<string[]> {
		return (await realGit(folder, ['status', '--porcelain'])).split('\n').filter(Boolean);
	}

	async function commit(path: string, text: string): Promise<void> {
		await writeFile(join(checkout, path), text);
		await realGit(checkout, ['add', path]);
		await realGit(checkout, ['commit', '-q', '-m', path]);
	}

	beforeEach(async () => {
		checkouts = join(root, 'checkouts');
		origin = join(root, 'github', 'acme', 'app.git');
		await realGit(root, ['clone', '-q', '--bare', '--single-branch', '-b', 'main', base, origin]);
		base = await cloneOf(origin);
		checkout = join(checkouts, 'workstreams', 'ws1');
		await realGit(base, ['worktree', 'add', '-q', checkout, '-b', BRANCH]);
		await realGit(checkout, ['config', 'user.email', 't@example.com']);
		await realGit(checkout, ['config', 'user.name', 't']);
	});

	it('clones it again and keeps commits only this Mac had as edits', async () => {
		await commit('seed.txt', 'committed here\n');
		await commit('feature.txt', 'feature\n');
		await writeFile(join(checkout, 'work.txt'), 'uncommitted\n');
		await rm(base, { recursive: true, force: true });

		expect(await diagnoseCheckout(orphan())).toBe('base-repository-missing');
		expect(await repairCheckout(orphan())).toBe('commits-as-edits');

		expect(existsSync(join(base, '.git'))).toBe(true);
		expect(await diagnoseCheckout(orphan())).toBeNull();
		expect((await realGit(checkout, ['symbolic-ref', 'HEAD'])).trim()).toBe(`refs/heads/${BRANCH}`);
		expect((await realGit(checkout, ['rev-parse', 'HEAD'])).trim()).toBe(
			(await realGit(base, ['rev-parse', 'refs/remotes/origin/main'])).trim(),
		);
		expect(await status()).toEqual([' M seed.txt', '?? feature.txt', '?? work.txt']);
		expect(await readFile(join(checkout, 'seed.txt'), 'utf8')).toBe('committed here\n');
	});

	it('takes the branch back from the origin when it was pushed', async () => {
		await commit('feature.txt', 'feature\n');
		await realGit(checkout, ['push', '-q', 'origin', BRANCH]);
		const pushed = (await realGit(checkout, ['rev-parse', 'HEAD'])).trim();
		await writeFile(join(checkout, 'work.txt'), 'uncommitted\n');
		await rm(base, { recursive: true, force: true });

		expect(await repairCheckout(orphan())).toBe('branch-from-github');

		expect(await diagnoseCheckout(orphan())).toBeNull();
		expect((await realGit(checkout, ['rev-parse', 'HEAD'])).trim()).toBe(pushed);
		expect(await status()).toEqual(['?? work.txt']);
	});

	it('makes the folder again from the pushed branch when the folder is gone too', async () => {
		await commit('feature.txt', 'feature\n');
		await realGit(checkout, ['push', '-q', 'origin', BRANCH]);
		await createCheckpointSnapshot(checkout, 'refs/malini/checkpoints/ws1-run', 'run');
		await rm(base, { recursive: true, force: true });
		await rm(checkout, { recursive: true, force: true });

		expect(await diagnoseCheckout(orphan())).toBe('base-repository-missing');
		expect(await repairCheckout(orphan())).toBe('branch-from-github');

		expect(await diagnoseCheckout(orphan())).toBeNull();
		expect(await readFile(join(checkout, 'feature.txt'), 'utf8')).toBe('feature\n');
		expect(await status()).toEqual([]);
	});

	it('clones once for every workstream of the repository and links each back', async () => {
		const second = join(checkouts, 'workstreams', 'ws2');
		await realGit(base, ['worktree', 'add', '-q', second, '-b', 'malini/ws2']);
		await writeFile(join(second, 'second.txt'), 'second\n');
		await rm(base, { recursive: true, force: true });
		const clones: string[][] = [];
		const restoreGit = installGitRunnerForTests((args, env, previous) => {
			if (args.includes('clone')) clones.push([...args]);
			return previous(args, env);
		});
		try {
			expect(
				await Promise.all([repairCheckout(orphan()), repairCheckout(orphan(second, 'malini/ws2'))]),
			).toEqual(['nothing-lost', 'commits-as-edits']);
		} finally {
			restoreGit();
		}

		expect(clones).toHaveLength(1);
		expect(await diagnoseCheckout(orphan())).toBeNull();
		expect(await diagnoseCheckout(orphan(second, 'malini/ws2'))).toBeNull();
		expect(await status(second)).toEqual(['?? second.txt']);
	});

	it('names a full disk when the clone has no room, and does not clone onto it again', async () => {
		await rm(base, { recursive: true, force: true });
		const full = {
			...orphan(),
			reclone: () => Promise.reject(new FreeSpaceError('Only 1 GB is free')),
		};

		await expect(repairCheckout(full)).rejects.toThrow(FreeSpaceError);

		expect(await diagnoseCheckout(full)).toBe('disk-full');
		expect(await repairCheckout(orphan())).toBeNull();
		expect(existsSync(base)).toBe(false);
	});

	it('names a gone checkouts folder, and only a repair makes it again from the origin', async () => {
		await commit('feature.txt', 'feature\n');
		await realGit(checkout, ['push', '-q', 'origin', BRANCH]);
		await rm(checkouts, { recursive: true, force: true });

		expect(await diagnoseCheckout(orphan())).toBe('checkouts-folder-missing');
		expect(existsSync(checkouts)).toBe(false);

		expect(await repairCheckout(orphan())).toBe('branch-from-github');
		expect(await diagnoseCheckout(orphan())).toBeNull();
		expect(await readFile(join(checkout, 'feature.txt'), 'utf8')).toBe('feature\n');
	});

	describe('when GitHub refuses the clone', () => {
		let server: Server;
		let answer = 401;
		let url: string;

		beforeEach(async () => {
			server = createServer((_request, response) => {
				response.writeHead(answer, { 'WWW-Authenticate': 'Basic realm="GitHub"' });
				response.end();
			});
			await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
			const address = server.address();
			if (address === null || typeof address === 'string') throw new Error('no port');
			url = `http://127.0.0.1:${address.port}/acme/app.git`;
			await rm(base, { recursive: true, force: true });
		});

		afterEach(() => new Promise<void>((closed) => server.close(() => closed())));

		it.each([
			[401, 'github-signed-out'],
			[404, 'remote-missing'],
			[500, 'base-repository-missing'],
		] as const)('names a %i answer %s until a clone works', async (status, finding) => {
			answer = status;
			const refused = orphan(checkout, BRANCH, url);

			await expect(repairCheckout(refused)).rejects.toThrow();

			expect(await diagnoseCheckout(refused)).toBe(finding);
			expect(existsSync(join(checkouts, 'repositories', 'acme__app'))).toBe(false);
			expect(await repairCheckout({ ...refused, reclone: () => cloneOf(origin) })).toBe(
				'nothing-lost',
			);
			await rm(base, { recursive: true, force: true });
			expect(await diagnoseCheckout(refused)).toBe('base-repository-missing');
		});
	});
});
