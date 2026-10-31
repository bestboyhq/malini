import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProfileState } from '$contract/stats';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { Bestboy } from './bestboy';
import { PROFILE_FILE, ProfileStore, type TokenCipher } from './profile-store';
import { readPublishedStats } from './published-stats';
import { StatsProfile } from './stats-profile';

const NOW = new Date(2026, 9, 27, 9);
const ORIGIN = 'https://bestboy.test';
const SENT = [
	'days',
	'intensity',
	'otherRepositories',
	'repositories',
	'since',
	'through',
	'totals',
	'version',
];

const folders: string[] = [];

afterEach(() => {
	vi.useRealTimers();
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('StatsProfile', () => {
	it('retries an upload the network dropped, then removes the stats before it signs out', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const { profile, platform, folder } = await signedInProfile();

		const published = await profile.publish('Szymeo');
		expect(published.problem).toBeNull();
		await vi.waitFor(() => expect(profile.state().upload.state).toBe('published'));
		expect(platform.calls()).toEqual([
			'PUT /api/profile {"handle":"szymeo","public":true}',
			'PUT /api/stats/malini',
		]);
		const upload = platform.uploads().at(-1);
		expect(Object.keys(upload ?? {}).sort()).toEqual(SENT);
		expect(upload).toMatchObject({
			totals: { runs: 1, automatedRuns: 0, inputTokens: 1_200, outputTokens: 30 },
		});

		platform.fail('/api/stats/malini', 503);
		await profile.pick(['bestboyhq/malini']);
		await vi.advanceTimersByTimeAsync(3_000);
		await vi.waitFor(() =>
			expect(profile.state().upload).toEqual({
				state: 'failed',
				reason: 'bestboy.test answered 503.',
				retrying: true,
			}),
		);
		await vi.advanceTimersByTimeAsync(60_000);
		await vi.waitFor(() => expect(profile.state().upload.state).toBe('published'));
		expect(platform.uploads().at(-1)).toMatchObject({
			repositories: [{ name: 'bestboyhq/malini', count: 1 }],
		});

		platform.fail('/api/stats/malini', 503);
		expect((await profile.signOut()).account).toEqual({ name: 'Simon', email: 'simon@test' });
		expect(profile.state().publishing).toBe('removing');

		await vi.advanceTimersByTimeAsync(60_000);
		await vi.waitFor(() => expect(profile.state().publishing).toBe('off'));
		const signedOut: ProfileState = await profile.signOut();
		expect(signedOut.account).toBeNull();
		expect(platform.calls().slice(-4)).toEqual([
			'DELETE /api/stats/malini',
			'DELETE /api/stats/malini',
			'PUT /api/profile {"public":false}',
			'POST /api/auth/logout',
		]);
		expect(readFileSync(join(folder, PROFILE_FILE), 'utf8')).not.toContain('secret-token');
	});

	it('drops the token on a 401 and keeps the switch on until you sign in again', async () => {
		const { profile, platform } = await signedInProfile();
		platform.fail('/api/stats/malini', 401);

		await profile.publish('szymeo');
		await vi.waitFor(() => expect(profile.state().signInNeeded).toBe(true));
		expect(profile.state()).toMatchObject({ account: null, publishing: 'on' });
	});
});

async function signedInProfile(): Promise<{
	profile: StatsProfile;
	platform: ReturnType<typeof fakePlatform>;
	folder: string;
}> {
	const folder = mkdtempSync(join(tmpdir(), 'malini-stats-profile-'));
	folders.push(folder);
	const store = new ProfileStore(folder, fakeCipher());
	await store.save({
		token: 'secret-token',
		account: { name: 'Simon', email: 'simon@test' },
		profile: { handle: null, public: false, url: null },
		publishing: 'off',
		publishedThrough: null,
		picked: [],
	});
	const db = seededDatabase();
	const platform = fakePlatform();
	const profile = new StatsProfile({
		bestboy: new Bestboy(ORIGIN, platform.fetch),
		store,
		openExternal: () => Promise.resolve(),
		readStats: (picked) => readPublishedStats(db, NOW, picked, () => Promise.resolve(true)),
		githubLogin: () => Promise.resolve('szymeo'),
		changed: () => undefined,
		now: () => NOW,
	});
	return { profile, platform, folder };
}

function fakePlatform(): {
	fetch: (url: string, init: RequestInit) => Promise<Response>;
	fail(path: string, status: number): void;
	calls(): string[];
	uploads(): unknown[];
} {
	const calls: string[] = [];
	const uploads: unknown[] = [];
	const failures = new Map<string, number>();
	let profile = { handle: null as string | null, public: false };
	return {
		fail: (path, status) => {
			failures.set(path, status);
		},
		calls: () => calls,
		uploads: () => uploads,
		fetch: (url, init) => {
			const path = new URL(url).pathname;
			const body = typeof init.body === 'string' ? init.body : '';
			calls.push(`${init.method} ${path}${path === '/api/profile' ? ` ${body}` : ''}`.trimEnd());
			const failure = failures.get(path);
			failures.delete(path);
			if (failure) return Promise.resolve(new Response('{}', { status: failure }));
			if (path === '/api/profile') {
				profile = { ...profile, ...JSON.parse(body) };
				return Promise.resolve(
					Response.json({
						...profile,
						url: profile.handle ? `${ORIGIN}/@${profile.handle}` : null,
					}),
				);
			}
			if (path === '/api/stats/malini' && init.method === 'PUT') uploads.push(JSON.parse(body));
			return Promise.resolve(new Response(null, { status: 204 }));
		},
	};
}

function fakeCipher(): TokenCipher {
	return {
		isEncryptionAvailable: () => true,
		encryptString: (text) => Buffer.from([...text].reverse().join('')),
		decryptString: (sealed) => [...sealed.toString()].reverse().join(''),
	};
}

function seededDatabase(): ReturnType<typeof openMigratedDatabase> {
	const db = openMigratedDatabase(':memory:');
	run(
		db,
		`INSERT INTO connected_repositories (id, full_name, default_branch, local_path, remote_url, created_at)
		 VALUES ('connected', 'bestboyhq/malini', 'main', NULL, 'https://github.com/bestboyhq/malini.git', ?)`,
		NOW.toISOString(),
	);
	run(
		db,
		`INSERT INTO projects (id, name, repo_path, default_branch, created_at)
		 VALUES ('local__bestboyhq__malini', 'malini', '/tmp/repo', 'main', ?)`,
		NOW.toISOString(),
	);
	run(
		db,
		`INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at)
		 VALUES ('ws', 'local__bestboyhq__malini', 'ws', '/tmp/ws', 'malini/ws', 'main', 'active', ?)`,
		NOW.toISOString(),
	);
	run(
		db,
		`INSERT INTO agent_sessions (id, workstream_id, status, started_at) VALUES ('s', 'ws', 'idle', ?)`,
		NOW.toISOString(),
	);
	run(
		db,
		`INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at)
		 VALUES ('r', 's', 'prompt', ?, ?)`,
		new Date(2026, 9, 26, 10).toISOString(),
		new Date(2026, 9, 26, 10, 5).toISOString(),
	);
	run(
		db,
		`INSERT INTO agent_events (session_id, run_id, event, emitted_at) VALUES ('s', 'r', ?, ?)`,
		`usage.updated\n${JSON.stringify({ inputTokens: 1_200, outputTokens: 30 })}`,
		new Date(2026, 9, 26, 10, 5).toISOString(),
	);
	return db;
}
