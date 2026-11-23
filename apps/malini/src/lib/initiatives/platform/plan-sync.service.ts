import type { PlanRemoteChange } from '$contract/initiatives';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { describeError, GhError } from '$main/errors';
import { parseGhJson, type GhResult } from '$main/process/gh';
import {
	mergedPullRequestOf,
	type RepositoriesPlatform,
} from '$shared/repositories/repositories.platform';
import {
	accessChanges,
	collaboratorAccess,
	invitations,
	isGithubRepository,
	loginOfEmail,
	planRepositoryOf,
} from './github-plan';
import { InitiativeError } from './initiatives.repository';
import {
	commitMessage,
	mergePlan,
	parsePlanFile,
	planChanges,
	planFileText,
	type SharedPlan,
} from './plan-file';
import {
	commitOf,
	commitPlan,
	fetchPlan,
	openPlanClone,
	planAuthors,
	planTextAt,
	pushPlan,
	type CommitIdentity,
	type PlanClone,
} from './plan-git';
import {
	applyPlan,
	closeOnMerge,
	isPlanSyncEnabled,
	localPlan,
	openMergeLinks,
	planSync,
	recordPlanBase,
	recordPlanSynced,
	recordPlanSyncError,
	setPlanSyncEnabled,
	syncedCommit,
} from './plan-sync.repository';

export type PlanSyncDeps = Readonly<{
	gh: RepositoriesPlatform['gh'];
	log?: (line: string) => void;
	now?: () => number;
}>;

type RunKind = 'sync' | 'push';

type Lane = { running: Promise<void> | null; kind: RunKind | null; queued: Queued | null };

type Queued = { kind: RunKind; done: Promise<void> };

type Field = string | number | boolean | null;

type GithubRepository = Readonly<{ private: boolean; organization: boolean; admin: boolean }>;

type Viewer = Readonly<{ login: string; identity: CommitIdentity }>;

const GH_TIMEOUT_MS = 15_000;

const PAGE_SIZE = 100;

const PUSH_ROUNDS = 3;

const ACCESS_EVERY_MS = 10 * 60_000;

const GONE = /HTTP 404|HTTP 410/u;

const TAKEN = /HTTP 422/u;

export class PlanSyncService {
	readonly #context: MainContext;
	readonly #deps: PlanSyncDeps;
	readonly #lanes = new Map<string, Lane>();
	readonly #homes = new Map<string, string | null>();
	readonly #accessCheckedAt = new Map<string, number>();
	#viewer: Viewer | null = null;

	constructor(context: MainContext, deps: PlanSyncDeps) {
		this.#context = context;
		this.#deps = deps;
	}

	knownHome(repositoryFullName: string): string | null | undefined {
		return this.#homes.get(repositoryFullName.toLowerCase());
	}

