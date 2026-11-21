import type {
	CheckoutFinding,
	CheckoutHealth,
	WorkstreamCheckoutHealthPayload,
} from '$contract/repositories';
import { isGitError, isNotFoundError } from '$main/errors';
import { WorkstreamError } from './checkout-resolver';

export const FIRST_PROBE_MS = 5_000;
export const LAST_PROBE_MS = 5 * 60_000;

export const HEALTHY: CheckoutHealth = { state: 'healthy', finding: null, repairable: false };

const REPAIRABLE_FINDINGS: ReadonlySet<CheckoutFinding> = new Set([
	'folder-missing',
	'git-link-missing',
	'admin-missing',
	'stale-lock',
	'index-corrupt',
	'head-invalid',
]);

const CHECKOUT_SAID: ReadonlySet<string> = new Set([
	'not-a-work-tree',
	'index-corrupt',
	'head-invalid',
	'bad-object',
	'dubious-ownership',
	'permission-denied',
	'no-space',
	'developer-tools-missing',
	'license-not-accepted',
]);

export function isCheckoutFailure(error: unknown): boolean {
	if (isNotFoundError(error) || isGitError(error, 'not-a-repo')) return true;
	if (isGitError(error, 'git-unavailable') || isGitError(error, 'worktree-busy')) return true;
	return isGitError(error, 'git') && CHECKOUT_SAID.has(String(error.facts['said']));
}

function checkoutBroken(health: CheckoutHealth): WorkstreamError {
	return new WorkstreamError(
		'checkout-broken',
		`This checkout is broken (${health.finding ?? 'unknown'}). Repair it to read it again.`,
	);
}

export function brokenHealth(finding: CheckoutFinding): CheckoutHealth {
	return { state: 'broken', finding, repairable: REPAIRABLE_FINDINGS.has(finding) };
}

export interface CheckoutHealthDeps {
	diagnose(workstreamId: string): Promise<CheckoutFinding | null>;
	repair(workstreamId: string): Promise<void>;
	live(workstreamId: string): boolean;
	changed(payload: WorkstreamCheckoutHealthPayload): void;
	listen(probeBroken: () => void, forget: (workstreamId: string) => void): () => void;
}

interface Watch {
	health: CheckoutHealth;
	misses: number;
	timer: NodeJS.Timeout | null;
	settling: Promise<CheckoutHealth> | null;
}

export class CheckoutHealthGuard {
	readonly #deps: CheckoutHealthDeps;
	readonly #watches = new Map<string, Watch>();
	#unlisten: (() => void) | null = null;
	#disposed = false;

	constructor(deps: CheckoutHealthDeps) {
		this.#deps = deps;
	}

	async health(workstreamId: string): Promise<CheckoutHealth> {
		await this.#watches.get(workstreamId)?.settling;
		return this.#watches.get(workstreamId)?.health ?? HEALTHY;
	}

	async read<T>(workstreamId: string, read: () => Promise<T>): Promise<T> {
		const watch = this.#watches.get(workstreamId);
		if (watch?.health.state === 'healthy') await watch.settling;
		const health = this.#watches.get(workstreamId)?.health ?? HEALTHY;
		if (health.state !== 'healthy') throw checkoutBroken(health);
		try {
			const value = await read();
			const settled = this.#watches.get(workstreamId);
			if (settled?.health.state === 'healthy' && settled.settling === null) {
				this.forget(workstreamId);
			}
			return value;
		} catch (error) {
			if (!isCheckoutFailure(error) || !this.#deps.live(workstreamId)) throw error;
			const first = await this.#discover(workstreamId);
			const found = this.#watches.get(workstreamId)?.health;
			if (found === undefined) throw error;
			if (found.state === 'healthy') return read();
			throw first ? error : checkoutBroken(found);
		}
	}

	async repair(workstreamId: string): Promise<CheckoutHealth> {
		const watch = this.#watch(workstreamId);
		await watch.settling;
		const finding = watch.health.finding ?? (await this.#diagnose(workstreamId));
		if (finding === null || !REPAIRABLE_FINDINGS.has(finding)) return this.#probe(workstreamId);
		const repairing = this.#mend(workstreamId, watch, finding);
		watch.settling = repairing.catch(() => watch.health);
		return repairing;
	}

	async #mend(
		workstreamId: string,
		watch: Watch,
		finding: CheckoutFinding,
	): Promise<CheckoutHealth> {
		this.#clearTimer(watch);
		this.#set(workstreamId, watch, { state: 'repairing', finding, repairable: true });
		try {
			await this.#deps.repair(workstreamId);
		} finally {
			watch.settling = null;
			await this.#probe(workstreamId);
		}
		return watch.health;
	}

	probeBroken(): void {
		for (const [workstreamId, watch] of this.#watches) {
			if (watch.health.state === 'broken') void this.#probe(workstreamId);
		}
	}

	forget(workstreamId: string): void {
		const watch = this.#watches.get(workstreamId);
		if (watch) this.#clearTimer(watch);
		this.#watches.delete(workstreamId);
	}

	start(): void {
		this.#unlisten ??= this.#deps.listen(
			() => this.probeBroken(),
			(workstreamId) => this.forget(workstreamId),
		);
	}

