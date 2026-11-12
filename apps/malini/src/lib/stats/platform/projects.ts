import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	BestboyProjects as ProjectsState,
	BestboyProjectState,
	SetProjectArgs,
} from '$contract/stats';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord } from '$main/db/rows';
import { atomicReplaceFile } from '$main/fs/atomic';
import { runGit } from '$main/git/run';
import { listRunFacts } from '$lib/chat/chat.platform';
import {
	getProject,
	githubFullNameFromRemote,
	isRetiredChat,
	listRepositoryCatalog,
	type CatalogRepository,
} from '$shared/repositories/repositories.platform';
import { localDate } from '../domain/activity';
import {
	changelogStart,
	linkAddress,
	MAX_PROJECTS,
	PROJECT_STATES,
	projectDays,
	projectIndexOfField,
	projectLink,
} from '../domain/projects';
import { statsCutoff } from '../domain/published-stats';
import { BestboyError, type Bestboy, type BestboySession, type ProjectUpload } from './bestboy';
import { settled } from './profile-store';
import type { RepositoryLookup } from './published-stats';

export const PROJECTS_FILE = 'bestboy-projects.json';

const SEND_SETTLE_MS = 2_000;
const CHECK_EVERY_MS = 15 * 60_000;
const FIRST_RETRY_MS = 60_000;
const LAST_RETRY_MS = 60 * 60_000;
const NOT_FOUND = 404;

export type ProjectSource = Readonly<{
	repositoryId: string;
	fullName: string;
	private: boolean;
	homepage: string | null;
	startedAt: readonly string[];
	changelog(): Promise<string | null>;
}>;

export interface BestboyProjectsDeps {
	readonly bestboy: Bestboy;
	readonly appDataRoot: string;
	session(): BestboySession | null;
	signedOut(): Promise<void>;
	sources(): Promise<readonly ProjectSource[]>;
	changed(projects: ProjectsState): void;
	readonly now?: () => Date;
}

type SavedProject = Readonly<{ link: string; on: boolean }>;

type Answer = Readonly<{ state: BestboyProjectState; url: string | null }>;

type SavedProjects = Readonly<{
	projects: Readonly<Record<string, SavedProject>>;
	answers: Readonly<Record<string, Answer>>;
	dirty: boolean;
	triedOn: string | null;
}>;

type SentProject = Readonly<{ repositoryId: string; link: string; source: ProjectSource }>;

const NOTHING_SAVED: SavedProjects = { projects: {}, answers: {}, dirty: false, triedOn: null };

export class BestboyProjects {
	readonly #deps: BestboyProjectsDeps;
	readonly #path: string;
	#saved: SavedProjects;
	#sources: readonly ProjectSource[] = [];
	#problems = new Map<string, string>();
	#problem: string | null = null;
	#signedIn: boolean | null = null;
	#edits = 0;
	#queue: Promise<unknown> = Promise.resolve();
	#setting: Promise<unknown> = Promise.resolve();
	#writes: Promise<void> = Promise.resolve();
	#retryMs = FIRST_RETRY_MS;
	#retry: NodeJS.Timeout | null = null;
	#settle: NodeJS.Timeout | null = null;
	#check: NodeJS.Timeout | null = null;

	constructor(deps: BestboyProjectsDeps) {
		this.#deps = deps;
		this.#path = join(deps.appDataRoot, PROJECTS_FILE);
		this.#saved = loadProjects(this.#path);
	}

	start(): void {
		this.#check = setInterval(() => this.keepUp(), CHECK_EVERY_MS);
		this.keepUp();
	}