	async homeOf(repositoryFullName: string): Promise<string | null> {
		const home =
			(await this.#repository(repositoryFullName)) === null
				? null
				: planRepositoryOf(repositoryFullName);
		this.#homes.set(repositoryFullName.toLowerCase(), home);
		return home;
	}

	async turnOn(repositoryFullName: string): Promise<void> {
		const source = await this.#repository(repositoryFullName);
		if (source === null) {
			throw new InitiativeError(
				'not-on-github',
				`${repositoryFullName} is not on GitHub, or this gh account cannot see it`,
			);
		}
		const home = planRepositoryOf(repositoryFullName);
		const plan = (await this.#repository(home)) ?? (await this.#createPlanRepository(home, source));
		if (!plan.private) {
			throw new InitiativeError(
				'public-repository',
				`${home} is public, and a plan goes only to a private repository`,
			);
		}
		if (plan.admin) await this.#keepAccess(repositoryFullName, home, plan, true);
		this.#homes.set(repositoryFullName.toLowerCase(), home);
		setPlanSyncEnabled(this.#context.db, repositoryFullName, true, home);
		void this.sync(repositoryFullName);
	}

	sync(repositoryFullName: string): Promise<void> {
		return this.#request(repositoryFullName, 'sync');
	}

	pushSoon(repositoryFullName: string): void {
		if (isPlanSyncEnabled(this.#context.db, repositoryFullName)) {
			void this.#request(repositoryFullName, 'push');
		}
	}

	mergedWorkstream(workstreamId: string): void {
		const { db } = this.#context;
		const repositories = new Set<string>();
		for (const link of openMergeLinks(db, { workstreamId })) {
			if (!isPlanSyncEnabled(db, link.repository_full_name)) continue;
			closeOnMerge(db, link);
			repositories.add(link.repository_full_name);
		}
		for (const repository of repositories) void this.#request(repository, 'push');
	}

	#request(repositoryFullName: string, kind: RunKind): Promise<void> {
		const key = repositoryFullName.toLowerCase();
		const lane = this.#lanes.get(key) ?? { running: null, kind: null, queued: null };
		this.#lanes.set(key, lane);
		if (lane.queued !== null) {
			if (kind === 'sync') lane.queued.kind = 'sync';
			return lane.queued.done;
		}
		if (lane.running === null) return this.#start(lane, repositoryFullName, kind);
		if (kind === 'sync' && lane.kind === 'sync') return lane.running;
		const previous = lane.running;
		const queued: Queued = { kind, done: Promise.resolve() };
		queued.done = (async () => {
			await previous;
			lane.queued = null;
			await this.#start(lane, repositoryFullName, queued.kind);
		})();
		lane.queued = queued;
		return queued.done;
	}

	#start(lane: Lane, repositoryFullName: string, kind: RunKind): Promise<void> {
		const running: Promise<void> = this.#once(repositoryFullName)
			.catch((error: unknown) => {
				this.#deps.log?.(`initiatives: sync of ${repositoryFullName}: ${describeError(error)}`);
			})
			.finally(() => {
				if (lane.running !== running) return;
				lane.running = null;
				lane.kind = null;
			});
		lane.running = running;
		lane.kind = kind;
		return running;
	}

	async #once(repositoryFullName: string): Promise<void> {
		const { db } = this.#context;
		if (!isGithubRepository(repositoryFullName) || !isPlanSyncEnabled(db, repositoryFullName)) {
			return;
		}
		const home = planSync(db, repositoryFullName).home ?? planRepositoryOf(repositoryFullName);
		try {
			const plan = await this.#repository(home);
			if (plan?.private !== true) {
				this.#homes.delete(repositoryFullName.toLowerCase());
				setPlanSyncEnabled(db, repositoryFullName, false);
				return;
			}
			if (plan.admin) await this.#keepAccess(repositoryFullName, home, plan, false);
			const clone = await openPlanClone(this.#context.appDataRoot, home);
			const head = await this.#exchange(repositoryFullName, clone);
			const people =
				head === null
					? []
					: (await planAuthors(clone, null, head)).flatMap((email) => loginOfEmail(email) ?? []);
			recordPlanSynced(db, repositoryFullName, [...new Set(people)]);
		} catch (error) {
			recordPlanSyncError(db, repositoryFullName, describeError(error));
		}
	}

	async #exchange(repository: string, clone: PlanClone): Promise<string | null> {
		const { db } = this.#context;
		for (let round = 0; round < PUSH_ROUNDS; round += 1) {
			const remoteCommit = await fetchPlan(clone);
			this.#closeMerged(repository);
			const known = syncedCommit(db, repository);
			const baseCommit = known !== null && (await commitOf(clone, known)) !== null ? known : null;
			const base = baseCommit === null ? null : await this.#planAt(clone, baseCommit);
			const remoteText = await planTextAt(clone, remoteCommit);
			const readable = remoteText === null ? null : parsePlanFile(remoteText);
			const remote = readable ?? base ?? [];
			const merged = db.transaction(() => {
				const plan = mergePlan(base, remote, localPlan(db, repository));
				applyPlan(db, repository, plan);
				recordPlanBase(db, repository, remoteCommit);
				return plan;
			});
			if (base !== null && remoteCommit !== baseCommit) {
				await this.#announce(repository, clone, base, remote, baseCommit, remoteCommit);
			}
			const text = planFileText(merged);
			if (readable !== null && text === planFileText(readable)) return remoteCommit;
			const identity = (await this.#viewerOf())?.identity ?? null;
			const message = commitMessage(planChanges(remote, merged));
			const commit = await commitPlan(clone, remoteCommit, text, message, identity);
			if (await pushPlan(clone, commit)) {
				recordPlanBase(db, repository, commit);
				return commit;
			}
		}
		throw new InitiativeError(
			'plan-race',
			'the plan kept changing on GitHub while Malini pushed it',
		);
	}

	async #planAt(clone: PlanClone, commit: string): Promise<SharedPlan | null> {
		const text = await planTextAt(clone, commit);
		return text === null ? [] : parsePlanFile(text);
	}

	async #announce(
		repository: string,
		clone: PlanClone,
		base: SharedPlan,
		remote: SharedPlan,
		baseCommit: string | null,
		remoteCommit: string | null,
	): Promise<void> {
		const found = planChanges(base, remote).flatMap(({ kind, title }) =>
			kind === 'noted' ? [] : [{ kind, title }],
		);
		if (found.length === 0 || remoteCommit === null) return;
		const authors = new Set(
			(await planAuthors(clone, baseCommit, remoteCommit)).map(
				(email) => loginOfEmail(email) ?? email,
			),
		);
		const [only] = authors;
		const actor = authors.size === 1 && only !== undefined && !only.includes('@') ? only : null;
		const viewer = (await this.#viewerOf())?.login ?? null;
		if (actor !== null && viewer !== null && actor.toLowerCase() === viewer.toLowerCase()) return;
		const changes: PlanRemoteChange[] = found.map((change) => ({ actor, ...change }));
		this.#context.events.emit('initiatives:synced', { repositoryFullName: repository, changes });
	}

	#closeMerged(repository: string): void {
		const { db } = this.#context;
		for (const link of openMergeLinks(db, { repositoryFullName: repository })) {
			if (mergedPullRequestOf(db, link.workstream_id) !== null) closeOnMerge(db, link);
		}
	}

