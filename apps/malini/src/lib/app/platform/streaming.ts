import { APP_STREAMING_CHANGED_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import { resolveToolPath } from '$main/process/environment';
import { boundedRunSucceeded, runBounded, type ProcessRunner } from '$main/process/runner';

const STREAMING_CHECK_INTERVAL_MS = 5_000;
const PS_TIMEOUT_MS = 4_000;
const STREAMING_APPS = [
	'OBS',
	'Streamlabs Desktop',
	'Streamlabs OBS',
	'Ecamm Live',
	'Twitch Studio',
	'Wirecast',
	'PRISM Live Studio',
	'Meld Studio',
];
const STREAMING_APP = new RegExp(
	`/(?:${STREAMING_APPS.join('|')})\\.app/Contents/MacOS/[^/\\n]+$`,
	'mu',
);

export function streamingAppRunning(executables: string): boolean {
	return STREAMING_APP.test(executables);
}

export class StreamingDetector {
	readonly #context: MainContext;
	readonly #runner: ProcessRunner;
	#streaming = false;
	#timer: NodeJS.Timeout | null = null;

	constructor(context: MainContext, runner: ProcessRunner) {
		this.#context = context;
		this.#runner = runner;
		context.commands.define('app.streaming', () => this.#streaming);
	}

	start(): void {
		if (this.#timer) return;
		void this.check();
		this.#timer = setInterval(() => void this.check(), STREAMING_CHECK_INTERVAL_MS);
		this.#timer.unref();
	}

	stop(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}

	async check(): Promise<void> {
		const executables = await this.#readExecutables();
		if (executables === null) return;
		const streaming = streamingAppRunning(executables);
		if (streaming === this.#streaming) return;
		this.#streaming = streaming;
		this.#context.events.emit(APP_STREAMING_CHANGED_CHANNEL, { streaming });
	}

	async #readExecutables(): Promise<string | null> {
		try {
			const run = await runBounded(
				this.#runner,
				resolveToolPath('ps') ?? '/bin/ps',
				['-A', '-o', 'comm='],
				{ deadline: Date.now() + PS_TIMEOUT_MS, env: { LC_ALL: 'C' } },
			);
			return boundedRunSucceeded(run) ? run.stdout : null;
		} catch {
			return null;
		}
	}
}
