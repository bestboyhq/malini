import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BestboyProfile, ProfileState } from '$contract/stats';
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
		const { profile, platform, folder, publishedProfiles } = await signedInProfile();

		const published = await profile.publish('Szymeo');
		expect(published.problem).toBeNull();
		expect(publishedProfiles.map(({ handle }) => handle)).toEqual(['szymeo']);
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
		await vi.waitFor(() =>
			expect(profile.state().upload).toMatchObject({ state: 'failed', retrying: false }),
		);
		expect(profile.state()).toMatchObject({ account: null, publishing: 'on' });
	});

	it('lends usage counts the account on current terms, holds them on old terms, and lends none once signed out', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
		const { profile, platform } = await signedInProfile();
		const anHourLater = (): void => {
			vi.setSystemTime(Date.now() + 61 * 60_000);
		};

		expect(await profile.usageAccount()).toEqual({ state: 'accepted', userId: 'u1' });
		expect(await profile.usageAccount()).toEqual({ state: 'accepted', userId: 'u1' });

		platform.changeTerms('2026-11-09');
		expect(await profile.usageAccount()).toEqual({ state: 'accepted', userId: 'u1' });
		anHourLater();
		const [first, second] = await Promise.all([profile.usageAccount(), profile.usageAccount()]);
		expect([first, second]).toEqual([{ state: 'old-terms' }, { state: 'old-terms' }]);
		expect(profile.state().unacceptedTerms?.date).toBe('2026-11-09');

		platform.accept();
		anHourLater();
		expect(await profile.usageAccount()).toEqual({ state: 'accepted', userId: 'u1' });

		await profile.signOut();
		expect(await profile.usageAccount()).toEqual({ state: 'anonymous' });
		anHourLater();
		expect(await profile.usageAccount()).toEqual({ state: 'anonymous' });
		expect(platform.calls().filter((call) => call === 'GET /api/me')).toHaveLength(3);
	});

	it('asks Bestboy again five minutes after an account check that failed', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
		const { profile, platform } = await signedInProfile();
		const later = (minutes: number): void => {
			vi.setSystemTime(Date.now() + minutes * 60_000);
		};
		platform.fail('/api/me', 503);

		expect(await profile.usageAccount()).toEqual({ state: 'anonymous' });
		later(4);
		expect(await profile.usageAccount()).toEqual({ state: 'anonymous' });
		expect(platform.calls().filter((call) => call === 'GET /api/me')).toHaveLength(1);

		later(2);
		expect(await profile.usageAccount()).toEqual({ state: 'accepted', userId: 'u1' });
		expect(platform.calls().filter((call) => call === 'GET /api/me')).toHaveLength(2);
	});

	it('keeps your stats off when an account check answers after you unpublish', async () => {
		const { profile, platform, folder } = await signedInProfile();
		await profile.publish('szymeo');
		await vi.waitFor(() => expect(profile.state().upload.state).toBe('published'));

		const answer = platform.hold('/api/me');
		const counting = profile.usageAccount();
		expect((await profile.unpublish()).publishing).toBe('off');
		answer();
		await counting;

		expect(profile.state().publishing).toBe('off');
		expect(new ProfileStore(folder, fakeCipher()).load()).toMatchObject({
			publishing: 'off',
			publishedThrough: null,
		});
	});

	it('says so when the Bestboy sign-in runs out of time', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const { profile } = await signedInProfile();
		expect(profile.signIn().signingIn).toBe(true);

		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(profile.state().signingIn).toBe(false);
		expect(profile.state().signInProblem).toEqual(expect.any(String));
	});

	it('finishes a Bestboy sign-in that comes back after Malini restarts', async () => {
		const folder = mkdtempSync(join(tmpdir(), 'malini-stats-profile-'));
		folders.push(folder);
		const platform = fakePlatform();
		const opened: string[] = [];
		const before = statsProfile(new ProfileStore(folder, fakeCipher()), platform, opened);
		expect(before.signIn().signingIn).toBe(true);
		await vi.waitFor(() => expect(opened).toHaveLength(1));
		before.stop();
		const state = new URL(opened[0] ?? '').searchParams.get('state') ?? '';

		const after = statsProfile(new ProfileStore(folder, fakeCipher()), platform, []);
		expect(after.state().signingIn).toBe(true);
		await after.completeSignIn(`malini://auth?${new URLSearchParams({ code: 'c1', state })}`);

		expect(after.state()).toMatchObject({
			account: { name: 'Simon', email: 'simon@test' },
			signingIn: false,
			signInProblem: null,
		});
		expect(platform.calls().slice(0, 2)).toEqual(['POST /api/auth/token', 'GET /api/me']);
		const relaunched = statsProfile(new ProfileStore(folder, fakeCipher()), platform, []);
		expect(relaunched.state()).toMatchObject({ signingIn: false, account: { name: 'Simon' } });
	});
});

