import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Initiative, PlanSyncedEvent } from '$contract/initiatives';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import type { GhResult } from '$main/process/gh';
import { recordMergedPullRequest } from '$shared/repositories/repositories.platform';
import { registerInitiatives } from './register';

const REPOSITORY = 'bestboyhq/gardener';

type Login = { login: string };
type Milestone = {
	number: number;
	title: string;
	description: string | null;
	due_on: string | null;
	state: 'open' | 'closed';
	creator: Login;
};
type Issue = {
	number: number;
	title: string;
	body: string | null;
	state: 'open' | 'closed';
	milestone: { number: number } | null;
	user: Login;
	assignees: Login[];
	closed_by?: Login;
	pull_request?: Record<string, never>;
};

function pacificDay(instant: string): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(
		new Date(instant),
	);
}

function fakeGithub(viewer: string) {
	const milestones: Milestone[] = [];
	const issues: Issue[] = [];
	const events = new Map<number, { event: string; actor: Login }[]>();
	const calls: string[][] = [];
	const numbers = { milestone: 0, issue: 0 };
	let offline = false;
	let isPrivate = true;
	const answer = (value: unknown): GhResult => ({
		stdout: typeof value === 'string' ? value : JSON.stringify(value),
		stderr: '',
		code: 0,
	});
	const notFound: GhResult = { stdout: '', stderr: 'gh: Not Found (HTTP 404)', code: 1 };
	const run = async (args: readonly string[]): Promise<GhResult> => {
		calls.push([...args]);
		if (offline) return { stdout: '', stderr: 'error connecting to api.github.com', code: 1 };
		const [, path = ''] = args;
		if (path === 'user') return answer(`${viewer}\n`);
		const method = args[args.indexOf('-X') + 1] ?? 'GET';
		const fields: Record<string, string | number | null> = {};
		args.forEach((arg, index) => {
			const flag = args[index - 1];
			if (flag !== '-f' && flag !== '-F') return;
			const [key = '', value = ''] = [
				arg.slice(0, arg.indexOf('=')),
				arg.slice(arg.indexOf('=') + 1),
			];
			fields[key] = flag === '-f' ? value : value === 'null' ? null : Number(value);
		});
		const url = new URL(path, 'https://api.github.com/');
		const [, , , , collection, number, sub] = url.pathname.split('/');
		if (collection === undefined && !args.includes('-X')) return answer({ private: isPrivate });
		if (url.searchParams.get('page') !== null && url.searchParams.get('page') !== '1') {
			return answer([]);
		}
		if (collection === 'milestones' && !args.includes('-X')) return answer(milestones);
		if (collection === 'issues' && !args.includes('-X') && sub === 'events') {
			return answer(events.get(Number(number)) ?? []);
		}
		if (collection === 'issues' && !args.includes('-X')) {
			return answer(issues.filter((issue) => issue.milestone !== null));
		}
		if (collection === 'milestones' && method === 'POST') {
			if (milestones.some(({ title }) => title === fields['title'])) {
				return { stdout: '', stderr: 'gh: Validation Failed (HTTP 422)', code: 1 };
			}
			numbers.milestone += 1;
			const milestone: Milestone = {
				number: numbers.milestone,
				title: String(fields['title']),
				description: String(fields['description'] ?? ''),
				due_on: null,
				state: 'open',
				creator: { login: viewer },
			};
			milestones.push(milestone);
			Object.assign(milestone, dueOn(fields));
			return answer(milestone);
		}
		if (collection === 'issues' && method === 'POST') {
			numbers.issue += 1;
			const issue: Issue = {
				number: numbers.issue,
				title: String(fields['title']),
				body: String(fields['body'] ?? ''),
				state: 'open',
				milestone: { number: Number(fields['milestone']) },
				user: { login: viewer },
				assignees: [],
			};
			issues.push(issue);
			return answer(issue);
		}
		if (collection === 'milestones') {
			const index = milestones.findIndex((milestone) => milestone.number === Number(number));
			if (index === -1) return notFound;
			if (method === 'DELETE') {
				milestones.splice(index, 1);
				return answer('');
			}
			Object.assign(milestones[index] ?? {}, fields, dueOn(fields));
			return answer(milestones[index]);
		}
		const issue = issues.find((candidate) => candidate.number === Number(number));
		if (!issue) return notFound;
		Object.assign(issue, fields);
		return answer(issue);
	};
	const dueOn = (fields: Record<string, string | number | null>) => {
		if (!('due_on' in fields)) return {};
		const due = fields['due_on'];
		return { due_on: typeof due === 'string' ? `${pacificDay(due)}T08:00:00Z` : null };
	};
	return {
		run,
		calls,
		makePublic: () => {
			isPrivate = false;
		},
		milestones,
		issues,
		events,
		writes: () => calls.filter((args) => args.includes('-X')),
		reads: (collection: string) =>
			calls.filter((args) => !args.includes('-X') && (args[1] ?? '').includes(`/${collection}?`)),
		setOffline: (next: boolean) => {
			offline = next;
		},
		addMilestone: (milestone: Omit<Milestone, 'number'>): Milestone => {
			numbers.milestone += 1;
			const added = { number: numbers.milestone, ...milestone };
			milestones.push(added);
			return added;
		},
		addIssue: (issue: Omit<Issue, 'number'>): Issue => {
			numbers.issue += 1;
			const added = { number: numbers.issue, ...issue };
			issues.push(added);
			return added;
		},
	};
}