	dispose(): void {
		this.#disposed = true;
		this.#unlisten?.();
		this.#unlisten = null;
		for (const workstreamId of [...this.#watches.keys()]) this.forget(workstreamId);
	}

	async #discover(workstreamId: string): Promise<boolean> {
		const watch = this.#watch(workstreamId);
		if (watch.settling !== null || watch.health.state !== 'healthy') {
			await watch.settling;
			return false;
		}
		const discovering = (async () => {
			const finding = await this.#diagnose(workstreamId);
			if (this.#watches.get(workstreamId) !== watch) return HEALTHY;
			if (finding !== null && REPAIRABLE_FINDINGS.has(finding)) {
				return this.#mend(workstreamId, watch, finding).catch(() => watch.health);
			}
			watch.settling = null;
			if (finding === null) {
				this.forget(workstreamId);
				return HEALTHY;
			}
			this.#set(workstreamId, watch, brokenHealth(finding));
			this.#schedule(workstreamId, watch);
			return watch.health;
		})();
		watch.settling = discovering;
		await discovering;
		return true;
	}

	#probe(workstreamId: string): Promise<CheckoutHealth> {
		const watch = this.#watch(workstreamId);
		if (watch.settling !== null) return watch.settling;
		this.#clearTimer(watch);
		const probing = (async () => {
			const finding = this.#deps.live(workstreamId) ? await this.#diagnose(workstreamId) : null;
			watch.settling = null;
			if (this.#watches.get(workstreamId) !== watch) return HEALTHY;
			if (!this.#deps.live(workstreamId)) {
				this.forget(workstreamId);
				return HEALTHY;
			}
			if (finding === null) {
				this.#set(workstreamId, watch, HEALTHY);
				return HEALTHY;
			}
			watch.misses += 1;
			this.#set(workstreamId, watch, brokenHealth(finding));
			this.#schedule(workstreamId, watch);
			return watch.health;
		})();
		watch.settling = probing;
		return probing;
	}

	async #diagnose(workstreamId: string): Promise<CheckoutFinding | null> {
		try {
			return await this.#deps.diagnose(workstreamId);
		} catch {
			return 'unknown';
		}
	}

	#watch(workstreamId: string): Watch {
		let watch = this.#watches.get(workstreamId);
		if (!watch) {
			watch = { health: HEALTHY, misses: 0, timer: null, settling: null };
			this.#watches.set(workstreamId, watch);
		}
		return watch;
	}

	#set(workstreamId: string, watch: Watch, health: CheckoutHealth): void {
		const previous = watch.health;
		watch.health = health;
		if (previous.state === health.state && previous.finding === health.finding) return;
		this.#deps.changed({ workstreamId, ...health });
	}

	#schedule(workstreamId: string, watch: Watch): void {
		this.#clearTimer(watch);
		if (this.#disposed) return;
		const delay = Math.min(FIRST_PROBE_MS * 2 ** watch.misses, LAST_PROBE_MS);
		watch.timer = setTimeout(() => {
			watch.timer = null;
			void this.#probe(workstreamId);
		}, delay);
		watch.timer.unref();
	}

	#clearTimer(watch: Watch): void {
		if (watch.timer !== null) clearTimeout(watch.timer);
		watch.timer = null;
	}
}
