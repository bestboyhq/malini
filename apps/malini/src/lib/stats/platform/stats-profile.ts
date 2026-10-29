import { createHash, randomBytes } from 'node:crypto';
import type {
	ProfileState,
	PublishedStats,
	PublishStatsResult,
	StatsPart,
	StatsUpload,
} from '$contract/stats';
import { localDate, shiftDate } from '../domain/activity';
import type { StatsCatalog } from '../domain/catalog-names';
import { handleProblem, normalizedHandle } from '../domain/handle';
import { sharedStats } from '../domain/published-stats';
import { BestboyError, type Bestboy } from './bestboy';
import {
	settled,
	SIGNED_OUT,
	type ProfileStore,
	type SavedCatalog,
	type SavedProfile,
} from './profile-store';

export interface StatsProfileDeps {
	readonly bestboy: Bestboy;
	readonly store: ProfileStore;
	openExternal(url: string): Promise<void>;
	readStats(
		picked: readonly string[],
		catalog: StatsCatalog | null,
	): Promise<PublishedStats | null>;
	githubLogin(): Promise<string | null>;
	changed(state: ProfileState): void;
	readonly now?: () => Date;
}

const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const CHECK_EVERY_MS = 15 * 60_000;
const PICKS_SETTLE_MS = 3_000;
const FIRST_RETRY_MS = 60_000;
const LAST_RETRY_MS = 60 * 60_000;
const ACCOUNT_FRESH_MS = 60_000;
const MAX_PICKS = 10;
const REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/u;

type PendingSignIn = Readonly<{ verifier: string; state: string; timer: NodeJS.Timeout }>;

export class StatsProfile {
	readonly #deps: StatsProfileDeps;
	#saved: SavedProfile;
	#upload: StatsUpload;
	#pending: PendingSignIn | null = null;
	#signInProblem: string | null = null;
	#login: string | null = null;
	#accountCheckedAt = 0;
	#queue: Promise<unknown> = Promise.resolve();
	#retryMs = FIRST_RETRY_MS;
	#retry: NodeJS.Timeout | null = null;
	#picksSettle: NodeJS.Timeout | null = null;
	#check: NodeJS.Timeout | null = null;
	#catalog: SavedCatalog | null | undefined;
	#catalogTriedOn: string | null = null;

	constructor(deps: StatsProfileDeps) {
		this.#deps = deps;
		this.#saved = deps.store.load();
		const { publishing, publishedThrough } = this.#saved;
		this.#upload =
			publishing === 'on' && publishedThrough !== null
				? { state: 'published', through: publishedThrough }
				: { state: 'idle' };
	}

	start(): void {
		this.#check = setInterval(() => this.#keepUp(false), CHECK_EVERY_MS);
		this.#keepUp(false);
	}

