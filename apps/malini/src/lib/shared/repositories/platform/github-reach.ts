import { githubFailure, type GithubReach } from '$contract/github-failure';
import type { GhResult } from '$main/process/gh';
import type { GhRunner } from './github.service';

export const GITHUB_REACH_PROBE_EVERY_MS = 30_000;

const PROBE = ['api', 'graphql', '-f', 'query={viewer{login}}'];

export type GithubReachOptions = Readonly<{
	run: GhRunner;
	isOnline: () => boolean;
	changed: (reach: GithubReach) => void;
	probeEveryMs?: number;
}>;

export class GithubReachWatch {
	readonly run: GhRunner;
	readonly #options: GithubReachOptions;
	#reach: GithubReach = 'ok';
	#probe: ReturnType<typeof setTimeout> | null = null;

	constructor(options: GithubReachOptions) {
		this.#options = options;
		this.run = async (args, runOptions) => {
			const result = await options.run(args, runOptions);
			this.#observe(result);
			return result;
		};
	}

	get reach(): GithubReach {
		return this.#reach;
	}

	dispose(): void {
		if (this.#probe !== null) clearTimeout(this.#probe);
		this.#probe = null;
	}

	#observe(result: GhResult): void {
		if (result.code === 0) {
			this.#set('ok');
			return;
		}
		const failure = githubFailure(result.stderr);
		if (failure === null || (failure === 'unreachable' && !this.#options.isOnline())) return;
		this.#set(failure);
	}

	#set(reach: GithubReach): void {
		if (reach !== 'ok') this.#scheduleProbe();
		if (reach === this.#reach) return;
		this.#reach = reach;
		this.#options.changed(reach);
	}

	#scheduleProbe(): void {
		if (this.#probe !== null) return;
		this.#probe = setTimeout(
			() => void this.#probeNow(),
			this.#options.probeEveryMs ?? GITHUB_REACH_PROBE_EVERY_MS,
		);
		this.#probe.unref();
	}

	async #probeNow(): Promise<void> {
		this.#probe = null;
		if (this.#reach === 'ok') return;
		const result = this.#options.isOnline()
			? await this.#options.run(PROBE).catch(() => null)
			: null;
		if (result !== null) this.#observe(result);
		if (this.reach !== 'ok') this.#scheduleProbe();
	}
}
