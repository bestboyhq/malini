import { createHash, randomBytes } from 'node:crypto';
import type {
	BestboyProfile,
	ProfileState,
	PublishedStats,
	PublishStatsResult,
	StatsUpload,
} from '$contract/stats';
import { localDate, shiftDate } from '../domain/activity';
import { handleProblem, normalizedHandle } from '../domain/handle';
import { BestboyError, type Bestboy, type BestboySession } from './bestboy';
import {
	settled,
	SIGNED_OUT,
	type PendingSignIn,
	type ProfileStore,
	type SavedProfile,
} from './profile-store';

export interface StatsProfileDeps {
	readonly bestboy: Bestboy;
	readonly store: ProfileStore;
	openExternal(url: string): Promise<void>;
	readStats(picked: readonly string[]): Promise<PublishedStats | null>;
	githubLogin(): Promise<string | null>;
	changed(state: ProfileState): void;
	published(profile: BestboyProfile): void;
	readonly now?: () => Date;
}

const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const CHECK_EVERY_MS = 15 * 60_000;
const PICKS_SETTLE_MS = 3_000;
const FIRST_RETRY_MS = 60_000;
const LAST_RETRY_MS = 60 * 60_000;
const ACCOUNT_FRESH_MS = 60_000;
const USAGE_ACCOUNT_FRESH_MS = 60 * 60_000;
const ACCOUNT_RETRY_MS = 5 * 60_000;
const MAX_PICKS = 10;
const REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/u;

export class StatsProfile {
	readonly #deps: StatsProfileDeps;
	#saved: SavedProfile;
	#upload: StatsUpload;
	#signInTimer: NodeJS.Timeout | null = null;
	#signInProblem: string | null = null;
	#login: string | null = null;
	#accountCheckedAt = 0;
	#accountFailedAt = 0;
	#accountCheck: Promise<void> | null = null;
	#queue: Promise<unknown> = Promise.resolve();
	#retryMs = FIRST_RETRY_MS;
	#retry: NodeJS.Timeout | null = null;
	#picksSettle: NodeJS.Timeout | null = null;
	#check: NodeJS.Timeout | null = null;

	constructor(deps: StatsProfileDeps) {
		this.#deps = deps;
		const saved = deps.store.load();
		const { signIn } = saved;
		this.#saved =
			signIn && signIn.until > this.#now().getTime() ? saved : { ...saved, signIn: null };
		const { publishing, publishedThrough } = this.#saved;
		this.#upload =
			publishing === 'on' && publishedThrough !== null
				? { state: 'published', through: publishedThrough }
				: { state: 'idle' };
	}

