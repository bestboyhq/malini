import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeAccountSwitchOutcome, ClaudeSignInOutcome } from '$contract/agent';
import { isRecord } from '$main/db/rows';
import { atomicReplaceFile } from '$main/fs/atomic';
import { MAX_REMEMBERED_CLAUDE_ACCOUNTS } from '$shared/providers/domain/claude-accounts';
import {
	claudeLoginFrom,
	claudeLoginStorage,
	readClaudeLogin,
	refreshTokenEnvironment,
	signedInClaudeEmail,
	type ClaudeLogin,
} from './claude-logins';
import { ClaudeSignIn, type ClaudeSignInDeps } from './claude-sign-in.service';

const SAVED_LOGINS_FILE = 'saved-logins';

export interface SecretCipher {
	isEncryptionAvailable(): boolean;
	encryptString(plainText: string): Buffer;
	decryptString(encrypted: Buffer): string;
}

export interface ClaudeAccountsDeps extends ClaudeSignInDeps {
	readonly directory: string;
	readonly security: () => string | null;
	readonly cipher: () => Promise<SecretCipher>;
}

interface SavedLogin {
	readonly email: string;
	readonly login: ClaudeLogin;
}

export class ClaudeAccounts {
	readonly #deps: ClaudeAccountsDeps;
	readonly #signIn: ClaudeSignIn;
	#queue: Promise<unknown> = Promise.resolve();
	#signIns = 0;
	#cancelledSignIns = 0;

	constructor(deps: ClaudeAccountsDeps) {
		this.#deps = deps;
		this.#signIn = new ClaudeSignIn(deps);
	}

	signIn(email: string | null): Promise<ClaudeSignInOutcome> {
		const signIn = ++this.#signIns;
		return this.#serialized(async () => {
			const outgoing = await this.#signedIn();
			if (this.#cancelledSignIns >= signIn) return 'cancelled';
			const outcome = await this.#signIn.run(email);
			// ponytail: a refresh of the outgoing login while the browser is open spends the copy saved here; that account then signs in through the browser once more
			if (outcome === 'signed-in') await this.#park(outgoing, await this.#signedInEmail());
			return outcome;
		});
	}

	cancelSignIn(): void {
		this.#cancelledSignIns = this.#signIns;
		this.#signIn.cancel();
	}

	switchTo(email: string): Promise<ClaudeAccountSwitchOutcome> {
		return this.#serialized(async () => {
			const saved = (await this.#savedLogins()).find((entry) => entry.email === email);
			if (!saved) return 'sign-in-needed';
			const outgoing = await this.#signedIn();
			const environment = refreshTokenEnvironment(this.#deps.environment(), saved.login);
			const outcome = await this.#signIn.run(null, environment).catch(() => null);
			const switched = outcome === 'signed-in';
			await this.#park(switched ? outgoing : null, email);
			return switched ? 'switched' : 'sign-in-needed';
		});
	}

	async #signedIn(): Promise<SavedLogin | null> {
		const email = await this.#signedInEmail();
		if (!email) return null;
		const storage = claudeLoginStorage(this.#deps.environment());
		const login = await readClaudeLogin(storage, this.#deps.security());
		return login ? { email, login } : null;
	}

	#signedInEmail(): Promise<string | null> {
		const executable = this.#deps.executable();
		if (!executable) return Promise.resolve(null);
		return signedInClaudeEmail(executable, this.#deps.environment());
	}

	async #park(outgoing: SavedLogin | null, incoming: string | null): Promise<void> {
		const saved = await this.#savedLogins();
		const others = saved.filter(
			(entry) => entry.email !== incoming && entry.email !== outgoing?.email,
		);
		const parked = outgoing && outgoing.email !== incoming ? [outgoing] : [];
		if (parked.length === 0 && others.length === saved.length) return;
		await this.#save([...parked, ...others].slice(0, MAX_REMEMBERED_CLAUDE_ACCOUNTS));
	}

	async #savedLogins(): Promise<SavedLogin[]> {
		const sealed = await readFile(join(this.#deps.directory, SAVED_LOGINS_FILE), 'utf8').catch(
			() => null,
		);
		if (sealed === null) return [];
		const cipher = await this.#deps.cipher();
		try {
			return parseSavedLogins(cipher.decryptString(Buffer.from(sealed, 'base64')));
		} catch {
			return [];
		}
	}

	async #save(logins: readonly SavedLogin[]): Promise<void> {
		const cipher = await this.#deps.cipher();
		if (!cipher.isEncryptionAvailable()) return;
		const sealed = cipher.encryptString(JSON.stringify(logins)).toString('base64');
		await mkdir(this.#deps.directory, { recursive: true, mode: 0o700 });
		await atomicReplaceFile(join(this.#deps.directory, SAVED_LOGINS_FILE), sealed, {
			defaultMode: 0o600,
		});
	}

	#serialized<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.#queue;
		const result = (async () => {
			await previous;
			return operation();
		})();
		this.#queue = result.catch(() => undefined);
		return result;
	}
}

function parseSavedLogins(text: string): SavedLogin[] {
	const parsed: unknown = JSON.parse(text);
	if (!Array.isArray(parsed)) return [];
	return parsed.flatMap((entry: unknown) => {
		if (!isRecord(entry) || !isRecord(entry['login'])) return [];
		const email = entry['email'];
		const login = claudeLoginFrom(entry['login']);
		return typeof email === 'string' && login ? [{ email, login }] : [];
	});
}
