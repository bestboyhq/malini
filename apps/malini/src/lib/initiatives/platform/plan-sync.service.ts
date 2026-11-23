import type { PlanRemoteChange } from '$contract/initiatives';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { describeError, GhError, isGhError } from '$main/errors';
import { parseGhJson, type GhResult } from '$main/process/gh';
import {
	githubFullNameFromRemote,
	listRepositoryCatalog,
	LOCAL_REPOSITORY_ID_PREFIX,
	mergedPullRequestOf,
	type CatalogRepository,
	type RepositoriesPlatform,
} from '$shared/repositories/repositories.platform';
import {
	accessChanges,
	collaboratorAccess,
	invitations,
	invitationTo,
	isGithubLogin,
	isGithubRepository,
	loginOfEmail,
	ownerOf,
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
	askToShare,
	clearShareRequests,
	commitOf,
	commitPlan,
	fetchPlan,
	openPlanClone,
	planAuthors,
	planTextAt,
	pushPlan,
	shareRequests,
	type CommitIdentity,
	type PlanClone,
} from './plan-git';
import {
	applyPlan,
	closeOnMerge,
	forgetShareRequests,
	isPlanSyncEnabled,
	localPlan,
	openMergeLinks,
	pendingShareRequest,
	planSync,
	recordPlanBase,
	recordPlanSynced,
	recordPlanSyncError,
	recordShareRequests,
	setPlanSyncEnabled,
	setPlanSyncWaiting,
	syncedCommit,
	waitingRepositories,
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

const WATCH_EVERY_MS = 10 * 60_000;

const GONE = /HTTP 404|HTTP 410/u;

const TAKEN = /HTTP 422/u;

const NOT_ALLOWED = /HTTP 403|HTTP 404/u;

export class PlanSyncService {
	readonly #context: MainContext;
	readonly #deps: PlanSyncDeps;
	readonly #lanes = new Map<string, Lane>();
	readonly #homes = new Map<string, string | null>();
	readonly #accessCheckedAt = new Map<string, number>();
	#viewer: Viewer | null = null;
	#watching: NodeJS.Timeout | null = null;
	#finding: Promise<void> | null = null;

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
		const plan =
			(await this.#repository(home)) ??
			(await this.#join(home)) ??
			(await this.#createPlanRepository(home, source));
		if (plan === null) {
			await this.#askAdmin(repositoryFullName, home);
			return;
		}
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

	async turnOff(repositoryFullName: string): Promise<void> {
		const { db } = this.#context;
		const { waitingFor, home } = planSync(db, repositoryFullName);
		setPlanSyncEnabled(db, repositoryFullName, false);
		const viewer = waitingFor === null ? null : await this.#viewerOf();
		if (viewer === null) return;
		const clone = await openPlanClone(
			this.#context.appDataRoot,
			home ?? planRepositoryOf(repositoryFullName),
		);
		await clearShareRequests(clone, repositoryFullName, [viewer.login]).catch((error: unknown) => {
			this.#deps.log?.(
				`initiatives: take back the ask of ${repositoryFullName}: ${describeError(error)}`,
			);
		});
	}

	start(): Promise<void> {
		if (this.#watching !== null) return Promise.resolve();
		const watch = (): Promise<void> =>
			this.#watch().catch((error: unknown) => {
				this.#deps.log?.(`initiatives: watch the plans: ${describeError(error)}`);
			});
		this.#watching = setInterval(() => void watch(), WATCH_EVERY_MS);
		this.#watching.unref();
		return watch();
	}

	dispose(): void {
		if (this.#watching !== null) clearInterval(this.#watching);
		this.#watching = null;
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
		const { home: known, waitingFor } = planSync(db, repositoryFullName);
		const home = known ?? planRepositoryOf(repositoryFullName);
		try {
			const plan =
				(await this.#repository(home)) ?? (waitingFor === null ? null : await this.#join(home));
			if (plan === null && waitingFor !== null) return;
			if (plan?.private !== true) {
				this.#homes.delete(repositoryFullName.toLowerCase());
				setPlanSyncEnabled(db, repositoryFullName, false);
				return;
			}
			if (waitingFor !== null) setPlanSyncEnabled(db, repositoryFullName, true, home);
			if (plan.admin) await this.#keepAccess(repositoryFullName, home, plan, false);
			const clone = await openPlanClone(this.#context.appDataRoot, home);
			const head = await this.#exchange(repositoryFullName, clone);
			const people =
				head === null
					? []
					: (await planAuthors(clone, null, head)).flatMap((email) => loginOfEmail(email) ?? []);
			recordPlanSynced(db, repositoryFullName, [...new Set(people)]);
			if (waitingFor !== null) {
				this.#context.events.emit('initiatives:share-accepted', {
					repositoryFullName,
					owner: waitingFor,
				});
			}
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

	findRequests(): Promise<void> {
		this.#finding ??= (async () => {
			try {
				await this.#findRequests();
			} catch (error) {
				this.#deps.log?.(`initiatives: read the asks to share: ${describeError(error)}`);
			} finally {
				this.#finding = null;
			}
		})();
		return this.#finding;
	}

	async #watch(): Promise<void> {
		for (const repository of waitingRepositories(this.#context.db)) await this.sync(repository);
		await this.findRequests();
	}

	async #findRequests(): Promise<void> {
		const { db, events } = this.#context;
		const viewer = await this.#viewerOf();
		if (viewer === null) return;
		for (const { fullName } of (await listRepositoryCatalog(db)).filter(onGithub)) {
			if (isPlanSyncEnabled(db, fullName)) continue;
			try {
				const asking = (await shareRequests(fullName)).filter(
					(login) => login.toLowerCase() !== viewer.login.toLowerCase(),
				);
				const admin = asking.length > 0 && (await this.#repository(fullName))?.admin === true;
				const added = recordShareRequests(db, fullName, admin ? asking : []);
				const request = pendingShareRequest(db, fullName);
				if (added.length > 0 && request !== null)
					events.emit('initiatives:share-requested', request);
			} catch (error) {
				this.#deps.log?.(
					`initiatives: read the asks to share ${fullName}: ${describeError(error)}`,
				);
			}
		}
	}

	async #askAdmin(repositoryFullName: string, home: string): Promise<void> {
		const owner = ownerOf(repositoryFullName);
		const viewer = await this.#viewerOf();
		try {
			if (viewer === null) throw new GhError('failed', 'read your GitHub login');
			const clone = await openPlanClone(this.#context.appDataRoot, home);
			await askToShare(clone, repositoryFullName, viewer.login, viewer.identity);
		} catch (error) {
			this.#deps.log?.(
				`initiatives: ask ${owner} to share ${repositoryFullName}: ${describeError(error)}`,
			);
			throw new InitiativeError(
				'no-plan-repository',
				`Only ${owner} can make the private ${home}. Ask them to make it and add you, then try again`,
			);
		}
		setPlanSyncWaiting(this.#context.db, repositoryFullName, home, owner);
	}

	async #answerRequests(repositoryFullName: string, home: string): Promise<void> {
		try {
			const asking = await shareRequests(repositoryFullName);
			const clone = await openPlanClone(this.#context.appDataRoot, home);
			await clearShareRequests(clone, repositoryFullName, asking);
		} catch (error) {
			this.#deps.log?.(
				`initiatives: clear the asks to share ${repositoryFullName}: ${describeError(error)}`,
			);
		}
		forgetShareRequests(this.#context.db, repositoryFullName);
	}

	async #join(home: string): Promise<GithubRepository | null> {
		const id = invitationTo(
			await this.#list(`user/repository_invitations?per_page=${PAGE_SIZE}`),
			home,
		);
		if (id === null) return null;
		await this.#write(`user/repository_invitations/${id}`, 'PATCH', {});
		return this.#repository(home);
	}

	async #createPlanRepository(
		home: string,
		source: GithubRepository,
	): Promise<GithubRepository | null> {
		const [owner = '', name = ''] = home.split('/');
		const viewer = (await this.#viewerOf())?.login;
		const path = source.organization
			? `orgs/${owner}/repos`
			: owner.toLowerCase() === viewer?.toLowerCase()
				? 'user/repos'
				: null;
		if (path === null) return null;
		const fields = { name, private: true, has_issues: false, has_wiki: false, has_projects: false };
		const result = await this.#gh(['api', path, '-X', 'POST', ...fieldArgs(fields)]);
		if (result.code !== 0 && source.organization && NOT_ALLOWED.test(result.stderr)) return null;
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
			await this.#answerRequests(source, home);
		} catch (error) {
			this.#deps.log?.(`initiatives: keep the people of ${home} in step: ${describeError(error)}`);
		}
	}

	async #viewerOf(): Promise<Viewer | null> {
		if (this.#viewer !== null) return this.#viewer;
		const result = await this.#gh([
			'api',
			'user',
			'--jq',
			'[.id, .login, .name // ""] | @tsv',
		]).catch((error: unknown) => {
			if (isGhError(error, 'not-installed')) return null;
			throw error;
		});
		if (result === null) return null;
		const [id = '', login = '', name = ''] =
			result.code === 0 ? result.stdout.trim().split('\t') : [];
		if (!/^\d+$/u.test(id) || !isGithubLogin(login)) return null;
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
		method: 'PUT' | 'PATCH' | 'DELETE',
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

function onGithub(repository: CatalogRepository): boolean {
	if (repository.hidden || !isGithubRepository(repository.fullName)) return false;
	if (!repository.id.startsWith(LOCAL_REPOSITORY_ID_PREFIX)) return true;
	return repository.remoteUrl !== null && githubFullNameFromRemote(repository.remoteUrl) !== null;
}

function fieldArgs(fields: Readonly<Record<string, Field>>): string[] {
	return Object.entries(fields).flatMap(([key, value]) =>
		typeof value === 'string' ? ['-f', `${key}=${value}`] : ['-F', `${key}=${String(value)}`],
	);
}