	stop(): void {
		if (this.#check) clearInterval(this.#check);
		for (const timer of [this.#retry, this.#settle]) {
			if (timer) clearTimeout(timer);
		}
		this.#check = null;
		this.#retry = null;
		this.#settle = null;
	}

	async projects(): Promise<ProjectsState> {
		this.#sources = await this.#deps.sources();
		return this.#state();
	}

	set(project: SetProjectArgs): Promise<ProjectsState> {
		const previous = this.#setting;
		const next = (async () => {
			await settled(previous);
			return this.#set(project);
		})();
		this.#setting = next;
		return next;
	}

	async #set({ repositoryId, on, link: text }: SetProjectArgs): Promise<ProjectsState> {
		if (!this.#deps.session()) throw new Error('Sign in to Bestboy first.');
		this.#sources = await this.#deps.sources();
		if (!this.#sources.some((source) => source.repositoryId === repositoryId)) {
			throw new Error('invalid args: `repositoryId` names no repository Malini counts runs for');
		}
		const checked = projectLink(text);
		const link = checked.link ?? text.trim();
		const problem = on ? (checked.problem ?? this.#clash(repositoryId, link)) : null;
		if (problem !== null) {
			this.#problems.set(repositoryId, problem);
			return this.#emit();
		}
		this.#problems.delete(repositoryId);
		const before = this.#saved.projects[repositoryId];
		const changed = (before?.on ?? false) !== on || (on && before?.link !== link);
		if (changed) this.#edits += 1;
		await this.#save({
			...this.#saved,
			projects: { ...this.#saved.projects, [repositoryId]: { link, on } },
			...(changed ? { dirty: true, triedOn: null } : {}),
		});
		if (changed) this.#sendSoon();
		return this.#emit();
	}

	keepUp(): void {
		const signedIn = this.#deps.session() !== null;
		if (signedIn !== this.#signedIn) {
			this.#signedIn = signedIn;
			void settled(this.#reloaded());
		}
		void this.#serial(async () => {
			const { dirty, triedOn, projects } = this.#saved;
			if (!this.#deps.session() || this.#retry || this.#settle) return;
			if (triedOn === localDate(this.#now())) return;
			if (dirty || Object.values(projects).some((project) => project.on)) await this.#send();
		});
	}

	async #reloaded(): Promise<void> {
		this.#deps.changed(await this.projects());
	}

	#sendSoon(): void {
		if (this.#settle) clearTimeout(this.#settle);
		this.#settle = setTimeout(() => {
			this.#settle = null;
			void this.#serial(() => this.#send());
		}, SEND_SETTLE_MS);
	}

	async #send(): Promise<void> {
		const session = this.#deps.session();
		if (!session) return;
		if (this.#retry) clearTimeout(this.#retry);
		this.#retry = null;
		const edits = this.#edits;
		const now = this.#now();
		let sent: readonly SentProject[] = [];
		try {
			this.#sources = await this.#deps.sources();
			sent = this.#onProjects();
			const answers = await this.#deps.bestboy.putProjects(
				session.token,
				await Promise.all(sent.map((project) => upload(project, statsCutoff(now)))),
			);
			this.#retryMs = FIRST_RETRY_MS;
			this.#problem = null;
			for (const { repositoryId } of sent) this.#problems.delete(repositoryId);
			await this.#save({
				...this.#saved,
				answers: answersByAddress(sent, answers),
				dirty: this.#saved.dirty && this.#edits !== edits,
				triedOn: localDate(now),
			});
		} catch (error) {
			await this.#failed(error, sent, localDate(now));
		}
		this.#emit();
	}

	async #failed(error: unknown, sent: readonly SentProject[], today: string): Promise<void> {
		if (error instanceof BestboyError && error.signedOut) {
			await this.#save({ ...this.#saved, triedOn: null });
			await this.#deps.signedOut();
			return;
		}
		if (!(error instanceof BestboyError) || error.transient) {
			this.#problem = described(error);
			await this.#save({ ...this.#saved, triedOn: null });
			this.#retry = setTimeout(() => {
				this.#retry = null;
				void this.#serial(() => this.#send());
			}, this.#retryMs);
			this.#retryMs = Math.min(this.#retryMs * 2, LAST_RETRY_MS);
			return;
		}
		await this.#save({ ...this.#saved, triedOn: today });
		if (error.status === NOT_FOUND) {
			this.#problem = null;
			return;
		}
		const index = projectIndexOfField(error.field);
		const named = index === null ? undefined : sent[index];
		if (named) this.#problems.set(named.repositoryId, error.message);
		else this.#problem = error.message;
	}

	#onProjects(): SentProject[] {
		return this.#sources.flatMap((source) => {
			const saved = this.#saved.projects[source.repositoryId];
			return saved?.on ? [{ repositoryId: source.repositoryId, link: saved.link, source }] : [];
		});
	}

	#clash(repositoryId: string, link: string): string | null {
		const others = this.#onProjects().filter((project) => project.repositoryId !== repositoryId);
		const address = linkAddress(link);
		if (others.some((project) => linkAddress(project.link) === address)) {
			return 'Another project has this link';
		}
		return others.length >= MAX_PROJECTS ? `Bestboy takes ${MAX_PROJECTS} projects at most` : null;
	}

	#state(): ProjectsState {
		const { projects, answers } = this.#saved;
		return {
			signedIn: this.#deps.session() !== null,
			problem: this.#problem,
			projects: this.#sources.map((source) => {
				const saved = projects[source.repositoryId];
				const answer = saved?.on ? answers[linkAddress(saved.link)] : undefined;
				return {
					repositoryId: source.repositoryId,
					fullName: source.fullName,
					private: source.private,
					runs: source.startedAt.length,
					days: new Set(source.startedAt.map((at) => localDate(new Date(at)))).size,
					link: saved?.link ?? source.homepage ?? '',
					on: saved?.on ?? false,
					state: answer?.state ?? null,
					url: answer?.url ?? null,
					problem: this.#problems.get(source.repositoryId) ?? null,
				};
			}),
		};
	}

	#emit(): ProjectsState {
		const state = this.#state();
		this.#signedIn = state.signedIn;
		this.#deps.changed(state);
		return state;
	}

	#serial(work: () => Promise<void>): Promise<void> {
		const previous = this.#queue;
		const next = (async () => {
			await settled(previous);
			await work();
		})();
		this.#queue = next;
		return next;
	}

	#save(next: SavedProjects): Promise<void> {
		this.#saved = next;
		const text = JSON.stringify(next);
		const previous = this.#writes;
		this.#writes = (async () => {
			await settled(previous);
			await atomicReplaceFile(this.#path, text, { defaultMode: 0o600 });
		})();
		return this.#writes;
	}

	#now(): Date {
		return this.#deps.now?.() ?? new Date();
	}
}

