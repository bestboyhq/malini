import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrainCapture, BrainDocument, BrainEntry, BrainStatus } from '$contract/brain';
import { isBrainAutomationBuiltin, type AutomationRunRecord } from '$contract/automations';
import { AUTOMATIONS_RUN_FINISHED_CHANNEL, BRAIN_CHANGED_CHANNEL } from '$contract/events';
import { isNetworkFailure } from '$contract/github-failure';
import type { MainContext } from '$main/context';
import { nowIso8601 } from '$main/db/rows';
import { describeError, failureOutput } from '$main/errors';
import { commitPaths, pushHeadToGithubMain } from '$main/git/remote';
import { automationDefinition, automationDefinitions } from '$lib/automations/automations.platform';
import {
	clonePlannedRepository,
	createPlannedWorkstream,
	getWorkstream,
	githubFullNameFromRemote,
	planRepositoryWorkstream,
	resolveConnectedRepository,
	type CheckoutResolver,
	type RepositoriesPlatform,
} from '$shared/repositories/repositories.platform';
import { captureTypedChats } from './brain-capture.service';
import { listBrainEntries, readBrainDocument } from './brain-documents';
import { commitsAhead, pushToFolderOrigin, restoreLog, startFolderBrain } from './brain-git';
import { brainSetting, latestEventSeq, saveBrainSetting } from './brain-store.repository';
import { logDay } from './capture-log';

export const SET_UP_FIRST = 'Set up the brain first in Settings, Brain.';

export const MAC_ONLY_BRAIN =
	'This brain lives on this Mac only. It has no GitHub repository to sync with.';

export function publicBrain(fullName: string): string {
	return `${fullName} is public. Malini keeps a brain only in a private repository.`;
}

function missingBrain(fullName: string): string {
	return `GitHub has no ${fullName}, or this account can't see it. The brain's commits stay on this Mac.`;
}

function uncheckedBrain(fullName: string): string {
	return `Malini couldn't reach GitHub to check ${fullName}. Check your connection and try again.`;
}

const BRAIN_WORKSTREAM_NAME = 'Brain';

const BRAIN_REPOSITORY_NAME = 'brain';

const CATCH_UP_CONTEXT = 'Malini catches up once a day on the chats it has not captured yet.';

const CATCH_UP_CHECK_MS = 60 * 60 * 1_000;

const PUSH_RETRY_MS = 5 * 60 * 1_000;

type Visibility = 'private' | 'public' | 'missing' | 'unknown';

export type BrainDeps = Readonly<{
	gh: RepositoriesPlatform['gh'];
	checkouts: CheckoutResolver;
	secrets: () => readonly string[];
	log: (line: string) => void;
	home?: string;
}>;

export class Brain {
	readonly #context: MainContext;
	readonly #deps: BrainDeps;
	#chain: Promise<unknown> = Promise.resolve();
	#recreating: Promise<string | null> | null = null;
	#lastStatus = '';
	#timers: NodeJS.Timeout[] = [];
	#unsubscribe: (() => void) | null = null;

	constructor(context: MainContext, deps: BrainDeps) {
		this.#context = context;
		this.#deps = deps;
	}

	start(): void {
		if (this.#unsubscribe !== null) return;
		this.#unsubscribe = this.#context.events.subscribe(
			AUTOMATIONS_RUN_FINISHED_CHANNEL,
			({ run }: { run: AutomationRunRecord }) => {
				this.#background('land the notes', () => this.#notesFinished(run));
			},
		);
		this.#timers = [
			setInterval(() => this.#background('catch up', () => this.#catchUp()), CATCH_UP_CHECK_MS),
			setInterval(
				() => this.#background('push', () => this.#serial(() => this.#push())),
				PUSH_RETRY_MS,
			),
		];
		for (const timer of this.#timers) timer.unref();
		this.#background('catch up', () => this.#catchUp());
	}

	dispose(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		for (const timer of this.#timers.splice(0)) clearInterval(timer);
	}

	async workstream(): Promise<string | null> {
		const stored = this.#liveWorkstream();
		if (stored !== null) return stored;
		this.#recreating ??= this.#recreate().finally(() => {
			this.#recreating = null;
		});
		return this.#recreating;
	}