async function signedInProfile(): Promise<{
	profile: StatsProfile;
	platform: ReturnType<typeof fakePlatform>;
	folder: string;
	publishedProfiles: BestboyProfile[];
}> {
	const folder = mkdtempSync(join(tmpdir(), 'malini-stats-profile-'));
	folders.push(folder);
	const store = new ProfileStore(folder, fakeCipher());
	await store.save({
		token: 'secret-token',
		account: { name: 'Simon', email: 'simon@test' },
		profile: { handle: null, public: false, url: null },
		unacceptedTerms: null,
		acceptedUserId: null,
		publishing: 'off',
		publishedThrough: null,
		picked: [],
		signIn: null,
	});
	const platform = fakePlatform();
	const publishedProfiles: BestboyProfile[] = [];
	const profile = statsProfile(store, platform, [], publishedProfiles);
	return { profile, platform, folder, publishedProfiles };
}

function statsProfile(
	store: ProfileStore,
	platform: ReturnType<typeof fakePlatform>,
	opened: string[],
	publishedProfiles: BestboyProfile[] = [],
): StatsProfile {
	const db = seededDatabase();
	return new StatsProfile({
		bestboy: new Bestboy(ORIGIN, platform.fetch),
		store,
		openExternal: (url) => {
			opened.push(url);
			return Promise.resolve();
		},
		readStats: (picked) => readPublishedStats(db, NOW, picked, () => Promise.resolve(true)),
		githubLogin: () => Promise.resolve('szymeo'),
		changed: () => undefined,
		published: (published) => publishedProfiles.push(published),
		now: () => NOW,
	});
}

function fakePlatform(): {
	fetch: (url: string, init: RequestInit) => Promise<Response>;
	fail(path: string, status: number): void;
	hold(path: string): () => void;
	changeTerms(date: string): void;
	accept(): void;
	calls(): string[];
	uploads(): unknown[];
} {
	const calls: string[] = [];
	const uploads: unknown[] = [];
	const failures = new Map<string, number>();
	const held = new Map<string, Promise<void>>();
	let profile = { handle: null as string | null, public: false };
	let terms = '2026-11-02';
	let accepted = terms;
	return {
		fail: (path, status) => {
			failures.set(path, status);
		},
		hold: (path) => {
			let release = (): void => undefined;
			held.set(path, new Promise((resolve) => (release = resolve)));
			return () => release();
		},
		changeTerms: (date) => {
			terms = date;
		},
		accept: () => {
			accepted = terms;
		},
		calls: () => calls,
		uploads: () => uploads,
		fetch: async (url, init) => {
			const path = new URL(url).pathname;
			const body = typeof init.body === 'string' ? init.body : '';
			calls.push(`${init.method} ${path}${path === '/api/profile' ? ` ${body}` : ''}`.trimEnd());
			const gate = held.get(path);
			held.delete(path);
			if (gate) await gate;
			return respond(path, body, init);
		},
	};

	function respond(path: string, body: string, init: RequestInit): Promise<Response> {
		const failure = failures.get(path);
		failures.delete(path);
		if (failure) return Promise.resolve(new Response('{}', { status: failure }));
		if (path === '/api/auth/token') return Promise.resolve(Response.json({ token: 'new-token' }));
		if (path === '/api/me') {
			return Promise.resolve(
				Response.json({
					user: { id: 'u1', name: 'Simon', email: 'simon@test', terms: accepted },
					terms,
					profile,
				}),
			);
		}
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
	}
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
