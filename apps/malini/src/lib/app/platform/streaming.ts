import { APP_STREAMING_CHANGED_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import { resolveToolPath } from '$main/process/environment';
import { boundedRunSucceeded, runBounded, type ProcessRunner } from '$main/process/runner';

const STREAMING_CHECK_INTERVAL_MS = 5_000;
const PROBE_TIMEOUT_MS = 4_000;
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
const SCREEN_CAPTURE_PROBE = [
	"ObjC.import('CoreGraphics')",
	"ObjC.bindFunction('CGSIsScreenWatcherPresent', ['bool', []])",
	'$.CGSIsScreenWatcherPresent()',
].join(';');
const STREAMING_APP = new RegExp(
	`/(?:${STREAMING_APPS.join('|')})\\.app/Contents/MacOS/[^/\\n]+$`,
	'mu',
);

export function streamingAppRunning(executables: string, root = ''): boolean {
	return executables
		.split('\n')
		.some((executable) => executable.startsWith(root) && STREAMING_APP.test(executable));
}

export class StreamingDetector {
	readonly #context: MainContext;
	readonly #runner: ProcessRunner;
	readonly #appRoot: string;
	#appRunning = false;
	#screenCaptured = false;
	#streaming = false;
	#timer: NodeJS.Timeout | null = null;

	constructor(context: MainContext, runner: ProcessRunner) {
		this.#context = context;
		this.#runner = runner;
		this.#appRoot = (context.isDev && process.env['MALINI_STREAMING_APP_ROOT']) || '';
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
		const [executables, screenCapture] = await Promise.all([
			this.#read(resolveToolPath('ps') ?? '/bin/ps', ['-A', '-o', 'comm=']),
			this.#read('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCREEN_CAPTURE_PROBE]),
		]);
		if (executables !== null) this.#appRunning = streamingAppRunning(executables, this.#appRoot);
		if (screenCapture !== null) this.#screenCaptured = screenCapture.trim() === 'true';
		const streaming = this.#appRunning || this.#screenCaptured;
		if (streaming === this.#streaming) return;
		this.#streaming = streaming;
		this.#context.events.emit(APP_STREAMING_CHANGED_CHANNEL, { streaming });
	}

	async #read(file: string, args: readonly string[]): Promise<string | null> {
		try {
			const run = await runBounded(this.#runner, file, args, {
				deadline: Date.now() + PROBE_TIMEOUT_MS,
				env: { LC_ALL: 'C' },
			});
			return boundedRunSucceeded(run) ? run.stdout : null;
		} catch {
			return null;
		}
	}
}