	async status(): Promise<BrainStatus> {
		const { db } = this.#context;
		const repositoryId = brainSetting(db, 'repository-id');
		const repository =
			repositoryId === null ? null : await resolveConnectedRepository(db, repositoryId);
		const workstreamId = this.#liveWorkstream();
		const location = workstreamId === null ? null : await this.#checkout(workstreamId);
		return {
			set: repository !== null,
			repository: repository?.remoteUrl ? githubFullNameFromRemote(repository.remoteUrl) : null,
			sync: brainSetting(db, 'sync') === 'on',
			workstreamId,
			location,
			syncedAt: brainSetting(db, 'synced-at'),
			unpushed: location === null ? 0 : await commitsAhead(location).catch(() => 0),
			problem: brainSetting(db, 'problem'),
		};
	}

	setUp(sync: boolean): Promise<BrainStatus> {
		return this.#serial(async () => {
			const { db } = this.#context;
			if ((await this.workstream()) === null) {
				const login = sync ? await this.#githubLogin() : null;
				const repositoryId =
					login === null ? await this.#connectOnThisMac() : await this.#connectOnGithub(login);
				const workstreamId = await this.#startWorkstream(repositoryId);
				saveBrainSetting(db, 'repository-id', repositoryId);
				saveBrainSetting(db, 'workstream-id', workstreamId);
				saveBrainSetting(db, 'sync', login === null ? 'off' : 'on');
				saveBrainSetting(db, 'problem', null);
				if (brainSetting(db, 'since-seq') === null) {
					saveBrainSetting(db, 'since-seq', String(latestEventSeq(db)));
				}
			}
			await this.#arm();
			return this.#changed();
		});
	}

	setSync(sync: boolean): Promise<BrainStatus> {
		return this.#serial(async () => {
			const { db } = this.#context;
			const fullName = await this.#githubName();
			if (fullName === undefined) throw new Error(SET_UP_FIRST);
			if (sync && fullName === null) throw new Error(MAC_ONLY_BRAIN);
			saveBrainSetting(db, 'sync', sync ? 'on' : 'off');
			if (!sync) saveBrainSetting(db, 'problem', null);
			await this.#push();
			return this.#changed();
		});
	}

	async list(): Promise<BrainEntry[]> {
		const workstreamId = this.#liveWorkstream();
		const checkout = workstreamId === null ? null : await this.#checkout(workstreamId);
		return checkout === null ? [] : listBrainEntries(checkout);
	}

	async read(path: string): Promise<BrainDocument> {
		const workstreamId = this.#liveWorkstream();
		const checkout = workstreamId === null ? null : await this.#checkout(workstreamId);
		if (checkout === null) throw new Error(SET_UP_FIRST);
		return readBrainDocument(checkout, path);
	}

	capture(): Promise<BrainCapture> {
		return this.#serial(async () => {
			const { db } = this.#context;
			const workstreamId = await this.workstream();
			if (workstreamId === null) throw new Error(SET_UP_FIRST);
			const checkout = await this.#deps.checkouts.resolveCheckout(workstreamId);
			const captured = await captureTypedChats(db, {
				checkout,
				brainProjectId: getWorkstream(db, workstreamId)?.projectId ?? null,
				sinceSeq: Number(brainSetting(db, 'since-seq') ?? 0) || 0,
				secrets: this.#deps.secrets(),
				home: this.#deps.home ?? homedir(),
				now: new Date(),
			});
			const landed =
				captured.chats > 0 &&
				(await commitPaths(checkout, `Capture ${count(captured.chats, 'chat')}`, ['log']));
			await this.#push();
			return { chats: captured.chats, turns: captured.turns, landed };
		});
	}

	#liveWorkstream(): string | null {
		const stored = brainSetting(this.#context.db, 'workstream-id');
		if (stored === null) return null;
		const workstream = getWorkstream(this.#context.db, stored);
		return workstream !== null && workstream.status !== 'archived' ? stored : null;
	}

	async #checkout(workstreamId: string): Promise<string | null> {
		return this.#deps.checkouts.resolveCheckout(workstreamId).catch(() => null);
	}

	async #recreate(): Promise<string | null> {
		const { db } = this.#context;
		const repositoryId = brainSetting(db, 'repository-id');
		if (repositoryId === null || (await resolveConnectedRepository(db, repositoryId)) === null) {
			return null;
		}
		const workstreamId = await this.#startWorkstream(repositoryId);
		saveBrainSetting(db, 'workstream-id', workstreamId);
		await this.#changed();
		return workstreamId;
	}

	async #startWorkstream(repositoryId: string): Promise<string> {
		const { db, commands } = this.#context;
		const plan = await planRepositoryWorkstream(db, repositoryId);
		if (plan === null) throw new Error(SET_UP_FIRST);
		const named = { ...plan, name: BRAIN_WORKSTREAM_NAME };
		await createPlannedWorkstream(commands, named, await clonePlannedRepository(commands, named));
		return plan.workstreamId;
	}

	async #githubLogin(): Promise<string | null> {
		const auth = await this.#context.commands
			.call('repositories.github-auth-status', undefined)
			.catch(() => null);
		return auth?.authenticated && auth.login ? auth.login : null;
	}

	async #connectOnGithub(login: string): Promise<string> {
		const { commands } = this.#context;
		const fullName = `${login}/${BRAIN_REPOSITORY_NAME}`;
		const visibility = await this.#visibility(fullName);
		if (visibility === 'public') throw new Error(publicBrain(fullName));
		if (visibility === 'unknown') throw new Error(uncheckedBrain(fullName));
		const url =
			visibility === 'missing'
				? (
						await commands.call('repositories.create-github-repository', {
							owner: login,
							name: BRAIN_REPOSITORY_NAME,
							private: true,
						})
					).cloneUrl
				: `https://github.com/${fullName}.git`;
		const { repository } = await commands.call('repositories.connect', {
			source: { kind: 'clone-url', url },
		});
		return repository.id;
	}

	async #connectOnThisMac(): Promise<string> {
		const folder = join(this.#context.checkoutsRoot, BRAIN_REPOSITORY_NAME);
		await startFolderBrain(folder);
		const { repository } = await this.#context.commands.call('repositories.connect', {
			source: { kind: 'local-folder', path: folder },
		});
		return repository.id;
	}

	async #visibility(fullName: string): Promise<Visibility> {
		const result = await this.#deps.gh(['api', `repos/${fullName}`, '--jq', '.private']);
		if (result.code === 0) {
			const answer = result.stdout.trim();
			return answer === 'true' ? 'private' : answer === 'false' ? 'public' : 'unknown';
		}
		return /HTTP 404|Not Found/iu.test(result.stderr) ? 'missing' : 'unknown';
	}

	async #githubName(): Promise<string | null | undefined> {
		const { db } = this.#context;
		const repositoryId = brainSetting(db, 'repository-id');
		const repository =
			repositoryId === null ? null : await resolveConnectedRepository(db, repositoryId);
		if (repository === null) return undefined;
		return repository.remoteUrl === null ? null : githubFullNameFromRemote(repository.remoteUrl);
	}

	async #push(): Promise<void> {
		const { db } = this.#context;
		const workstreamId = this.#liveWorkstream();
		const checkout = workstreamId === null ? null : await this.#checkout(workstreamId);
		const fullName = await this.#githubName();
		if (checkout === null || fullName === undefined) return;
		try {
			if ((await commitsAhead(checkout)) === 0) {
				saveBrainSetting(db, 'problem', null);
				return;
			}
			if (fullName === null) {
				await this.#landed(() => pushToFolderOrigin(checkout));
				return;
			}
			if (brainSetting(db, 'sync') !== 'on') return;
			const visibility = await this.#visibility(fullName);
			if (visibility === 'public') return this.#problem(publicBrain(fullName));
			if (visibility === 'missing') return this.#problem(missingBrain(fullName));
			if (visibility === 'unknown') return;
			await this.#landed(() => pushHeadToGithubMain(checkout, fullName));
		} finally {
			await this.#changed();
		}
	}

	async #landed(push: () => Promise<void>): Promise<void> {
		const { db } = this.#context;
		try {
			await push();
		} catch (error) {
			if (isNetworkFailure(failureOutput(error))) return;
			this.#problem(describeError(error));
			return;
		}
		saveBrainSetting(db, 'synced-at', nowIso8601());
		saveBrainSetting(db, 'problem', null);
	}

	#problem(problem: string): void {
		saveBrainSetting(this.#context.db, 'problem', problem);
	}

	async #arm(): Promise<void> {
		const { db, commands } = this.#context;
		for (const definition of automationDefinitions(db)) {
			const { builtin, trigger } = definition;
			if (!isBrainAutomationBuiltin(builtin) || trigger === null || trigger.mode !== 'off')
				continue;
			await commands.call('automations.save-definition', {
				id: definition.id,
				name: definition.name,
				instructions: definition.instructions,
				provider: definition.provider,
				model: definition.model,
				effort: definition.effort,
				runsIn: definition.runsIn,
				skills: definition.skills,
				trigger: { when: trigger.when, mode: 'auto' },
			});
		}
	}

	async #catchUp(): Promise<void> {
		const { db, commands } = this.#context;
		const today = logDay(new Date());
		if (brainSetting(db, 'repository-id') === null) return;
		if (brainSetting(db, 'caught-up-on') === today) return;
		const capture = automationDefinitions(db).find(({ builtin }) => builtin === 'capture-brain');
		const mode = capture?.trigger?.mode ?? 'off';
		if (capture === undefined || mode === 'off') return;
		saveBrainSetting(db, 'caught-up-on', today);
		await commands.call('automations.run', {
			definitionId: capture.id,
			origin: 'schedule',
			context: CATCH_UP_CONTEXT,
			waitForYou: mode === 'ask',
		});
	}

	async #notesFinished(run: AutomationRunRecord): Promise<void> {
		const { workstreamId } = run;
		if (run.status !== 'succeeded' || workstreamId === null) return;
		if (workstreamId !== this.#liveWorkstream()) return;
		if (automationDefinition(this.#context.db, run.definitionId)?.builtin !== 'write-brain-notes') {
			return;
		}
		await this.#serial(async () => {
			const checkout = await this.#deps.checkouts.resolveCheckout(workstreamId);
			await restoreLog(checkout);
			await commitPaths(checkout, 'Rewrite notes', ['.']);
			await this.#push();
		});
	}

	async #changed(): Promise<BrainStatus> {
		const status = await this.status();
		const serialized = JSON.stringify(status);
		if (serialized !== this.#lastStatus) {
			this.#lastStatus = serialized;
			this.#context.events.emit(BRAIN_CHANGED_CHANNEL, { status });
		}
		return status;
	}

	#serial<T>(work: () => Promise<T>): Promise<T> {
		const next = afterSettled(this.#chain, work);
		this.#chain = next.catch(() => undefined);
		return next;
	}

	#background(what: string, work: () => Promise<unknown>): void {
		void work().catch((error: unknown) => {
			this.#deps.log(`brain: could not ${what}: ${describeError(error)}`);
		});
	}
}

async function afterSettled<T>(previous: Promise<unknown>, work: () => Promise<T>): Promise<T> {
	await previous;
	return work();
}

function count(value: number, noun: string): string {
	return `${value} ${noun}${value === 1 ? '' : 's'}`;
}
