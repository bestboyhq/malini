import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Initiative, PlanSyncedEvent } from '$contract/initiatives';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { installGitRunnerForTests } from '$main/git/run';
import { CommandRegistry } from '$main/ipc/registry';
import type { GhResult } from '$main/process/gh';
import { recordMergedPullRequest } from '$shared/repositories/repositories.platform';
import { registerInitiatives } from './register';

const REPOSITORY = 'acme/rocket';

const PLAN_REPOSITORY = 'acme/rocket-malini-plan';

const VIEWER = 'kit';

type Access = 'pull' | 'triage' | 'push' | 'maintain' | 'admin';

type Repository = {
	private: boolean;
	organization: boolean;
	admin: boolean;
	people: Map<string, Access>;
	members: Map<string, Access>;
	invited: Map<number, { login: string; access: string | null }>;
};

type FileDependency = {
	id: string;
	title: string;
	done: boolean;
	note: unknown;
	assignee: unknown;
};

type FileOutcome = {
	id: string;
	title: string;
	dueOn: string | null;
	note: unknown;
	createdAt: string;
	dependencies: FileDependency[];
};

type PlanFile = { outcomes: FileOutcome[] };

let root: string;
let context: MainContext;
let github: ReturnType<typeof fakeGithub>;
let synced: PlanSyncedEvent[];
let clock: number;

function fakeGithub() {
	const calls: string[][] = [];
	const repositories = new Map<string, Repository>();
	let offline = false;
	let invitation = 0;
	const add = (name: string, repository: Partial<Repository> = {}): Repository => {
		const created: Repository = {
			private: true,
			organization: true,
			admin: true,
			people: new Map(),
			members: new Map(),
			invited: new Map(),
			...repository,
		};
		repositories.set(name, created);
		mkdirSync(remote(name), { recursive: true });
		execFileSync('git', ['init', '-q', '--bare', remote(name)]);
		return created;
	};
	const answer = (value: unknown): GhResult => ({
		stdout: typeof value === 'string' ? value : JSON.stringify(value),
		stderr: '',
		code: 0,
	});
	const failed = (stderr: string): GhResult => ({ stdout: '', stderr, code: 1 });
	const run = async (args: readonly string[]): Promise<GhResult> => {
		calls.push([...args]);
		if (offline) return failed('error connecting to api.github.com');
		const [, path = ''] = args;
		if (path === 'user') return answer(`4242\t${VIEWER}\tKit Doe\n`);
		const method = args.includes('-X') ? (args[args.indexOf('-X') + 1] ?? 'GET') : 'GET';
		const fields = new Map<string, string>();
		args.forEach((arg, index) => {
			if (args[index - 1] === '-f' || args[index - 1] === '-F') {
				fields.set(arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1));
			}
		});
		const url = new URL(path, 'https://api.github.com/');
		const [, scope = '', owner = '', name = '', collection, item] = url.pathname.split('/');
		if (method === 'POST' && (path === 'user/repos' || (scope === 'orgs' && name === 'repos'))) {
			const created = `${scope === 'orgs' ? owner : VIEWER}/${fields.get('name') ?? ''}`;
			if (repositories.has(created)) return failed('gh: Validation Failed (HTTP 422)');
			add(created, { private: fields.get('private') === 'true', organization: scope === 'orgs' });
			return answer({ full_name: created });
		}
		const found = repositories.get(`${owner}/${name}`);
		if (scope !== 'repos' || found === undefined) return failed('gh: Not Found (HTTP 404)');
		if (collection === undefined) {
			return answer({
				private: found.private,
				owner: { type: found.organization ? 'Organization' : 'User' },
				permissions: { admin: found.admin, push: true, pull: true },
			});
		}
		if (method === 'GET' && url.searchParams.get('page') !== '1') return answer([]);
		const login = item ?? '';
		if (collection === 'collaborators' && method === 'PUT') {
			invitation += 1;
			found.invited.set(invitation, { login, access: fields.get('permission') ?? null });
			return answer({ id: invitation });
		}
		if (collection === 'collaborators' && method === 'DELETE') {
			found.people.delete(login);
			return answer('');
		}
		if (collection === 'collaborators') {
			const direct = url.searchParams.get('affiliation') === 'direct';
			const people = direct ? found.people : new Map([...found.members, ...found.people]);
			return answer(
				[...people].map(([person, access]) => ({
					login: person,
					permissions: { [access]: true },
				})),
			);
		}
		if (collection === 'invitations' && method === 'DELETE') {
			found.invited.delete(Number(item));
			return answer('');
		}
		if (collection === 'invitations') {
			return answer(
				[...found.invited].map(([id, invited]) => ({ id, invitee: { login: invited.login } })),
			);
		}
		return failed('gh: Not Found (HTTP 404)');
	};
	return {
		run,
		calls,
		repositories,
		add,
		accept: (repository: string, login: string) => {
			const found = repositories.get(repository);
			for (const [id, invited] of found?.invited ?? []) {
				if (invited.login !== login) continue;
				found?.invited.delete(id);
				found?.people.set(login, 'push');
			}
		},
		invitees: (repository: string) =>
			[...(repositories.get(repository)?.invited.values() ?? [])].map(
				({ login, access }) => `${login}:${access ?? ''}`,
			),
		setOffline: (next: boolean) => {
			offline = next;
		},
	};
}