export async function readProjectSources(
	db: MaliniDatabase,
	now: Date,
	lookup: RepositoryLookup,
): Promise<ProjectSource[]> {
	const startedAt = new Map<string, string[]>();
	for (const run of listRunFacts(db, now.toISOString())) {
		if (isRetiredChat(run)) continue;
		const starts = startedAt.get(run.projectId) ?? [];
		starts.push(run.startedAt);
		startedAt.set(run.projectId, starts);
	}
	const sources = await Promise.all(
		(await listRepositoryCatalog(db)).map(async (repository) => {
			const starts = repository.projectIds.flatMap((id) => startedAt.get(id) ?? []);
			if (starts.length === 0) return null;
			const github = repository.remoteUrl ? githubFullNameFromRemote(repository.remoteUrl) : null;
			const facts = github ? await lookup(github) : null;
			return {
				repositoryId: repository.id,
				fullName: repository.fullName,
				private: github === null || facts?.public === false,
				homepage: facts?.homepage ?? null,
				startedAt: starts,
				changelog: () => readChangelog(checkoutOf(db, repository), repository.defaultBranch),
			};
		}),
	);
	return sources
		.filter((source) => source !== null)
		.sort(
			(left, right) =>
				right.startedAt.length - left.startedAt.length ||
				left.fullName.localeCompare(right.fullName),
		);
}

async function upload(project: SentProject, cutoff: Date): Promise<ProjectUpload> {
	const changelog = await project.source.changelog();
	return {
		link: project.link,
		days: projectDays(project.source.startedAt, cutoff),
		...(changelog === null ? {} : { changelog }),
	};
}

function answersByAddress(
	sent: readonly SentProject[],
	answers: readonly Readonly<{ state: BestboyProjectState | null; url: string | null }>[],
): Record<string, Answer> {
	return Object.fromEntries(
		sent.flatMap(({ link }, index) => {
			const answer = answers[index];
			return answer?.state ? [[linkAddress(link), { state: answer.state, url: answer.url }]] : [];
		}),
	);
}

function checkoutOf(db: MaliniDatabase, repository: CatalogRepository): string | null {
	const candidates = [
		repository.localPath,
		...repository.projectIds.map((id) => getProject(db, id)?.repoPath),
	];
	return candidates.find((path): path is string => !!path && existsSync(path)) ?? null;
}

async function readChangelog(checkout: string | null, branch: string): Promise<string | null> {
	if (checkout === null) return null;
	for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
		const text = await runGit(['-C', checkout, 'show', `${ref}:CHANGELOG.md`]).catch(() => null);
		if (text !== null) return changelogStart(text);
	}
	return null;
}

function loadProjects(path: string): SavedProjects {
	let saved: unknown;
	try {
		saved = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return NOTHING_SAVED;
	}
	if (!isRecord(saved)) return NOTHING_SAVED;
	const projects = isRecord(saved['projects']) ? saved['projects'] : {};
	const answers = isRecord(saved['answers']) ? saved['answers'] : {};
	return {
		projects: Object.fromEntries(
			Object.entries(projects).flatMap(([id, value]) => {
				const link = isRecord(value) ? value['link'] : null;
				if (typeof link !== 'string') return [];
				const on = isRecord(value) && value['on'] === true && projectLink(link).link === link;
				return [[id, { link, on }]];
			}),
		),
		answers: Object.fromEntries(
			Object.entries(answers).flatMap(([address, value]) => {
				const state = isRecord(value)
					? PROJECT_STATES.find((known) => known === value['state'])
					: undefined;
				const url = isRecord(value) && typeof value['url'] === 'string' ? value['url'] : null;
				return state ? [[address, { state, url }]] : [];
			}),
		),
		dirty: saved['dirty'] === true,
		triedOn: typeof saved['triedOn'] === 'string' ? saved['triedOn'] : null,
	};
}

function described(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
