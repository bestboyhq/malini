import type { PlanRemoteChange, PlanRemoteChangeKind } from '$contract/initiatives';
import type { MainContext } from '$main/context';
import { intToBool, isRecord } from '$main/db/rows';
import { describeError, GhError, isGhError } from '$main/errors';
import { parseGhJson, type GhResult } from '$main/process/gh';
import {
	mergedPullRequestOf,
	type RepositoriesPlatform,
} from '$shared/repositories/repositories.platform';
import {
	dueInstant,
	eventActor,
	isGithubRepository,
	noteFromText,
	noteText,
	remoteIssues,
	remoteMilestones,
	type RemoteIssue,
	type RemoteMilestone,
} from './github-plan';
import {
	addGithubDeletion,
	closeOnMerge,
	dropGithubDeletion,
	forgetDependency,
	forgetInitiative,
	githubDeletions,
	insertDependencyFromGithub,
	insertInitiativeFromGithub,
	isPlanSyncEnabled,
	linkDependency,
	linkInitiative,
	openMergeLinks,
	planSync,
	recordPlanSynced,
	recordPlanSyncError,
	saveDependencySync,
	saveInitiativeSync,
	syncedDependencies,
	syncedInitiatives,
	type IssueBase,
	type MilestoneBase,
	type SyncedDependency,
	type SyncedInitiative,
} from './plan-sync.repository';

export type PlanSyncDeps = Readonly<{
	gh: RepositoriesPlatform['gh'];
	log?: (line: string) => void;
}>;

type RunKind = 'sync' | 'push';

type Lane = { running: Promise<void> | null; kind: RunKind | null; queued: Queued | null };

type Queued = { kind: RunKind; done: Promise<void> };

type FoundChange = Readonly<{
	kind: PlanRemoteChangeKind;
	title: string;
	actor: string | null;
	issue?: number;
}>;

type Field = string | number | null;

const GH_TIMEOUT_MS = 15_000;

const PAGE_SIZE = 100;

const GONE = /HTTP 404|HTTP 410/u;

export class PlanSyncService {
	readonly #context: MainContext;
	readonly #deps: PlanSyncDeps;
	readonly #lanes = new Map<string, Lane>();
	#viewer: string | null = null;

	constructor(context: MainContext, deps: PlanSyncDeps) {
		this.#context = context;
		this.#deps = deps;
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
		const running: Promise<void> = this.#once(repositoryFullName, kind)
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

	async #once(repositoryFullName: string, kind: RunKind): Promise<void> {
		const { db } = this.#context;
		if (!isGithubRepository(repositoryFullName) || !isPlanSyncEnabled(db, repositoryFullName)) {
			return;
		}
		try {
			const people = kind === 'sync' ? await this.#pull(repositoryFullName) : null;
			this.#closeMerged(repositoryFullName);
			await this.#push(repositoryFullName);
			recordPlanSynced(db, repositoryFullName, people);
		} catch (error) {
			recordPlanSyncError(db, repositoryFullName, describeError(error));
		}
	}

	async #pull(repository: string): Promise<string[]> {
		const { db } = this.#context;
		const first = planSync(db, repository).syncedAt === null;
		const [milestones, issues] = await Promise.all([
			this.#list(`repos/${repository}/milestones?state=all&per_page=${PAGE_SIZE}`),
			this.#list(`repos/${repository}/issues?milestone=*&state=all&per_page=${PAGE_SIZE}`),
		]);
		const remote = { milestones: remoteMilestones(milestones), issues: remoteIssues(issues) };
		const found = db.transaction(() => this.#apply(repository, remote.milestones, remote.issues));
		if (!first && found.length > 0) await this.#announce(repository, found);
		return [
			...new Set(
				[
					...remote.milestones.map(({ author }) => author),
					...remote.issues.flatMap(({ people }) => people),
				].filter((login) => login !== null),
			),
		];
	}

