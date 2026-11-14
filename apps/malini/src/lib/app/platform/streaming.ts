import { win32 } from 'node:path';
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
	'vMix',
	'XSplit.Core',
];
const SCREEN_CAPTURE_PROBE = [
	"ObjC.import('CoreGraphics')",
	"ObjC.bindFunction('CGSIsScreenWatcherPresent', ['bool', []])",
	'$.CGSIsScreenWatcherPresent()',
].join(';');
const POSIX_ENV = { LC_ALL: 'C' };
const MAC_APP = /\/([^/]+)\.app\/Contents\/MacOS\/[^/]+$/u;
const WINDOWS_IMAGE = /^"([^"]+)"/u;

function programName(line: string, platform: NodeJS.Platform): string | undefined {
	if (platform === 'darwin') return MAC_APP.exec(line)?.[1];
	if (platform === 'win32') return WINDOWS_IMAGE.exec(line)?.[1];
	return line.trim();
}

function comparable(name: string): string {
	return name
		.toLowerCase()
		.replace(/\.exe$/u, '')
		.replace(/(?:32|64)$/u, '')
		.replace(/[^a-z0-9]/gu, '');
}

export function streamingAppRunning(
	listing: string,
	platform: NodeJS.Platform,
	apps: readonly string[] = STREAMING_APPS,
): boolean {
	const wanted = new Set(apps.map(comparable));
	return listing.split(/\r?\n/u).some((line) => {
		const name = programName(line, platform);
		return name !== undefined && name !== '' && wanted.has(comparable(name));
	});
}

export class StreamingDetector {
	readonly #context: MainContext;
	readonly #runner: ProcessRunner;
	readonly #platform: NodeJS.Platform;
	readonly #apps: readonly string[] | null;
	#appRunning = false;
	#screenCaptured = false;
	#streaming = false;
	#timer: NodeJS.Timeout | null = null;

	constructor(context: MainContext, runner: ProcessRunner, platform = process.platform) {
		this.#context = context;
		this.#runner = runner;
		this.#platform = platform;
		const apps = context.isDev ? process.env['MALINI_STREAMING_APPS'] : undefined;
		this.#apps = apps ? apps.split(',') : null;
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
		const [listing, screenCapture] = await Promise.all([
			this.#listPrograms(),
			this.#platform === 'darwin' && !this.#apps
				? this.#read(
						'/usr/bin/osascript',
						['-l', 'JavaScript', '-e', SCREEN_CAPTURE_PROBE],
						POSIX_ENV,
					)
				: null,
		]);
		if (listing !== null) {
			this.#appRunning = streamingAppRunning(listing, this.#platform, this.#apps ?? undefined);
		}
		if (screenCapture !== null) this.#screenCaptured = screenCapture.trim() === 'true';
		const streaming = this.#appRunning || this.#screenCaptured;
		if (streaming === this.#streaming) return;
		this.#streaming = streaming;
		this.#context.events.emit(APP_STREAMING_CHANGED_CHANNEL, { streaming });
	}

	#listPrograms(): Promise<string | null> {
		if (this.#platform !== 'win32') {
			return this.#read(resolveToolPath('ps') ?? '/bin/ps', ['-A', '-o', 'comm='], POSIX_ENV);
		}
		const tasklist = win32.join(
			process.env['SystemRoot'] ?? 'C:\\Windows',
			'System32',
			'tasklist.exe',
		);
		return this.#read(tasklist, ['/fo', 'csv', '/nh']);
	}

	async #read(
		file: string,
		args: readonly string[],
		env?: Readonly<Record<string, string>>,
	): Promise<string | null> {
		try {
			const run = await runBounded(this.#runner, file, args, {
				deadline: Date.now() + PROBE_TIMEOUT_MS,
				...(env ? { env } : {}),
			});
			return boundedRunSucceeded(run) ? run.stdout : null;
		} catch {
			return null;
		}
	}
}