function remote(repository: string): string {
	return join(root, 'github', `${repository}.git`);
}

function git(directory: string, args: readonly string[], input?: string, author = VIEWER): string {
	return execFileSync('git', ['-C', directory, '-c', 'commit.gpgsign=false', ...args], {
		input,
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'pipe'],
		env: {
			...process.env,
			GIT_AUTHOR_NAME: author,
			GIT_AUTHOR_EMAIL: `9+${author}@users.noreply.github.com`,
			GIT_COMMITTER_NAME: author,
			GIT_COMMITTER_EMAIL: `9+${author}@users.noreply.github.com`,
		},
	}).trim();
}

function remoteFile(file: string, repository = PLAN_REPOSITORY): string | null {
	try {
		return git(remote(repository), ['show', `main:${file}`]);
	} catch {
		return null;
	}
}

function remotePlan(repository = PLAN_REPOSITORY): PlanFile {
	const text = remoteFile('plan.json', repository);
	if (text === null) throw new Error(`no plan.json in ${repository}`);
	const plan: PlanFile = JSON.parse(text);
	return plan;
}

function remoteSubject(repository = PLAN_REPOSITORY): string {
	return git(remote(repository), ['log', '-1', '--format=%s %ae', 'main']);
}

function teammatePush(files: Readonly<Record<string, string>>, author = 'robin'): void {
	const directory = remote(PLAN_REPOSITORY);
	const parent = git(directory, ['rev-parse', 'main']);
	const entries = new Map(
		git(directory, ['ls-tree', 'main'])
			.split('\n')
			.filter((line) => line.length > 0)
			.map((line) => [line.slice(line.indexOf('\t') + 1), line] as const),
	);
	for (const [file, text] of Object.entries(files)) {
		const blob = git(directory, ['hash-object', '-w', '--stdin'], text);
		entries.set(file, `100644 blob ${blob}\t${file}`);
	}
	const tree = git(directory, ['mktree'], `${[...entries.values()].join('\n')}\n`);
	const commit = git(
		directory,
		['commit-tree', tree, '-p', parent, '-m', 'Edit by hand'],
		'',
		author,
	);
	git(directory, ['update-ref', 'refs/heads/main', commit, parent]);
}

function teammateEdits(edit: (plan: PlanFile) => void, author = 'robin'): void {
	const plan = remotePlan();
	edit(plan);
	teammatePush({ 'plan.json': `${JSON.stringify(plan, null, '\t')}\n` }, author);
}