	#apply(
		repository: string,
		milestones: readonly RemoteMilestone[],
		issues: readonly RemoteIssue[],
	): FoundChange[] {
		const { db } = this.#context;
		const found: FoundChange[] = [];
		const deleted = new Set(
			githubDeletions(db, repository).map(({ kind, number }) => `${kind}:${number}`),
		);
		const initiatives = syncedInitiatives(db, repository);
		const linkedMilestones = new Map(
			initiatives.flatMap((row) =>
				row.github_milestone === null ? [] : [[row.github_milestone, row] as const],
			),
		);
		const unlinkedInitiatives = initiatives.filter((row) => row.github_milestone === null);
		const initiativeOf = new Map<number, string>();
		for (const milestone of milestones) {
			if (deleted.has(`milestone:${milestone.number}`)) continue;
			const local =
				linkedMilestones.get(milestone.number) ??
				take(unlinkedInitiatives, (row) => row.title === milestone.title);
			linkedMilestones.delete(milestone.number);
			if (local !== undefined) {
				initiativeOf.set(milestone.number, local.id);
				found.push(...this.#mergeMilestone(local, milestone));
			} else if (milestone.open) {
				const values = {
					title: milestone.title,
					dueOn: milestone.dueOn,
					note: noteFromText(milestone.note),
				};
				initiativeOf.set(
					milestone.number,
					insertInitiativeFromGithub(db, repository, values, milestone),
				);
				found.push({ kind: 'added', title: milestone.title, actor: milestone.author });
			}
		}
		for (const gone of linkedMilestones.values()) {
			forgetInitiative(db, gone.id);
			found.push({ kind: 'removed', title: gone.title, actor: null });
		}

		const dependencies = syncedDependencies(db, repository);
		const linkedIssues = new Map(
			dependencies.flatMap((row) =>
				row.github_issue === null ? [] : [[row.github_issue, row] as const],
			),
		);
		const unlinkedDependencies = dependencies.filter((row) => row.github_issue === null);
		for (const issue of issues) {
			const initiativeId = initiativeOf.get(issue.milestone);
			if (deleted.has(`issue:${issue.number}`) || initiativeId === undefined) continue;
			const local =
				linkedIssues.get(issue.number) ??
				take(
					unlinkedDependencies,
					(row) => row.initiative_id === initiativeId && row.title === issue.title,
				);
			linkedIssues.delete(issue.number);
			if (local !== undefined) {
				found.push(...this.#mergeIssue(local, issue, initiativeId));
				continue;
			}
			const values = {
				initiativeId,
				title: issue.title,
				done: issue.done,
				note: noteFromText(issue.note),
				assignee: issue.assignee,
			};
			insertDependencyFromGithub(db, values, issue);
			found.push({ kind: 'added', title: issue.title, actor: issue.author });
		}
		for (const gone of linkedIssues.values()) {
			forgetDependency(db, gone.id);
			found.push({ kind: 'removed', title: gone.title, actor: null });
		}
		return found;
	}

	#mergeMilestone(local: SyncedInitiative, remote: RemoteMilestone): FoundChange[] {
		const localText = noteText(local.note);
		const base =
			local.github_milestone === null
				? {
						title: remote.title,
						dueOn: local.due_on === null ? null : remote.dueOn,
						note: localText === '' ? '' : remote.note,
					}
				: {
						title: local.github_title ?? local.title,
						dueOn: local.github_due_on,
						note: local.github_note ?? '',
					};
		const title = remote.title === base.title ? local.title : remote.title;
		const dueOn = remote.dueOn === base.dueOn ? local.due_on : remote.dueOn;
		const note =
			remote.note === base.note || remote.note === localText
				? local.note
				: noteFromText(remote.note);
		saveInitiativeSync(this.#context.db, local.id, { title, dueOn, note }, remote);
		return [
			...(title === local.title ? [] : [{ kind: 'renamed' as const, title, actor: null }]),
			...(dueOn === local.due_on ? [] : [{ kind: 'dated' as const, title, actor: null }]),
		];
	}

	#mergeIssue(local: SyncedDependency, remote: RemoteIssue, initiativeId: string): FoundChange[] {
		const localText = noteText(local.note);
		const localDone = intToBool(local.done);
		const base =
			local.github_issue === null
				? {
						title: remote.title,
						done: localDone && remote.done,
						note: localText === '' ? '' : remote.note,
					}
				: {
						title: local.github_title ?? local.title,
						done: local.github_done === null ? localDone : intToBool(local.github_done),
						note: local.github_note ?? '',
					};
		const title = remote.title === base.title ? local.title : remote.title;
		const done = remote.done === base.done ? localDone : remote.done;
		const note =
			remote.note === base.note || remote.note === localText
				? local.note
				: noteFromText(remote.note);
		const values = { initiativeId, title, done, note, assignee: remote.assignee };
		saveDependencySync(this.#context.db, local.id, values, remote);
		const issue = remote.number;
		return [
			...(title === local.title ? [] : [{ kind: 'renamed' as const, title, actor: null, issue }]),
			...(done === localDone
				? []
				: [
						done
							? { kind: 'closed' as const, title, actor: remote.closedBy, issue }
							: { kind: 'reopened' as const, title, actor: null, issue },
					]),
		];
	}

	async #announce(repository: string, found: readonly FoundChange[]): Promise<void> {
		const viewer = await this.#viewerLogin();
		const changes: PlanRemoteChange[] = [];
		for (const change of found) {
			const actor =
				change.actor ??
				(change.issue === undefined ? null : await this.#actorOf(repository, change));
			if (actor !== null && actor === viewer) continue;
			changes.push({ actor, kind: change.kind, title: change.title });
		}
		if (changes.length === 0) return;
		this.#context.events.emit('initiatives:synced', { repositoryFullName: repository, changes });
	}

	async #actorOf(repository: string, change: FoundChange): Promise<string | null> {
		try {
			const result = await this.#call([
				'api',
				`repos/${repository}/issues/${change.issue}/events?per_page=${PAGE_SIZE}`,
			]);
			return eventActor(parseGhJson<unknown>(result, 'read who changed an issue'), change.kind);
		} catch {
			return null;
		}
	}

	async #viewerLogin(): Promise<string | null> {
		if (this.#viewer !== null) return this.#viewer;
		try {
			const login = (await this.#call(['api', 'user', '--jq', '.login'])).stdout.trim();
			this.#viewer = login.length > 0 ? login : null;
		} catch {
			this.#viewer = null;
		}
		return this.#viewer;
	}

	#closeMerged(repository: string): void {
		const { db } = this.#context;
		for (const link of openMergeLinks(db, { repositoryFullName: repository })) {
			if (mergedPullRequestOf(db, link.workstream_id) !== null) closeOnMerge(db, link);
		}
	}

	async #push(repository: string): Promise<void> {
		const { db } = this.#context;
		const refused: GhError[] = [];
		await eachRow(githubDeletions(db, repository), refused, async (deletion) => {
			if (deletion.kind === 'milestone') {
				await this.#write(`repos/${repository}/milestones/${deletion.number}`, 'DELETE', {}, true);
			} else {
				const path = `repos/${repository}/issues/${deletion.number}`;
				await this.#write(path, 'PATCH', { state: 'closed' }, true);
			}
			dropGithubDeletion(db, repository, deletion);
		});
		await eachRow(syncedInitiatives(db, repository), refused, async (row) => {
			const sent = { title: row.title, dueOn: row.due_on, note: noteText(row.note) };
			const base =
				row.github_milestone === null
					? await this.#createMilestone(repository, row.id, sent)
					: {
							number: row.github_milestone,
							title: row.github_title,
							dueOn: row.github_due_on,
							note: row.github_note ?? '',
						};
			if (base === null) return;
			const change = {
				...(sent.title === base.title ? {} : { title: sent.title }),
				...(sent.dueOn === base.dueOn ? {} : { due_on: dueField(sent.dueOn) }),
				...(sent.note === base.note ? {} : { description: sent.note }),
			};
			if (Object.keys(change).length === 0) return;
			await this.#write(`repos/${repository}/milestones/${base.number}`, 'PATCH', change);
			linkInitiative(db, row.id, { number: base.number, ...sent });
		});
		const milestoneOf = new Map(
			syncedInitiatives(db, repository).map((row) => [row.id, row.github_milestone]),
		);
		await eachRow(syncedDependencies(db, repository), refused, async (row) => {
			const milestone = milestoneOf.get(row.initiative_id) ?? null;
			if (milestone === null) return;
			const sent = { title: row.title, done: intToBool(row.done), note: noteText(row.note) };
			const base =
				row.github_issue === null
					? await this.#createIssue(repository, row.id, milestone, sent)
					: {
							number: row.github_issue,
							title: row.github_title,
							done: intToBool(row.github_done),
							note: row.github_note ?? '',
						};
			if (base === null) return;
			const change = {
				...(sent.title === base.title ? {} : { title: sent.title }),
				...(sent.done === base.done ? {} : { state: sent.done ? 'closed' : 'open' }),
				...(sent.note === base.note ? {} : { body: sent.note }),
			};
			if (Object.keys(change).length === 0) return;
			await this.#write(`repos/${repository}/issues/${base.number}`, 'PATCH', change);
			linkDependency(db, row.id, { number: base.number, ...sent });
		});
		const [first] = refused;
		if (first !== undefined) throw first;
	}

	async #createMilestone(
		repository: string,
		initiativeId: string,
		sent: Omit<MilestoneBase, 'number'>,
	): Promise<MilestoneBase | null> {
		const created = await this.#write(`repos/${repository}/milestones`, 'POST', {
			title: sent.title,
			description: sent.note,
			...(sent.dueOn === null ? {} : { due_on: dueField(sent.dueOn) }),
		});
		const base = { number: createdNumber(created), ...sent };
		if (linkInitiative(this.#context.db, initiativeId, base)) return base;
		addGithubDeletion(this.#context.db, repository, 'milestone', base.number);
		return null;
	}

	async #createIssue(
		repository: string,
		dependencyId: string,
		milestone: number,
		sent: Omit<IssueBase, 'number'>,
	): Promise<IssueBase | null> {
		const created = await this.#write(`repos/${repository}/issues`, 'POST', {
			title: sent.title,
			body: sent.note,
			milestone,
		});
		const base = { number: createdNumber(created), ...sent, done: false };
		if (linkDependency(this.#context.db, dependencyId, base)) return base;
		addGithubDeletion(this.#context.db, repository, 'issue', base.number);
		return null;
	}

	async #list(path: string): Promise<unknown[]> {
		const items: unknown[] = [];
		for (let page = 1; ; page += 1) {
			const parsed = parseGhJson<unknown>(
				await this.#call(['api', `${path}&page=${page}`]),
				'read the plan on GitHub',
			);
			if (!Array.isArray(parsed)) {
				throw new GhError(
					'failed',
					'read the plan on GitHub: gh returned a body that is not a list',
				);
			}
			items.push(...parsed);
			if (parsed.length < PAGE_SIZE) return items;
		}
	}

	async #write(
		path: string,
		method: 'POST' | 'PATCH' | 'DELETE',
		fields: Readonly<Record<string, Field>>,
		goneIsDone = false,
	): Promise<GhResult> {
		const args = [
			'api',
			path,
			'-X',
			method,
			...Object.entries(fields).flatMap(([key, value]) =>
				typeof value === 'string' ? ['-f', `${key}=${value}`] : ['-F', `${key}=${String(value)}`],
			),
		];
		const result = await this.#deps.gh(args, { timeoutMs: GH_TIMEOUT_MS });
		if (result.code === 0 || (goneIsDone && GONE.test(result.stderr))) return result;
		throw GhError.fromStderr(result.stderr, result.code, args);
	}

	async #call(args: readonly string[]): Promise<GhResult> {
		const result = await this.#deps.gh(args, { timeoutMs: GH_TIMEOUT_MS });
		if (result.code !== 0) throw GhError.fromStderr(result.stderr, result.code, args);
		return result;
	}
}

async function eachRow<Row>(
	rows: readonly Row[],
	refused: GhError[],
	push: (row: Row) => Promise<void>,
): Promise<void> {
	for (const row of rows) {
		try {
			await push(row);
		} catch (error) {
			if (!isGhError(error, 'failed')) throw error;
			refused.push(error);
		}
	}
}

function take<Row>(rows: Row[], matches: (row: Row) => boolean): Row | undefined {
	const index = rows.findIndex(matches);
	return index === -1 ? undefined : rows.splice(index, 1)[0];
}

function dueField(day: string | null): string | null {
	return day === null ? null : dueInstant(day);
}

function createdNumber(result: GhResult): number {
	const created = parseGhJson<unknown>(result, 'write the plan to GitHub');
	const number = isRecord(created) ? created['number'] : undefined;
	if (typeof number !== 'number' || !Number.isInteger(number)) {
		throw new GhError('failed', 'write the plan to GitHub: gh returned no number');
	}
	return number;
}