let context: MainContext;
let github: ReturnType<typeof fakeGithub>;
let synced: PlanSyncedEvent[];

beforeEach(() => {
	context = {
		db: openMigratedDatabase(':memory:'),
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/malini',
		checkoutsRoot: '/tmp/malini',
		resourcesRoot: '/tmp/malini',
		isDev: false,
		appVersion: '0.0.0',
	};
	github = fakeGithub('simon');
	synced = [];
	context.events.subscribe('initiatives:synced', (event) => synced.push(event));
	registerInitiatives(context, { gh: github.run });
});

afterEach(() => context.db.close());

const call = {
	sync: () => context.commands.call('initiatives.sync', { repositoryFullName: REPOSITORY }),
	state: () => context.commands.call('initiatives.sync-state', { repositoryFullName: REPOSITORY }),
	turn: (enabled: boolean) =>
		context.commands.call('initiatives.set-sync', { repositoryFullName: REPOSITORY, enabled }),
	create: (title: string, dueOn: string | null = null) =>
		context.commands.call('initiatives.create', { repositoryFullName: REPOSITORY, title, dueOn }),
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

async function syncedPlan(): Promise<{ plan: Initiative[]; billing: Initiative }> {
	const [created] = await call.create('Ship billing', '2026-12-01');
	await call.addStep(created?.id ?? '', 'Schema');
	await call.turn(true);
	const plan = await call.sync();
	return { plan, billing: outcome(plan, 'Ship billing') };
}

describe('plan sync with GitHub', () => {
	it('stays off until turned on, and stops again once turned off', async () => {
		const [created] = await call.create('Ship billing', '2026-12-01');
		await context.commands.call('initiatives.update', { id: created?.id ?? '', title: 'Ship it' });
		await call.sync();
		expect(github.calls).toEqual([]);
		expect(await call.state()).toEqual({
			repositoryFullName: REPOSITORY,
			enabled: false,
			private: true,
			syncedAt: null,
			error: null,
			people: [],
		});

		await call.turn(true);
		await call.sync();
		expect(github.milestones.map(({ title }) => title)).toEqual(['Ship it']);
		expect(await call.turn(false)).toMatchObject({ enabled: false });
		github.calls.length = 0;
		await call.create('Later');
		await context.commands.call('initiatives.update', { id: created?.id ?? '', title: 'Renamed' });
		await call.sync();
		expect(github.calls).toEqual([]);
		await expect(
			context.commands.invoke({
				command: 'initiatives.set-sync',
				args: { repositoryFullName: 'not a repository', enabled: true },
			}),
		).resolves.toMatchObject({ ok: false, error: expect.stringContaining('GitHub owner/name') });
	});

	it('refuses to turn on sync for a public repository and writes nothing there', async () => {
		await call.create('Launch day', '2026-12-01');
		github.makePublic();
		expect(await call.state()).toMatchObject({ enabled: false, private: false });
		await expect(
			context.commands.invoke({
				command: 'initiatives.set-sync',
				args: { repositoryFullName: REPOSITORY, enabled: true },
			}),
		).resolves.toMatchObject({ ok: false, error: expect.stringContaining('is public') });
		expect(github.writes()).toEqual([]);
		expect(github.milestones).toEqual([]);
	});

	it('stops syncing once a private repository turns public, and writes nothing after', async () => {
		const [launch] = await call.create('Launch day', '2026-12-01');
		await call.turn(true);
		await call.sync();
		expect(github.milestones.map(({ title }) => title)).toEqual(['Launch day']);

		github.makePublic();
		github.calls.length = 0;
		await context.commands.call('initiatives.update', { id: launch?.id ?? '', title: 'Secret' });
		await call.create('Another secret');
		await call.sync();
		expect(github.writes()).toEqual([]);
		expect(github.milestones.map(({ title }) => title)).toEqual(['Launch day']);
		expect(await call.state()).toMatchObject({ enabled: false, private: false });
	});

	it('syncs both ways at first, links by title and imports only open milestones', async () => {
		const aleksander = { login: 'aleksander' };
		const launch = github.addMilestone({
			title: 'Launch',
			description: 'Steam page live\r\n\r\nPress kit',
			due_on: '2026-12-10T08:00:00Z',
			state: 'open',
			creator: aleksander,
		});
		github.addMilestone({
			title: 'Old jam',
			description: null,
			due_on: null,
			state: 'closed',
			creator: aleksander,
		});
		github.addIssue({
			title: 'Trailer',
			body: 'Cut the gameplay trailer',
			state: 'open',
			milestone: { number: launch.number },
			user: aleksander,
			assignees: [aleksander],
		});
		github.addIssue({
			title: 'Bump engine',
			body: null,
			state: 'open',
			milestone: { number: launch.number },
			user: aleksander,
			assignees: [],
			pull_request: {},
		});
		await call.create('Launch');
		const created = outcome(await call.create('Ship billing', '2026-12-01'), 'Ship billing');
		const schema = await call.addStep(created.id, 'Schema');
		await context.commands.call('initiatives.update-dependency', { id: schema.id, done: true });

		expect(await call.turn(true)).toMatchObject({ enabled: true });
		const plan = await call.sync();

		expect(plan.map(({ title }) => title).sort()).toEqual(['Launch', 'Ship billing']);
		const launched = outcome(plan, 'Launch');
		expect(launched).toMatchObject({ githubMilestone: launch.number, dueOn: '2026-12-10' });
		expect(launched.note).toBe(
			JSON.stringify({
				type: 'doc',
				content: [
					{ type: 'paragraph', content: [{ type: 'text', text: 'Steam page live' }] },
					{ type: 'paragraph' },
					{ type: 'paragraph', content: [{ type: 'text', text: 'Press kit' }] },
				],
			}),
		);
		expect(launched.dependencies).toEqual([
			expect.objectContaining({ title: 'Trailer', done: false, assignee: 'aleksander' }),
		]);
		const billing = outcome(plan, 'Ship billing');
		expect(github.milestones.map(({ title }) => title)).toEqual([
			'Launch',
			'Old jam',
			'Ship billing',
		]);
		expect(github.milestones[2]).toMatchObject({
			number: billing.githubMilestone,
			due_on: '2026-12-01T08:00:00Z',
		});
		expect(github.issues.find(({ title }) => title === 'Schema')).toMatchObject({
			number: billing.dependencies[0]?.githubIssue,
			state: 'closed',
			milestone: { number: billing.githubMilestone },
		});
		expect(synced).toEqual([]);
		expect(await call.state()).toMatchObject({
			enabled: true,
			syncedAt: expect.any(String),
			error: null,
			people: ['aleksander'],
		});

		const writes = github.writes().length;
		await call.sync();
		await call.sync();
		expect(github.writes()).toHaveLength(writes);
	});

	it('shares one run between calls made at once', async () => {
		await call.turn(true);
		await call.sync();
		github.calls.length = 0;
		await Promise.all([call.sync(), call.sync(), call.sync()]);
		expect(github.reads('milestones')).toHaveLength(1);
	});

	it('pulls a close and a reopen by someone else and never pushes them back', async () => {
		const { billing } = await syncedPlan();
		const issue = github.issues.find(({ title }) => title === 'Schema');
		if (!issue) throw new Error('no Schema issue');
		const writes = github.writes().length;

		issue.state = 'closed';
		issue.closed_by = { login: 'aleksander' };
		const closed = await call.sync();
		expect(outcome(closed, 'Ship billing').dependencies[0]?.done).toBe(true);
		expect(synced).toEqual([
			{
				repositoryFullName: REPOSITORY,
				changes: [{ actor: 'aleksander', kind: 'closed', title: 'Schema' }],
			},
		]);

		issue.state = 'open';
		github.events.set(issue.number, [
			{ event: 'closed', actor: { login: 'aleksander' } },
			{ event: 'reopened', actor: { login: 'maja' } },
		]);
		const reopened = await call.sync();
		expect(outcome(reopened, 'Ship billing').dependencies[0]?.done).toBe(false);
		expect(synced[1]?.changes).toEqual([{ actor: 'maja', kind: 'reopened', title: 'Schema' }]);
		expect(github.writes()).toHaveLength(writes);
		expect(billing.dependencies[0]?.githubIssue).toBe(issue.number);
	});

	it('pushes only the field you changed, and keeps quiet about your own GitHub edits', async () => {
		const { billing } = await syncedPlan();
		const writes = github.writes().length;
		await context.commands.call('initiatives.update', { id: billing.id, title: 'Ship billing v2' });
		await vi.waitFor(() => expect(github.milestones[0]?.title).toBe('Ship billing v2'));
		expect(github.writes().slice(writes)).toEqual([
			[
				'api',
				`repos/${REPOSITORY}/milestones/${billing.githubMilestone}`,
				'-X',
				'PATCH',
				'-f',
				'title=Ship billing v2',
			],
		]);

		const milestone = github.milestones[0];
		if (!milestone) throw new Error('no milestone');
		milestone.title = 'Ship billing v3';
		const renamed = await call.sync();
		expect(outcome(renamed, 'Ship billing v3').id).toBe(billing.id);
		expect(synced).toEqual([
			{
				repositoryFullName: REPOSITORY,
				changes: [{ actor: null, kind: 'renamed', title: 'Ship billing v3' }],
			},
		]);

		const issue = github.issues[0];
		if (!issue) throw new Error('no issue');
		issue.state = 'closed';
		issue.closed_by = { login: 'simon' };
		await call.sync();
		expect(synced).toHaveLength(1);
	});

	it('keeps the day you picked through GitHub due dates both ways', async () => {
		const { billing } = await syncedPlan();
		expect(github.milestones[0]?.due_on).toBe('2026-12-01T08:00:00Z');
		const writes = github.writes().length;
		expect(outcome(await call.sync(), 'Ship billing').dueOn).toBe('2026-12-01');
		expect(github.writes()).toHaveLength(writes);

		await context.commands.call('initiatives.update', { id: billing.id, dueOn: '2027-01-15' });
		await vi.waitFor(() => expect(github.milestones[0]?.due_on).toBe('2027-01-15T08:00:00Z'));
		await context.commands.call('initiatives.update', { id: billing.id, dueOn: null });
		await vi.waitFor(() => expect(github.milestones[0]?.due_on).toBeNull());
		expect(github.writes().at(-1)).toContain('due_on=null');

		const milestone = github.milestones[0];
		if (!milestone) throw new Error('no milestone');
		milestone.due_on = '2026-12-24T08:00:00Z';
		expect(outcome(await call.sync(), 'Ship billing').dueOn).toBe('2026-12-24');
		expect(synced.at(-1)?.changes).toEqual([{ actor: null, kind: 'dated', title: 'Ship billing' }]);
	});

	it('drops what was deleted on GitHub, and deletes there what you delete here', async () => {
		const { billing } = await syncedPlan();
		await call.addStep(outcome(await call.create('Launch'), 'Launch').id, 'Trailer');
		await call.sync();
		const writes = github.writes().length;

		github.issues.splice(
			github.issues.findIndex(({ title }) => title === 'Schema'),
			1,
		);
		github.milestones.splice(
			github.milestones.findIndex(({ title }) => title === 'Launch'),
			1,
		);
		const left = await call.sync();
		expect(left.map(({ title }) => title)).toEqual(['Ship billing']);
		expect(left[0]?.dependencies).toEqual([]);
		expect(synced.at(-1)?.changes).toEqual([
			{ actor: null, kind: 'removed', title: 'Launch' },
			{ actor: null, kind: 'removed', title: 'Schema' },
		]);
		expect(github.writes()).toHaveLength(writes);

		const checkout = await call.addStep(billing.id, 'Checkout');
		await call.sync();
		await context.commands.call('initiatives.delete-dependency', { id: checkout.id });
		await vi.waitFor(() =>
			expect(github.issues.find(({ title }) => title === 'Checkout')?.state).toBe('closed'),
		);
		await context.commands.call('initiatives.delete', { id: billing.id });
		await vi.waitFor(() => expect(github.milestones).toEqual([]));
		expect(await call.sync()).toEqual([]);
	});

	it('closes the issue of a step whose workstream merged, once', async () => {
		const { billing } = await syncedPlan();
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
		const issue = github.issues[0];
		if (!issue) throw new Error('no issue');
		issue.state = 'open';
		await call.sync();
		expect(outcome(await call.sync(), 'Ship billing').dependencies[0]?.done).toBe(false);

		recordMergedPullRequest(context.db, 'ws-schema', { number: 12, url: null });
		const merged = await call.sync();
		expect(outcome(merged, 'Ship billing').dependencies[0]?.done).toBe(true);
		expect(issue.state).toBe('closed');

		issue.state = 'open';
		expect(outcome(await call.sync(), 'Ship billing').dependencies[0]?.done).toBe(false);
		expect(issue.state).toBe('open');

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
			expect(github.issues.find(({ title }) => title === 'Webhooks')?.state).toBe('closed'),
		);
	});

	it('keeps the plan when GitHub is unreachable and pushes what waited once it is back', async () => {
		const { billing } = await syncedPlan();
		github.setOffline(true);
		await context.commands.call('initiatives.update', { id: billing.id, title: 'Offline rename' });
		const plan = await call.sync();
		expect(outcome(plan, 'Offline rename').githubMilestone).toBe(billing.githubMilestone);
		expect((await call.state()).error).toMatch(/.+/u);

		github.setOffline(false);
		await call.sync();
		expect(github.milestones[0]?.title).toBe('Offline rename');
		expect(await call.state()).toMatchObject({ error: null });
		expect(github.milestones).toHaveLength(1);
	});

	it('pushes the rest when GitHub refuses one outcome, and says why', async () => {
		await call.create('Polish');
		await call.create('Polish');
		await call.create('Ship billing');
		await call.turn(true);
		await call.sync();
		expect(github.milestones.map(({ title }) => title)).toEqual(['Polish', 'Ship billing']);
		expect((await call.state()).error).toContain('Validation Failed');
	});
});
