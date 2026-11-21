import type {
	CheckoutFinding,
	CheckoutHealth,
	CheckoutRestore,
	WorkstreamCheckoutHealthPayload,
} from '$contract/repositories';
import { isGitError, isNotFoundError } from '$main/errors';
import { WorkstreamError } from './checkout-resolver';

export const FIRST_PROBE_MS = 5_000;
export const LAST_PROBE_MS = 5 * 60_000;

export const HEALTHY: CheckoutHealth = {
	state: 'healthy',
	finding: null,
	repairable: false,
	said: null,
	restored: null,
};

const REPAIRABLE_FINDINGS: ReadonlySet<CheckoutFinding> = new Set([
	'folder-missing',
	'git-link-missing',
	'admin-missing',
	'base-repository-missing',
	'stale-lock',
	'index-corrupt',
	'head-invalid',
]);

const RETRIED_ON_REQUEST: ReadonlySet<CheckoutFinding> = new Set([
	'github-signed-out',
	'remote-missing',
	'checkouts-folder-missing',
]);

const FIXED_ON_REQUEST: ReadonlySet<CheckoutFinding> = new Set([
	'dubious-ownership',
	'git-unavailable',
	'developer-tools-missing',
	'xcode-license',
	'permission-denied',
	'disk-full',
]);

export type CheckoutDiagnosis = Readonly<{ finding: CheckoutFinding; said: string | null }>;

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

export function brokenHealth(finding: CheckoutFinding, said: string | null = null): CheckoutHealth {
	return {
		state: 'broken',
		finding,
		repairable: REPAIRABLE_FINDINGS.has(finding),
		said,
		restored: null,
	};
}

export interface CheckoutHealthDeps {
	diagnose(workstreamId: string): Promise<CheckoutDiagnosis | null>;
	repair(workstreamId: string): Promise<CheckoutRestore | null>;
	fix(workstreamId: string, finding: CheckoutFinding): Promise<void>;
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
	readonly #restored = new Map<string, CheckoutRestore>();
	#unlisten: (() => void) | null = null;
	#disposed = false;

	constructor(deps: CheckoutHealthDeps) {
		this.#deps = deps;
	}

	async health(workstreamId: string): Promise<CheckoutHealth> {
		await this.#watches.get(workstreamId)?.settling;
		return this.#watches.get(workstreamId)?.health ?? this.#healthy(workstreamId);
	}

	async read<T>(workstreamId: string, read: () => Promise<T>): Promise<T> {
		const watch = this.#watches.get(workstreamId);
		if (watch?.health.state === 'healthy') await watch.settling;
		const health = this.#watches.get(workstreamId)?.health ?? this.#healthy(workstreamId);
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
		const finding = watch.health.finding ?? (await this.#diagnose(workstreamId))?.finding ?? null;
		if (finding === null) return this.#probe(workstreamId);
		const run = this.#runFor(workstreamId, finding);
		if (run === null) return this.#probe(workstreamId);
		const repairing = this.#mend(workstreamId, watch, finding, run);
		watch.settling = repairing.catch(() => watch.health);
		return repairing;
	}

	#repairRun(workstreamId: string, finding: CheckoutFinding): (() => Promise<void>) | null {
		return REPAIRABLE_FINDINGS.has(finding) ? this.#runFor(workstreamId, finding) : null;
	}

	#runFor(workstreamId: string, finding: CheckoutFinding): (() => Promise<void>) | null {
		if (FIXED_ON_REQUEST.has(finding)) return () => this.#deps.fix(workstreamId, finding);
		if (!REPAIRABLE_FINDINGS.has(finding) && !RETRIED_ON_REQUEST.has(finding)) return null;
		return async () => {
			const restored = await this.#deps.repair(workstreamId);
			if (restored === null) this.#restored.delete(workstreamId);
			else this.#restored.set(workstreamId, restored);
		};
	}

	async #mend(
		workstreamId: string,
		watch: Watch,
		finding: CheckoutFinding,
		run: () => Promise<void>,
	): Promise<CheckoutHealth> {
		this.#clearTimer(watch);
		this.#set(workstreamId, watch, {
			state: 'repairing',
			finding,
			repairable: REPAIRABLE_FINDINGS.has(finding),
			said: null,
			restored: null,
		});
		try {
			await run();
		} finally {
			watch.settling = null;
			await this.#probe(workstreamId);
		}
		if (watch.health.state === 'healthy') this.probeBroken();
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
			(workstreamId) => {
				this.forget(workstreamId);
				this.#restored.delete(workstreamId);
			},
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
			const diagnosis = await this.#diagnose(workstreamId);
			if (this.#watches.get(workstreamId) !== watch) return HEALTHY;
			const run = diagnosis === null ? null : this.#repairRun(workstreamId, diagnosis.finding);
			if (diagnosis !== null && run !== null) {
				return this.#mend(workstreamId, watch, diagnosis.finding, run).catch(() => watch.health);
			}
			watch.settling = null;
			if (diagnosis === null) {
				this.forget(workstreamId);
				return HEALTHY;
			}
			this.#set(workstreamId, watch, brokenHealth(diagnosis.finding, diagnosis.said));
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
		const before = watch.health.finding;
		const probing = (async () => {
			const diagnosis = this.#deps.live(workstreamId) ? await this.#diagnose(workstreamId) : null;
			watch.settling = null;
			if (this.#watches.get(workstreamId) !== watch) return HEALTHY;
			if (!this.#deps.live(workstreamId)) {
				this.forget(workstreamId);
				return HEALTHY;
			}
			if (diagnosis === null) {
				this.#set(workstreamId, watch, this.#healthy(workstreamId));
				return watch.health;
			}
			const uncovered = before !== null && !REPAIRABLE_FINDINGS.has(before);
			const run = uncovered ? this.#repairRun(workstreamId, diagnosis.finding) : null;
			if (run !== null) return this.#mend(workstreamId, watch, diagnosis.finding, run);
			watch.misses += 1;
			this.#set(workstreamId, watch, brokenHealth(diagnosis.finding, diagnosis.said));
			this.#schedule(workstreamId, watch);
			return watch.health;
		})();
		watch.settling = probing;
		return probing;
	}

	async #diagnose(workstreamId: string): Promise<CheckoutDiagnosis | null> {
		try {
			return await this.#deps.diagnose(workstreamId);
		} catch {
			return { finding: 'unknown', said: null };
		}
	}

	#healthy(workstreamId: string): CheckoutHealth {
		return { ...HEALTHY, restored: this.#restored.get(workstreamId) ?? null };
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
		if (
			previous.state === health.state &&
			previous.finding === health.finding &&
			previous.said === health.said &&
			previous.restored === health.restored
		)
			return;
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
