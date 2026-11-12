import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BestboyProjects as ProjectsState } from '$contract/stats';
import { Bestboy } from './bestboy';
import { BestboyProjects, type ProjectSource } from './projects';

const NOW = new Date(2026, 10, 12, 9);
const ORIGIN = 'https://bestboy.test';
const SOURCE: ProjectSource = {
	repositoryId: 'gardener',
	fullName: 'ablaszkiewicz/gardener-game',
	private: true,
	homepage: 'https://garden-wars.io',
	startedAt: [new Date(2026, 10, 10, 9).toISOString(), new Date(2026, 10, 12, 8).toISOString()],
	changelog: () => Promise.resolve('## 2026-11-10\n\nParty rooms\n'),
};

const folders: string[] = [];

afterEach(() => {
	vi.useRealTimers();
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('BestboyProjects', () => {
	it('sends only the link, the days and the changelog, and shows what bestboy.dev answers', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
		const { projects, platform } = signedIn();
		platform.answer(404);
		projects.start();

		const turnedOn = await projects.set({
			repositoryId: 'gardener',
			on: true,
			link: 'garden-wars.io',
		});
		expect(turnedOn.projects[0]).toMatchObject({ link: 'https://garden-wars.io', on: true });
		await vi.advanceTimersByTimeAsync(2_000);
		await vi.waitFor(() => expect(platform.bodies()).toHaveLength(1));
		expect(platform.bodies()).toEqual([
			{
				version: 1,
				projects: [
					{
						link: 'https://garden-wars.io',
						days: [{ date: '2026-11-10', runs: 1 }],
						changelog: '## 2026-11-10\n\nParty rooms\n',
					},
				],
			},
		]);
		expect(JSON.stringify(platform.bodies())).not.toContain('gardener');
		expect((await projects.projects()).problem).toBeNull();

		projects.keepUp();
		await vi.advanceTimersByTimeAsync(15 * 60_000);
		expect(platform.bodies()).toHaveLength(1);

		platform.answer(400, { error: 'This link answers 404', field: 'projects[0].link' });
		await projects.set({ repositoryId: 'gardener', on: true, link: 'https://garden-wars.io/play' });
		await vi.advanceTimersByTimeAsync(2_000);
		await vi.waitFor(async () =>
			expect((await projects.projects()).projects[0]?.problem).toBe('This link answers 404'),
		);

		platform.answer(200, {
			projects: [{ state: 'ready', url: `${ORIGIN}/projects/garden-wars` }],
		});
		await projects.set({ repositoryId: 'gardener', on: true, link: 'https://garden-wars.io' });
		await vi.advanceTimersByTimeAsync(2_000);
		await vi.waitFor(async () =>
			expect((await projects.projects()).projects[0]).toMatchObject({
				state: 'ready',
				url: `${ORIGIN}/projects/garden-wars`,
				problem: null,
			}),
		);

		platform.answer(200, { projects: [] });
		await projects.set({ repositoryId: 'gardener', on: false, link: 'https://garden-wars.io' });
		await vi.advanceTimersByTimeAsync(2_000);
		await vi.waitFor(() => expect(platform.bodies().at(-1)).toEqual({ version: 1, projects: [] }));
		projects.stop();
	});

	it('refuses a link the platform would refuse and sends nothing signed out', async () => {
		const { projects, platform, session } = signedIn();
		const refused = await projects.set({ repositoryId: 'gardener', on: true, link: '10.0.0.4' });
		expect(refused.projects[0]).toMatchObject({
			on: false,
			problem: 'Needs a domain name, not an IP address',
		});

		session.token = null;
		await expect(
			projects.set({ repositoryId: 'gardener', on: true, link: 'garden-wars.io' }),
		).rejects.toThrow('Sign in to Bestboy first.');
		projects.keepUp();
		await vi.waitFor(() => expect(platform.bodies()).toEqual([]));
	});
});

function signedIn(): {
	projects: BestboyProjects;
	platform: ReturnType<typeof fakePlatform>;
	session: { token: string | null };
} {
	const folder = mkdtempSync(join(tmpdir(), 'malini-projects-'));
	folders.push(folder);
	const platform = fakePlatform();
	const session: { token: string | null } = { token: 'secret-token' };
	const changes: ProjectsState[] = [];
	const projects = new BestboyProjects({
		bestboy: new Bestboy(ORIGIN, platform.fetch),
		appDataRoot: folder,
		session: () => (session.token ? { token: session.token, handle: null } : null),
		signedOut: () => {
			session.token = null;
			return Promise.resolve();
		},
		sources: () => Promise.resolve([SOURCE]),
		changed: (state) => changes.push(state),
		now: () => NOW,
	});
	return { projects, platform, session };
}

function fakePlatform(): {
	fetch: (url: string, init: RequestInit) => Promise<Response>;
	answer(status: number, body?: unknown): void;
	bodies(): unknown[];
} {
	const bodies: unknown[] = [];
	let reply: Readonly<{ status: number; body: unknown }> = { status: 404, body: {} };
	return {
		answer: (status, body = {}) => {
			reply = { status, body };
		},
		bodies: () => bodies,
		fetch: (url, init) => {
			expect(`${init.method} ${new URL(url).pathname}`).toBe('PUT /api/projects');
			bodies.push(JSON.parse(typeof init.body === 'string' ? init.body : 'null'));
			return Promise.resolve(Response.json(reply.body, { status: reply.status }));
		},
	};
}