	async #createPlanRepository(home: string, source: GithubRepository): Promise<GithubRepository> {
		const [owner = '', name = ''] = home.split('/');
		const viewer = (await this.#viewerOf())?.login;
		const path = source.organization
			? `orgs/${owner}/repos`
			: owner.toLowerCase() === viewer?.toLowerCase()
				? 'user/repos'
				: null;
		if (path === null) {
			throw new InitiativeError(
				'no-plan-repository',
				`Only ${owner} can make the private ${home}. Ask them to make it and add you, then try again`,
			);
		}
		const fields = { name, private: true, has_issues: false, has_wiki: false, has_projects: false };
		const result = await this.#gh(['api', path, '-X', 'POST', ...fieldArgs(fields)]);
		if (result.code !== 0 && TAKEN.test(result.stderr)) {
			throw new InitiativeError(
				'no-plan-repository',
				`${home} already exists, and this gh account cannot see it. Ask its owner to add you, then try again`,
			);
		}
		if (result.code !== 0) throw GhError.fromStderr(result.stderr, result.code, ['api', path]);
		return { private: true, organization: source.organization, admin: true };
	}

	async #keepAccess(
		source: string,
		home: string,
		plan: GithubRepository,
		now: boolean,
	): Promise<void> {
		const key = home.toLowerCase();
		const at = this.#deps.now?.() ?? Date.now();
		const last = this.#accessCheckedAt.get(key);
		if (!now && last !== undefined && at - last < ACCESS_EVERY_MS) return;
		this.#accessCheckedAt.set(key, at);
		try {
			const [people, granted, direct, pending, viewer] = await Promise.all([
				this.#list(`repos/${source}/collaborators?per_page=${PAGE_SIZE}`),
				this.#list(`repos/${home}/collaborators?per_page=${PAGE_SIZE}`),
				this.#list(`repos/${home}/collaborators?affiliation=direct&per_page=${PAGE_SIZE}`),
				this.#list(`repos/${home}/invitations?per_page=${PAGE_SIZE}`),
				this.#viewerOf(),
			]);
			const changes = accessChanges({
				source: collaboratorAccess(people),
				granted: collaboratorAccess(granted),
				direct: collaboratorAccess(direct),
				pending: invitations(pending),
				keep: [home.split('/')[0] ?? '', ...(viewer === null ? [] : [viewer.login])],
			});
			const write = (path: string, method: 'PUT' | 'DELETE', fields: Record<string, Field>) =>
				this.#write(path, method, fields).catch((error: unknown) => {
					this.#deps.log?.(`initiatives: ${method} ${path}: ${describeError(error)}`);
				});
			for (const { login, access } of changes.grant) {
				const fields = plan.organization ? { permission: access } : {};
				await write(`repos/${home}/collaborators/${login}`, 'PUT', fields);
			}
			for (const login of changes.remove) {
				await write(`repos/${home}/collaborators/${login}`, 'DELETE', {});
			}
			for (const id of changes.cancel) {
				await write(`repos/${home}/invitations/${id}`, 'DELETE', {});
			}
		} catch (error) {
			this.#deps.log?.(`initiatives: keep the people of ${home} in step: ${describeError(error)}`);
		}
	}

	async #viewerOf(): Promise<Viewer | null> {
		if (this.#viewer !== null) return this.#viewer;
		const result = await this.#gh(['api', 'user', '--jq', '[.id, .login, .name // ""] | @tsv']);
		const [id = '', login = '', name = ''] =
			result.code === 0 ? result.stdout.trim().split('\t') : [];
		if (!/^\d+$/u.test(id) || !/^[A-Za-z0-9-]{1,39}$/u.test(login)) return null;
		this.#viewer = {
			login,
			identity: {
				name: name.replace(/[<>]/gu, '').trim() || login,
				email: `${id}+${login}@users.noreply.github.com`,
			},
		};
		return this.#viewer;
	}

	async #repository(name: string): Promise<GithubRepository | null> {
		const args = ['api', `repos/${name}`];
		const result = await this.#gh(args);
		if (result.code !== 0 && GONE.test(result.stderr)) return null;
		if (result.code !== 0) throw GhError.fromStderr(result.stderr, result.code, args);
		const repository = parseGhJson<unknown>(result, 'read the repository on GitHub');
		const owner = isRecord(repository) ? repository['owner'] : undefined;
		const permissions = isRecord(repository) ? repository['permissions'] : undefined;
		return {
			private: isRecord(repository) && repository['private'] === true,
			organization: isRecord(owner) && owner['type'] === 'Organization',
			admin: isRecord(permissions) && permissions['admin'] === true,
		};
	}

	async #list(path: string): Promise<unknown[]> {
		const items: unknown[] = [];
		for (let page = 1; ; page += 1) {
			const args = ['api', `${path}&page=${page}`];
			const result = await this.#gh(args);
			if (result.code !== 0) throw GhError.fromStderr(result.stderr, result.code, args);
			const parsed = parseGhJson<unknown>(result, 'read the people on GitHub');
			if (!Array.isArray(parsed)) {
				throw new GhError(
					'failed',
					'read the people on GitHub: gh returned a body that is not a list',
				);
			}
			items.push(...parsed);
			if (parsed.length < PAGE_SIZE) return items;
		}
	}

	async #write(
		path: string,
		method: 'PUT' | 'DELETE',
		fields: Readonly<Record<string, Field>>,
	): Promise<void> {
		const args = ['api', path, '-X', method, ...fieldArgs(fields)];
		const result = await this.#gh(args);
		if (result.code !== 0) throw GhError.fromStderr(result.stderr, result.code, args);
	}

	#gh(args: readonly string[]): Promise<GhResult> {
		return this.#deps.gh(args, { timeoutMs: GH_TIMEOUT_MS });
	}
}

function fieldArgs(fields: Readonly<Record<string, Field>>): string[] {
	return Object.entries(fields).flatMap(([key, value]) =>
		typeof value === 'string' ? ['-f', `${key}=${value}`] : ['-F', `${key}=${String(value)}`],
	);
}