function fileOutcome(plan: PlanFile, title: string): FileOutcome {
	const found = plan.outcomes.find((candidate) => candidate.title === title);
	if (!found) throw new Error(`no outcome ${title} in plan.json`);
	return found;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'malini-plan-sync-'));
	vi.stubEnv('GIT_CONFIG_COUNT', '2');
	vi.stubEnv('GIT_CONFIG_KEY_0', 'protocol.file.allow');
	vi.stubEnv('GIT_CONFIG_VALUE_0', 'always');
	vi.stubEnv('GIT_CONFIG_KEY_1', `url.file://${join(root, 'github')}/.insteadOf`);
	vi.stubEnv('GIT_CONFIG_VALUE_1', 'https://github.com/');
	context = {
		db: openMigratedDatabase(':memory:'),
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: join(root, 'app'),
		checkoutsRoot: join(root, 'app'),
		resourcesRoot: join(root, 'app'),
		isDev: false,
		appVersion: '0.0.0',
	};
	github = fakeGithub();
	github.add(REPOSITORY, {
		people: new Map([
			[VIEWER, 'admin'],
			['casey', 'push'],
			['robin', 'pull'],
		]),
	});
	synced = [];
	clock = Date.parse('2026-11-23T10:00:00Z');
	context.events.subscribe('initiatives:synced', (event) => synced.push(event));
	registerInitiatives(context, { gh: github.run, now: () => clock });
});