	start(): void {
		this.#check = setInterval(() => this.#keepUp(false), CHECK_EVERY_MS);
		this.#keepUp(false);
		if (this.#saved.signIn) this.#waitForSignIn(this.#saved.signIn);
	}

	stop(): void {
		if (this.#check) clearInterval(this.#check);
		for (const timer of [this.#retry, this.#picksSettle, this.#signInTimer]) {
			if (timer) clearTimeout(timer);
		}
		this.#check = null;
		this.#retry = null;
		this.#picksSettle = null;
		this.#signInTimer = null;
	}

	state(): ProfileState {
		const { token, account, profile, unacceptedTerms, publishing, picked } = this.#saved;
		return {
			account: token ? account : null,
			profile,
			unacceptedTerms:
				token && unacceptedTerms && publishing !== 'on'
					? this.#deps.bestboy.termsLinks(unacceptedTerms)
					: null,
			signingIn: this.#saved.signIn !== null,
			signInNeeded: publishing !== 'off' && !token,
			signInProblem: this.#signInProblem,
			publishing,
			upload: this.#upload,
			pickedRepositories: picked,
			suggestedHandle: profile?.handle ?? this.#login?.toLowerCase() ?? null,
		};
	}

	profile(): ProfileState {
		void this.#refresh();
		return this.state();
	}

	signIn(): ProfileState {
		if (!this.#deps.store.canSeal()) {
			void settled(this.#endSignIn());
			this.#signInProblem =
				'Malini cannot keep a Bestboy sign-in safe on this Mac: its keychain is not available.';
			return this.#emit();
		}
		const verifier = randomBytes(32).toString('base64url');
		const challenge = createHash('sha256').update(verifier).digest('base64url');
		const signIn = {
			verifier,
			state: randomBytes(16).toString('base64url'),
			until: this.#now().getTime() + SIGN_IN_TIMEOUT_MS,
		};
		const saving = this.#save({ ...this.#saved, signIn });
		this.#waitForSignIn(signIn);
		this.#signInProblem = null;
		void this.#openSignIn(this.#deps.bestboy.loginUrl(challenge, signIn.state), signIn, saving);
		return this.#emit();
	}

	async cancelSignIn(): Promise<ProfileState> {
		await this.#endSignIn();
		return this.#emit();
	}

	async usageAccount(): Promise<string | null> {
		// ponytail: a token revoked elsewhere carries the account for up to an hour; check /api/me per count.
		if (await this.#checkAccount(USAGE_ACCOUNT_FRESH_MS)) this.#emit();
		const { token, userId } = this.#saved;
		return token && userId ? userId : null;
	}

	session(): BestboySession | null {
		const { token, profile } = this.#saved;
		return token ? { token, handle: profile?.handle ?? null } : null;
	}

	claimHandle(text: string): Promise<string | null> {
		return this.#serial(async () => {
			const handle = normalizedHandle(text);
			const { token } = this.#saved;
			if (!token) return 'Sign in to Bestboy first.';
			const problem = handleProblem(handle);
			if (problem) return problem;
			try {
				const profile = await this.#deps.bestboy.putProfile(token, { handle });
				await this.#save({ ...this.#saved, profile });
				this.#emit();
				return null;
			} catch (error) {
				if (error instanceof BestboyError && error.signedOut) await this.#forgetToken();
				this.#emit();
				return described(error);
			}
		});
	}

	async forgetSignIn(): Promise<void> {
		await this.#forgetToken();
		this.#emit();
	}

	async completeSignIn(url: string): Promise<void> {
		const callback = authCallback(url);
		const pending = this.#saved.signIn;
		if (!callback || !pending || callback.state !== pending.state) return;
		void settled(this.#endSignIn());
		try {
			const token = await this.#deps.bestboy.token(callback.code, pending.verifier);
			const me = await this.#deps.bestboy.me(token);
			this.#accountCheckedAt = Date.now();
			await this.#save({ ...this.#saved, token, ...me });
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
			const terms = this.state().unacceptedTerms?.date;
			if (!token) return { state: this.state(), problem: 'Sign in to Bestboy first.' };
			const problem = handleProblem(handle);
			if (problem) return { state: this.state(), problem };
			try {
				const profile = await this.#deps.bestboy.putProfile(token, {
					handle,
					public: true,
					...(terms ? { terms } : {}),
				});
				await this.#save({ ...this.#saved, profile, publishing: 'on', publishedThrough: null });
				this.#deps.published(profile);
				if (terms) {
					this.#accountCheckedAt = 0;
					this.#accountFailedAt = 0;
					void this.#refresh();
				}
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
		const { token, publishing, publishedThrough, picked } = this.#saved;
		if (publishing !== 'on' || !token) return;
		const through = shiftDate(localDate(this.#now()), -1);
		if (!force && publishedThrough !== null && publishedThrough >= through) return;
		this.#setUpload({ state: 'sending' });
		try {
			const stats = await this.#deps.readStats(picked);
			if (stats === null) {
				this.#setUpload({ state: 'no-full-day' });
				return;
			}
			await this.#deps.bestboy.putStats(token, stats);
			this.#retryMs = FIRST_RETRY_MS;
			await this.#save({ ...this.#saved, publishedThrough: stats.through });
			this.#setUpload({ state: 'published', through: stats.through });
		} catch (error) {
			await this.#failed(error, () => this.#sendStats(true));
		}
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
		await this.#checkAccount(ACCOUNT_FRESH_MS);
		this.#emit();
	}

	async #checkAccount(freshMs: number): Promise<boolean> {
		const { token } = this.#saved;
		if (token === '' || Date.now() - this.#accountCheckedAt <= freshMs) return false;
		if (Date.now() - this.#accountFailedAt <= Math.min(freshMs, ACCOUNT_RETRY_MS)) return false;
		const check = (this.#accountCheck ??= this.#readAccount(token).finally(() => {
			if (this.#accountCheck === check) this.#accountCheck = null;
		}));
		await check;
		return true;
	}

	async #readAccount(token: string): Promise<void> {
		try {
			const me = await this.#deps.bestboy.me(token);
			if (this.#saved.token !== token) return;
			this.#accountCheckedAt = Date.now();
			await this.#save({ ...this.#saved, ...me });
		} catch (error) {
			this.#accountFailedAt = Date.now();
			if (error instanceof BestboyError && error.signedOut && this.#saved.token === token) {
				await this.#forgetToken();
			}
		}
	}

	async #openSignIn(url: string, signIn: PendingSignIn, saving: Promise<void>): Promise<void> {
		await settled(saving);
		try {
			await this.#deps.openExternal(url);
		} catch (error) {
			if (this.#saved.signIn?.state !== signIn.state) return;
			void settled(this.#endSignIn());
			this.#signInProblem = `Malini could not open your browser: ${described(error)}`;
			this.#emit();
		}
	}

	#waitForSignIn({ state, until }: PendingSignIn): void {
		if (this.#signInTimer) clearTimeout(this.#signInTimer);
		this.#signInTimer = setTimeout(() => {
			if (this.#saved.signIn?.state !== state) return;
			void settled(this.#endSignIn());
			this.#signInProblem = 'Malini stopped waiting for your Bestboy sign-in after 10 minutes.';
			this.#emit();
		}, until - this.#now().getTime());
	}

	async #forgetToken(): Promise<void> {
		await this.#save({ ...this.#saved, token: '', account: null, userId: null });
	}

	#endSignIn(): Promise<void> {
		if (this.#signInTimer) clearTimeout(this.#signInTimer);
		this.#signInTimer = null;
		return this.#saved.signIn ? this.#save({ ...this.#saved, signIn: null }) : Promise.resolve();
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
