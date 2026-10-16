import { spawn, type ChildProcess } from 'node:child_process';
import type { GitHubDeviceCodeDto, GitHubSignInOutcome } from '$contract/repositories';
import { GhError } from '$main/errors';
import { ghEnvironment } from '$main/process/gh';

const LOGIN_ARGS = [
	'auth',
	'login',
	'--web',
	'--hostname',
	'github.com',
	'--git-protocol',
	'https',
	'--skip-ssh-key',
] as const;
const USER_CODE = /one-time code\W*([A-Z0-9]{4}-[A-Z0-9]{4})/iu;
const VERIFICATION_URI = /(https:\/\/[^\s]+)/u;
const PROGRESS_LINE = /one-time code|^Open this URL|pbcopy/iu;
const KEPT_OUTPUT_CHARACTERS = 4_000;
const CODE_TIMEOUT_MS = 20_000;

export interface GitHubSignInDeps {
	readonly command?: string;
	readonly environment?: () => NodeJS.ProcessEnv;
	readonly codeTimeoutMs?: number;
}

interface Session {
	readonly child: ChildProcess;
	readonly outcome: Promise<GitHubSignInOutcome>;
	cancelled: boolean;
}

export class GitHubSignIn {
	readonly #command: string;
	readonly #environment: () => NodeJS.ProcessEnv;
	readonly #codeTimeoutMs: number;
	#session: Session | null = null;

	constructor(deps: GitHubSignInDeps = {}) {
		this.#command = deps.command ?? 'gh';
		this.#environment = deps.environment ?? (() => ghEnvironment());
		this.#codeTimeoutMs = deps.codeTimeoutMs ?? CODE_TIMEOUT_MS;
	}

	start(): Promise<GitHubDeviceCodeDto> {
		this.cancel();
		const child = spawn(this.#command, [...LOGIN_ARGS], {
			env: this.#environment(),
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		let timer: ReturnType<typeof setTimeout> | undefined;
		let announce: (code: GitHubDeviceCodeDto) => void = () => {};
		let refuse: (error: unknown) => void = () => {};
		const code = new Promise<GitHubDeviceCodeDto>((resolve, reject) => {
			announce = (value) => {
				clearTimeout(timer);
				resolve(value);
			};
			refuse = (error) => {
				clearTimeout(timer);
				reject(error);
			};
		});
		timer = setTimeout(() => {
			refuse(new Error(`GitHub CLI showed no sign-in code. ${failureMessage(output, null)}`));
			this.cancel();
		}, this.#codeTimeoutMs);
		const read = (chunk: Buffer): void => {
			output = `${output}${chunk.toString('utf8')}`.slice(-KEPT_OUTPUT_CHARACTERS);
			const parsed = parseDeviceCode(output);
			if (parsed) announce(parsed);
		};
		child.stdout?.on('data', read);
		child.stderr?.on('data', read);
		const session: Session = {
			child,
			cancelled: false,
			outcome: new Promise((resolve, reject) => {
				child.once('error', (error: NodeJS.ErrnoException) => {
					reject(error.code === 'ENOENT' ? GhError.notInstalled() : error);
				});
				child.once('exit', (exitCode) => {
					if (session.cancelled) resolve('cancelled');
					else if (exitCode === 0) resolve('signed-in');
					else reject(new Error(failureMessage(output, exitCode)));
				});
			}),
		};
		void refuseWhenSettled(session.outcome, refuse);
		this.#session = session;
		return code;
	}

	finish(): Promise<GitHubSignInOutcome> {
		return this.#session?.outcome ?? Promise.resolve('cancelled');
	}

	cancel(): void {
		const session = this.#session;
		if (!session || session.child.exitCode !== null || session.child.signalCode !== null) return;
		session.cancelled = true;
		session.child.kill('SIGTERM');
	}
}

async function refuseWhenSettled(
	outcome: Promise<GitHubSignInOutcome>,
	refuse: (error: unknown) => void,
): Promise<void> {
	try {
		await outcome;
		refuse(new Error('GitHub sign-in ended before GitHub gave a code.'));
	} catch (error) {
		refuse(error);
	}
}

export function parseDeviceCode(output: string): GitHubDeviceCodeDto | null {
	const userCode = USER_CODE.exec(output)?.[1];
	const verificationUri = VERIFICATION_URI.exec(output)?.[1];
	if (!userCode || !verificationUri) return null;
	return { userCode, verificationUri };
}

function failureMessage(output: string, code: number | null): string {
	const lines = output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && !PROGRESS_LINE.test(line));
	const last = lines.at(-1)?.replace(/^(?:error|x|gh):\s*/iu, '');
	return last ?? `GitHub sign-in stopped with exit code ${code ?? 'unknown'}.`;
}