afterEach(() => {
	context.db.close();
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

const call = {
	sync: (repositoryFullName = REPOSITORY) =>
		context.commands.call('initiatives.sync', { repositoryFullName }),
	state: (repositoryFullName = REPOSITORY) =>
		context.commands.call('initiatives.sync-state', { repositoryFullName }),
	turn: (enabled: boolean, repositoryFullName = REPOSITORY) =>
		context.commands.call('initiatives.set-sync', { repositoryFullName, enabled }),
	create: (title: string, dueOn: string | null = null, repositoryFullName = REPOSITORY) =>
		context.commands.call('initiatives.create', { repositoryFullName, title, dueOn }),
	rename: (id: string, title: string) => context.commands.call('initiatives.update', { id, title }),
	addStep: async (initiativeId: string, title: string) => {
		const plan = await context.commands.call('initiatives.add-dependency', { initiativeId, title });
		const step = plan
			.flatMap(({ dependencies }) => dependencies)
			.filter((dependency) => dependency.title === title)
			.at(-1);
		if (!step) throw new Error(`no step ${title}`);
		return step;
	},
};

function outcome(plan: readonly Initiative[], title: string): Initiative {
	const found = plan.find((initiative) => initiative.title === title);
	if (!found)
		throw new Error(`no outcome ${title} in ${plan.map((item) => item.title).join(', ')}`);
	return found;
}

async function sharedPlan(): Promise<Initiative> {
	const [created] = await call.create('Ship billing', '2026-12-01');
	await call.addStep(created?.id ?? '', 'Schema');
	await call.turn(true);
	return outcome(await call.sync(), 'Ship billing');
}

async function offlineWhile(change: () => Promise<unknown>): Promise<void> {
	github.setOffline(true);
	await change();
	await call.sync();
	github.setOffline(false);
}

describe('a plan shared as one file in a private plan repository', () => {
	it('stays off until turned on, and stops again once turned off', async () => {
		const [created] = await call.create('Ship billing', '2026-12-01');
		await call.rename(created?.id ?? '', 'Ship it');
		await call.sync();
		expect(github.calls).toEqual([]);
		expect(await call.state()).toEqual({
			repositoryFullName: REPOSITORY,
			enabled: false,
			home: PLAN_REPOSITORY,
			syncedAt: null,
			error: null,
			people: [],
		});

		await call.turn(true);
		await call.sync();
		expect(remotePlan().outcomes.map(({ title }) => title)).toEqual(['Ship it']);
		expect(await call.turn(false)).toMatchObject({ enabled: false });
		github.calls.length = 0;
		await call.create('Later');
		await call.rename(created?.id ?? '', 'Renamed');
		await call.sync();
		expect(github.calls).toEqual([]);
		expect(remotePlan().outcomes.map(({ title }) => title)).toEqual(['Ship it']);
		await expect(
			context.commands.invoke({
				command: 'initiatives.set-sync',
				args: { repositoryFullName: 'not a repository', enabled: true },
			}),
		).resolves.toMatchObject({ ok: false, error: expect.stringContaining('GitHub owner/name') });
	});

	it.each([
		['private', true],
		['public', false],
	])(
		'shares a %s repository to its own private plan repository, never the code repository',
		async (_, isPrivate) => {
			const source = github.repositories.get(REPOSITORY);
			if (source) source.private = isPrivate;
			const billing = await sharedPlan();

			expect(github.repositories.get(PLAN_REPOSITORY)).toMatchObject({ private: true });
			expect(remoteFile('plan.json', REPOSITORY)).toBeNull();
			expect(remotePlan()).toEqual({
				outcomes: [
					{
						id: billing.id,
						title: 'Ship billing',
						dueOn: '2026-12-01',
						note: null,
						createdAt: expect.stringMatching(/^2\d{3}-/u),
						dependencies: [
							{
								id: billing.dependencies[0]?.id,
								title: 'Schema',
								done: false,
								note: null,
								assignee: null,
							},
						],
					},
				],
			});
			expect(remoteSubject()).toBe('Add Ship billing 4242+kit@users.noreply.github.com');
			expect(await call.state()).toMatchObject({
				enabled: true,
				home: PLAN_REPOSITORY,
				error: null,
				people: [VIEWER],
			});
		},
	);

	it('keeps the people of the code repository in step with the plan repository', async () => {
		const source = github.repositories.get(REPOSITORY);
		source?.members.set('morgan', 'push');
		const plan = github.add(PLAN_REPOSITORY, { members: new Map([['morgan', 'push']]) });
		await sharedPlan();
		expect(github.invitees(PLAN_REPOSITORY)).toEqual(['casey:push', 'robin:pull']);

		github.accept(PLAN_REPOSITORY, 'casey');
		plan.people.set('dana', 'push');
		source?.people.delete('robin');
		source?.people.set('noa', 'maintain');
		github.calls.length = 0;
		await call.sync();
		expect(github.calls.filter(([, path = '']) => path.includes('/collaborators'))).toEqual([]);

		clock += 11 * 60_000;
		await call.sync();
		expect(github.invitees(PLAN_REPOSITORY)).toEqual(['noa:maintain']);
		expect([...plan.people.keys()]).toEqual(['casey']);
		expect(github.repositories.get(REPOSITORY)?.people.has('robin')).toBe(false);
	});

	it('merges what a teammate pushed with your own edits, and says who changed what', async () => {
		const billing = await sharedPlan();
		await offlineWhile(() =>
			context.commands.call('initiatives.update', { id: billing.id, dueOn: '2026-12-10' }),
		);
		teammateEdits((plan) => {
			const shipping = fileOutcome(plan, 'Ship billing');
			shipping.title = 'Ship billing v2';
			const [schema] = shipping.dependencies;
			if (schema) schema.done = true;
			plan.outcomes.push({
				id: 'docs-1',
				title: 'Docs',
				dueOn: null,
				note: null,
				createdAt: '2026-11-23T09:00:00.000Z',
				dependencies: [],
			});
		});

		const merged = await call.sync();
		expect(outcome(merged, 'Ship billing v2')).toMatchObject({
			dueOn: '2026-12-10',
			dependencies: [{ title: 'Schema', done: true }],
		});
		expect(outcome(merged, 'Docs').id).toBe('docs-1');
		expect(fileOutcome(remotePlan(), 'Ship billing v2')).toMatchObject({
			dueOn: '2026-12-10',
			dependencies: [{ title: 'Schema', done: true }],
		});
		expect(remoteSubject()).toBe('Move Ship billing v2 4242+kit@users.noreply.github.com');
		expect(synced).toEqual([
			{
				repositoryFullName: REPOSITORY,
				changes: [
					{ actor: 'robin', kind: 'renamed', title: 'Ship billing v2' },
					{ actor: 'robin', kind: 'closed', title: 'Schema' },
					{ actor: 'robin', kind: 'added', title: 'Docs' },
				],
			},
		]);
		expect([...(await call.state()).people].sort()).toEqual([VIEWER, 'robin']);

		await call.rename(billing.id, 'Ship billing v3');
		await call.sync();
		expect(fileOutcome(remotePlan(), 'Ship billing v3').id).toBe(billing.id);
		expect(synced).toHaveLength(1);
	});

	it('drops what a teammate removed, and removes there what you removed here', async () => {
		const billing = await sharedPlan();
		const polish = outcome(await call.create('Polish'), 'Polish');
		await call.sync();
		await offlineWhile(() => context.commands.call('initiatives.delete', { id: polish.id }));
		teammateEdits((plan) => {
			fileOutcome(plan, 'Ship billing').dependencies = [];
		});

		const plan = await call.sync();
		expect(plan.map(({ title }) => title)).toEqual(['Ship billing']);
		expect(outcome(plan, 'Ship billing').dependencies).toEqual([]);
		expect(remotePlan().outcomes.map(({ id, dependencies }) => [id, dependencies])).toEqual([
			[billing.id, []],
		]);
		expect(synced.flatMap(({ changes }) => changes)).toEqual([
			{ actor: 'robin', kind: 'removed', title: 'Schema' },
		]);
	});

	it('keeps the other files of the plan repository, and writes back a plan file it cannot read', async () => {
		const billing = await sharedPlan();
		teammatePush({ 'README.md': '# Our plan\n', 'plan.json': '{ not json' });

		const plan = await call.sync();
		expect(plan.map(({ id }) => id)).toEqual([billing.id]);
		expect(remoteFile('README.md')).toBe('# Our plan');
		expect(remotePlan().outcomes.map(({ title }) => title)).toEqual(['Ship billing']);
	});

	it('tries again when a teammate pushes at the same moment', async () => {
		const billing = await sharedPlan();
		let raced = false;
		const restore = installGitRunnerForTests((args, env, previous) => {
			if (!raced && args.includes('push')) {
				raced = true;
				teammateEdits((plan) => {
					plan.outcomes.push({
						id: 'race-1',
						title: 'Race',
						dueOn: null,
						note: null,
						createdAt: '2026-11-23T09:00:00.000Z',
						dependencies: [],
					});
				});
			}
			return previous(args, env);
		});
		try {
			context.db.exec(
				`UPDATE initiatives SET title = 'Ship billing now' WHERE id = '${billing.id}'`,
			);
			const plan = await call.sync();
			expect(raced).toBe(true);
			expect(plan.map(({ title }) => title).sort()).toEqual(['Race', 'Ship billing now']);
			expect(remotePlan().outcomes.map(({ title }) => title)).toEqual(['Ship billing now', 'Race']);
			expect(await call.state()).toMatchObject({ error: null });
		} finally {
			restore();
		}
	});

	it('stops sharing once the plan repository turns public, and refuses to share there again', async () => {
		const billing = await sharedPlan();
		const plan = github.repositories.get(PLAN_REPOSITORY);
		if (plan) plan.private = false;
		await call.rename(billing.id, 'Leaked');
		await call.sync();
		expect(await call.state()).toMatchObject({ enabled: false });
		expect(remotePlan().outcomes.map(({ title }) => title)).toEqual(['Ship billing']);

		await expect(
			context.commands.invoke({
				command: 'initiatives.set-sync',
				args: { repositoryFullName: REPOSITORY, enabled: true },
			}),
		).resolves.toMatchObject({ ok: false, error: expect.stringContaining('is public') });

		if (plan) plan.private = true;
		await call.turn(true);
		await call.sync();
		github.repositories.delete(PLAN_REPOSITORY);
		await call.sync();
		expect(await call.state()).toMatchObject({ enabled: false });
	});

	it('asks the owner of a personal repository to make its plan repository', async () => {
		github.add('casey/kite', {
			organization: false,
			admin: false,
			people: new Map([['casey', 'admin']]),
		});
		await call.create('Fly', null, 'casey/kite');
		await expect(
			context.commands.invoke({
				command: 'initiatives.set-sync',
				args: { repositoryFullName: 'casey/kite', enabled: true },
			}),
		).resolves.toMatchObject({
			ok: false,
			error:
				'Only casey can make the private casey/kite-malini-plan. Ask them to make it and add you, then try again',
		});

		github.add('casey/kite-malini-plan', { organization: false, admin: false });
		await call.turn(true, 'casey/kite');
		await call.sync('casey/kite');
		expect(remotePlan('casey/kite-malini-plan').outcomes.map(({ title }) => title)).toEqual([
			'Fly',
		]);
		expect(github.calls.filter((args) => args.includes('PUT'))).toEqual([]);

		github.add(`${VIEWER}/notes`, { organization: false });
		await call.create('Write', null, `${VIEWER}/notes`);
		await call.turn(true, `${VIEWER}/notes`);
		await call.sync(`${VIEWER}/notes`);
		expect(github.repositories.get(`${VIEWER}/notes-malini-plan`)).toMatchObject({
			private: true,
			organization: false,
		});
	});

	it('shares one run between calls made at once', async () => {
		await sharedPlan();
		github.calls.length = 0;
		await Promise.all([call.sync(), call.sync(), call.sync()]);
		expect(github.calls.filter(([, path]) => path === `repos/${PLAN_REPOSITORY}`)).toHaveLength(1);
	});

	it('closes the step whose workstream merged, once', async () => {
		const billing = await sharedPlan();
		const step = billing.dependencies[0];
		context.db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at)
			VALUES ('p', 'p', '/tmp/p', 'main', '2026-11-22T00:00:00Z');
			INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at)
			VALUES ('ws-schema', 'p', 'Schema', '/tmp/w', 'malini/w', 'main', 'active', '2026-11-22T00:00:00Z');
		`);
		await context.commands.call('initiatives.link-workstream', {
			dependencyId: step?.id ?? '',
			workstreamId: 'ws-schema',
		});
		recordMergedPullRequest(context.db, 'ws-schema', { number: 12, url: null });
		await call.sync();
		expect(fileOutcome(remotePlan(), 'Ship billing').dependencies[0]?.done).toBe(true);

		teammateEdits((plan) => {
			const [schema] = fileOutcome(plan, 'Ship billing').dependencies;
			if (schema) schema.done = false;
		});
		expect(outcome(await call.sync(), 'Ship billing').dependencies[0]?.done).toBe(false);
		expect(outcome(await call.sync(), 'Ship billing').dependencies[0]?.done).toBe(false);

		const webhooks = await call.addStep(billing.id, 'Webhooks');
		await context.commands.call('initiatives.link-workstream', {
			dependencyId: webhooks.id,
			workstreamId: 'ws-hooks',
		});
		await call.sync();
		context.events.emit('pull-requests:ship-changed', {
			workstreamId: 'ws-hooks',
			state: null,
			merged: { pullRequestNumber: 13, pullRequestUrl: null },
		});
		await vi.waitFor(() =>
			expect(
				fileOutcome(remotePlan(), 'Ship billing').dependencies.find(
					({ title }) => title === 'Webhooks',
				)?.done,
			).toBe(true),
		);
	});

	it('keeps the plan when GitHub is unreachable and pushes what waited once it is back', async () => {
		const billing = await sharedPlan();
		github.setOffline(true);
		await call.rename(billing.id, 'Offline rename');
		const plan = await call.sync();
		expect(outcome(plan, 'Offline rename').id).toBe(billing.id);
		expect((await call.state()).error).toMatch(/.+/u);

		github.setOffline(false);
		await call.sync();
		expect(remotePlan().outcomes.map(({ title }) => title)).toEqual(['Offline rename']);
		expect(await call.state()).toMatchObject({ error: null });
	});
});
