import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { SANDBOX_TAG_PREFIX, sandboxDenial, type SandboxDenial } from './sandbox.js';
import { isRecord } from './type-guards.js';

const LOG = '/usr/bin/log';
const PREDICATE = `processID == 0 AND sender == "Sandbox" AND eventMessage CONTAINS "${SANDBOX_TAG_PREFIX}"`;
const UNTIL_THE_BRIDGE_ENDS = `${LOG} stream --style ndjson --predicate "$1" & read -r _; kill $!`;
const LINGER_MS = 60_000;
const READY_TIMEOUT_MS = 1_000;

export type DenialListener = (denial: SandboxDenial) => void;

export interface SandboxDenialSource {
	watch(tag: string, listener: DenialListener): () => void;
	hold(): Promise<() => void>;
}

interface Stream {
	readonly child: ChildProcess;
	readonly ready: Promise<void>;
}

export class SandboxDenials implements SandboxDenialSource {
	readonly #listeners = new Map<string, DenialListener>();
	#stream: Stream | null = null;
	#holds = 0;
	#linger: NodeJS.Timeout | null = null;

	watch(tag: string, listener: DenialListener): () => void {
		this.#listeners.set(tag, listener);
		return () => {
			if (this.#listeners.get(tag) === listener) this.#listeners.delete(tag);
		};
	}

	async hold(): Promise<() => void> {
		this.#holds += 1;
		if (this.#linger) clearTimeout(this.#linger);
		this.#linger = null;
		this.#stream ??= this.#start();
		let held = true;
		const release = () => {
			if (!held) return;
			held = false;
			this.#holds -= 1;
			if (this.#holds === 0) this.#linger = setTimeout(() => this.#stop(), LINGER_MS).unref();
		};
		await this.#stream?.ready;
		return release;
	}

	read(line: string): void {
		const denial = denialIn(line);
		if (denial) this.#listeners.get(denial.tag)?.(denial);
	}

	#start(): Stream | null {
		if (!existsSync(LOG)) return null;
		const child = spawn('/bin/sh', ['-c', UNTIL_THE_BRIDGE_ENDS, 'sh', PREDICATE], {
			stdio: ['pipe', 'pipe', 'ignore'],
		});
		let resolve = () => {};
		const ready = new Promise<void>((done) => (resolve = done));
		const markReady = () => {
			clearTimeout(waited);
			resolve();
		};
		const waited = setTimeout(markReady, READY_TIMEOUT_MS);
		child.once('error', markReady);
		child.once('exit', () => {
			markReady();
			if (this.#stream?.child === child) this.#stream = null;
		});
		createInterface({ input: child.stdout }).on('line', (line) => {
			markReady();
			this.read(line);
		});
		return { child, ready };
	}

	#stop(): void {
		this.#linger = null;
		this.#stream?.child.stdin?.end();
		this.#stream = null;
	}
}

function denialIn(line: string): SandboxDenial | null {
	if (!line.startsWith('{')) return null;
	try {
		const entry: unknown = JSON.parse(line);
		const message = isRecord(entry) ? entry['eventMessage'] : undefined;
		return typeof message === 'string' ? sandboxDenial(message) : null;
	} catch {
		return null;
	}
}

export const sandboxDenials = new SandboxDenials();