	stop(): void {
		if (this.#check) clearInterval(this.#check);
		for (const timer of [this.#retry, this.#picksSettle, this.#pending?.timer]) {
			if (timer) clearTimeout(timer);
		}
		this.#check = null;
		this.#retry = null;
		this.#picksSettle = null;
		this.#pending = null;
	}

	state(): ProfileState {
		const { token, account, profile, publishing, picked, sharedParts } = this.#saved;
		return {
			account: token ? account : null,
			profile,
			signingIn: this.#pending !== null,
			signInNeeded: publishing !== 'off' && !token,
			signInProblem: this.#signInProblem,
			publishing,
			upload: this.#upload,
			pickedRepositories: picked,
			sharedParts,
			suggestedHandle: profile?.handle ?? this.#login?.toLowerCase() ?? null,
		};
	}

	profile(): ProfileState {
		void this.#refresh();
		return this.state();
	}

	signIn(): ProfileState {
		this.#clearPending();
		if (!this.#deps.store.canSeal()) {
			this.#signInProblem =
				'Malini cannot keep a Bestboy sign-in safe on this Mac: its keychain is not available.';
			return this.#emit();
		}
		const verifier = randomBytes(32).toString('base64url');
		const challenge = createHash('sha256').update(verifier).digest('base64url');
		const state = randomBytes(16).toString('base64url');
		const timer = setTimeout(() => {
			if (this.#pending?.state !== state) return;
			this.#pending = null;
			this.#emit();
		}, SIGN_IN_TIMEOUT_MS);
		this.#pending = { verifier, state, timer };
		this.#signInProblem = null;
		void this.#openSignIn(this.#deps.bestboy.loginUrl(challenge, state), state);
		return this.#emit();
	}

	cancelSignIn(): ProfileState {
		this.#clearPending();
		return this.#emit();
	}

	async completeSignIn(url: string): Promise<void> {
		const callback = authCallback(url);
		const pending = this.#pending;
		if (!callback || !pending || callback.state !== pending.state) return;
		this.#clearPending();
		try {
			const token = await this.#deps.bestboy.token(callback.code, pending.verifier);
			const me = await this.#deps.bestboy.me(token);
			this.#accountCheckedAt = Date.now();
			await this.#save({ ...this.#saved, token, account: me.account, profile: me.profile });
		} catch (error) {
			this.#signInProblem = `Malini could not sign you in: ${described(error)}`;
			this.#emit();
			return;
		}
		this.#emit();
		this.#keepUp(true);
	}

	publish(text: string): Promise<PublishStatsResult> {
		return this.#serial(async () => {
			const handle = normalizedHandle(text);
			const { token } = this.#saved;
			if (!token) return { state: this.state(), problem: 'Sign in to Bestboy first.' };
			const problem = handleProblem(handle);
			if (problem) return { state: this.state(), problem };
			try {
				const profile = await this.#deps.bestboy.putProfile(token, { handle, public: true });
				await this.#save({ ...this.#saved, profile, publishing: 'on', publishedThrough: null });
			} catch (error) {
				if (error instanceof BestboyError && error.signedOut) await this.#forgetToken();
				return { state: this.#emit(), problem: described(error) };
			}
			this.#upload = { state: 'sending' };
			void this.#serial(() => this.#sendStats(true));
			return { state: this.#emit(), problem: null };
		});
	}

	async unpublish(): Promise<ProfileState> {
		if (this.#picksSettle) clearTimeout(this.#picksSettle);
		this.#picksSettle = null;
		if (this.#saved.publishing === 'off') return this.state();
		await this.#save({ ...this.#saved, publishing: 'removing' });
		this.#emit();
		await this.#serial(() => this.#removeStats());
		return this.state();
	}

	async signOut(): Promise<ProfileState> {
		if (!this.#saved.token) return this.state();
		if ((await this.unpublish()).publishing !== 'off') return this.state();
		return this.#serial(async () => {
			const { token } = this.#saved;
			await settled(this.#deps.bestboy.logout(token));
			await this.#save(SIGNED_OUT);
			this.#upload = { state: 'idle' };
			return this.#emit();
		});
	}

	async pick(names: readonly unknown[]): Promise<ProfileState> {
		await this.#save({ ...this.#saved, picked: pickedRepositories(names) });
		this.#resendSoon();
		return this.#emit();
	}

	async share(part: StatsPart, on: boolean): Promise<ProfileState> {
		await this.#save({ ...this.#saved, sharedParts: { ...this.#saved.sharedParts, [part]: on } });
		this.#resendSoon();
		return this.#emit();
	}

	#resendSoon(): void {
		if (this.#saved.publishing !== 'on') return;
		if (this.#picksSettle) clearTimeout(this.#picksSettle);
		this.#picksSettle = setTimeout(() => {
			this.#picksSettle = null;
			void this.#serial(() => this.#sendStats(true));
		}, PICKS_SETTLE_MS);
	}

	#keepUp(force: boolean): void {
		void this.#serial(async () => {
			if (this.#saved.publishing === 'on') await this.#sendStats(force);
			if (this.#saved.publishing === 'removing') await this.#removeStats();
		});
	}

	async #sendStats(force: boolean): Promise<void> {
		const { token, publishing, publishedThrough, picked, sharedParts } = this.#saved;
		if (publishing !== 'on' || !token) return;
		const through = shiftDate(localDate(this.#now()), -1);
		if (!force && publishedThrough !== null && publishedThrough >= through) return;
		this.#setUpload({ state: 'sending' });
		try {
			const stats = await this.#deps.readStats(picked, await this.#freshCatalog());
			if (stats === null) {
				this.#setUpload({ state: 'no-full-day' });
				return;
			}
			await this.#deps.bestboy.putStats(token, sharedStats(stats, sharedParts));
			this.#retryMs = FIRST_RETRY_MS;
			await this.#save({ ...this.#saved, publishedThrough: stats.through });
			this.#setUpload({ state: 'published', through: stats.through });
		} catch (error) {
			await this.#failed(error, () => this.#sendStats(true));
		}
	}

	async #freshCatalog(): Promise<StatsCatalog | null> {
		if (this.#catalog === undefined) this.#catalog = await this.#deps.store.loadCatalog();
		const today = localDate(this.#now());
		if (this.#catalog?.fetchedOn !== today && this.#catalogTriedOn !== today) {
			this.#catalogTriedOn = today;
			try {
				this.#catalog = { fetchedOn: today, catalog: await this.#deps.bestboy.catalog() };
				await this.#deps.store.saveCatalog(this.#catalog);
			} catch {
				return this.#catalog?.catalog ?? null;
			}
		}
		return this.#catalog?.catalog ?? null;
	}

	async #removeStats(): Promise<void> {
		const { token, publishing } = this.#saved;
		if (publishing !== 'removing' || !token) return;
		this.#setUpload({ state: 'sending' });
		try {
			await this.#deps.bestboy.deleteStats(token);
			const profile = await this.#deps.bestboy.putProfile(token, { public: false });
			this.#retryMs = FIRST_RETRY_MS;
			await this.#save({ ...this.#saved, profile, publishing: 'off', publishedThrough: null });
			this.#setUpload({ state: 'idle' });
		} catch (error) {
			await this.#failed(error, () => this.#removeStats());
		}
	}

	async #failed(error: unknown, again: () => Promise<void>): Promise<void> {
		if (error instanceof BestboyError && error.signedOut) {
			await this.#forgetToken();
			this.#setUpload({ state: 'failed', reason: described(error), retrying: false });
			return;
		}
		const retrying = !(error instanceof BestboyError) || error.transient;
		this.#setUpload({ state: 'failed', reason: described(error), retrying });
		if (!retrying) return;
		if (this.#retry) clearTimeout(this.#retry);
		this.#retry = setTimeout(() => {
			this.#retry = null;
			void this.#serial(again);
		}, this.#retryMs);
		this.#retryMs = Math.min(this.#retryMs * 2, LAST_RETRY_MS);
	}

	async #refresh(): Promise<void> {
		this.#login ??= await this.#deps.githubLogin();
		const { token } = this.#saved;
		if (token && Date.now() - this.#accountCheckedAt > ACCOUNT_FRESH_MS) {
			this.#accountCheckedAt = Date.now();
			try {
				const me = await this.#deps.bestboy.me(token);
				await this.#save({ ...this.#saved, account: me.account, profile: me.profile });
			} catch (error) {
				if (error instanceof BestboyError && error.signedOut) await this.#forgetToken();
			}
		}
		this.#emit();
	}

	async #openSignIn(url: string, state: string): Promise<void> {
		try {
			await this.#deps.openExternal(url);
		} catch (error) {
			if (this.#pending?.state !== state) return;
			this.#clearPending();
			this.#signInProblem = `Malini could not open your browser: ${described(error)}`;
			this.#emit();
		}
	}

	async #forgetToken(): Promise<void> {
		await this.#save({ ...this.#saved, token: '', account: null });
	}

	#clearPending(): void {
		if (this.#pending) clearTimeout(this.#pending.timer);
		this.#pending = null;
	}

	#serial<T>(work: () => Promise<T>): Promise<T> {
		const previous = this.#queue;
		const next = (async () => {
			await settled(previous);
			return work();
		})();
		this.#queue = next;
		return next;
	}

	async #save(next: SavedProfile): Promise<void> {
		this.#saved = next;
		await this.#deps.store.save(next);
	}

	#setUpload(upload: StatsUpload): void {
		this.#upload = upload;
		this.#emit();
	}

	#emit(): ProfileState {
		const state = this.state();
		this.#deps.changed(state);
		return state;
	}

	#now(): Date {
		return this.#deps.now?.() ?? new Date();
	}
}

function authCallback(url: string): Readonly<{ code: string; state: string }> | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'malini:' || parsed.hostname !== 'auth') return null;
	const code = parsed.searchParams.get('code');
	const state = parsed.searchParams.get('state');
	return code && state ? { code, state } : null;
}

function pickedRepositories(names: readonly unknown[]): string[] {
	const picked = new Map<string, string>();
	for (const name of names) {
		if (typeof name !== 'string' || !REPOSITORY_NAME.test(name)) {
			throw new Error('invalid args: `repositories` must hold GitHub repository names');
		}
		picked.set(name.toLowerCase(), name);
	}
	if (picked.size > MAX_PICKS) {
		throw new Error(`invalid args: pick at most ${MAX_PICKS} repositories`);
	}
	return [...picked.values()];
}

function described(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
