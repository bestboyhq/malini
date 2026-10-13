import { spawn, type ChildProcess } from 'node:child_process';
import type { ClaudeSignInOutcome } from '$contract/agent';

const PASTE_PROMPT = 'Paste code here if prompted >';
const PROGRESS_LINES = ['Opening browser to sign in', "If the browser didn't open, visit:"];
const KEPT_OUTPUT_CHARACTERS = 4_000;

export interface ClaudeSignInDeps {
	readonly executable: () => string | null;
	readonly environment: () => Readonly<Record<string, string>>;
}

export class ClaudeSignIn {
	readonly #deps: ClaudeSignInDeps;
	#child: ChildProcess | null = null;

	constructor(deps: ClaudeSignInDeps) {
		this.#deps = deps;
	}

	run(email: string | null): Promise<ClaudeSignInOutcome> {
		this.cancel();
		const executable = this.#deps.executable();
		if (!executable) {
			return Promise.reject(new Error('Claude Code is not installed. Install it, then sign in.'));
		}
		const child = spawn(executable, ['auth', 'login', ...(email ? [`--email=${email}`] : [])], {
			env: { ...this.#deps.environment() },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		this.#child = child;
		let output = '';
		const keep = (chunk: Buffer): void => {
			output = `${output}${chunk.toString('utf8')}`.slice(-KEPT_OUTPUT_CHARACTERS);
		};
		child.stdout?.on('data', keep);
		child.stderr?.on('data', keep);
		return new Promise((resolve, reject) => {
			child.once('error', (error) => {
				this.#release(child);
				reject(error);
			});
			child.once('exit', (code) => {
				const cancelled = this.#child !== child;
				this.#release(child);
				if (cancelled) resolve('cancelled');
				else if (code === 0) resolve('signed-in');
				else reject(new Error(failureMessage(output, code)));
			});
		});
	}

	cancel(): void {
		const child = this.#child;
		this.#child = null;
		child?.kill('SIGTERM');
	}

	#release(child: ChildProcess): void {
		if (this.#child === child) this.#child = null;
	}
}

function failureMessage(output: string, code: number | null): string {
	const lines = output
		.split('\n')
		.flatMap((line) => line.split(PASTE_PROMPT))
		.map((line) => line.trim())
		.filter((line) => line && !PROGRESS_LINES.some((progress) => line.startsWith(progress)));
	return lines.at(-1) ?? `Claude Code sign-in stopped with exit code ${code ?? 'unknown'}.`;
}
