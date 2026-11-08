import { randomBytes, randomUUID } from 'node:crypto';
import {
	accessSync,
	constants,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { constants as osConstants, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	INSIDE_THE_SANDBOX,
	OUTSIDE_THE_SANDBOX,
	SANDBOX_ENVIRONMENT,
	SANDBOX_EXEC,
	SECRETS_FOLDER_PREFIX,
} from '../sandbox.js';
import { errnoCode, isRecord } from '../type-guards.js';

export const SECRET_MASK = '[secret]';
export const MASKED_LENGTH = 8;

const BRIDGE_FOLDER = new RegExp(`^${SECRETS_FOLDER_PREFIX}(\\d+)-`, 'u');
const STOP_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;
const { signals } = osConstants;
const sandboxEnvironment = Object.entries(SANDBOX_ENVIRONMENT)
	.map(([name, value]) => `${name}=${value}`)
	.join(' ');

const RUN_SCRIPT = `#!/bin/bash
folder=\${0%/*}
shell=\${CLAUDE_CODE_SHELL:-/bin/zsh}
[ -r "$folder/secrets.sh" ] && . "$folder/secrets.sh"
run=("$shell" -c "$1")
profile=(-f "$folder/sandbox.sb")
if [[ $1 =~ ${INSIDE_THE_SANDBOX}([0-9a-f]{32}) ]] && once="$folder/passes/\${BASH_REMATCH[1]}.sb" &&
	granted=$(/bin/cat "$once" 2>/dev/null) && /bin/rm "$once"; then
	profile=(-p "$granted")
fi
if [ -r "$folder/sandbox.sb" ] && ! {
	[[ $1 =~ ${OUTSIDE_THE_SANDBOX}([0-9a-f]{32}) ]] && /bin/rm "$folder/passes/\${BASH_REMATCH[1]}" 2>/dev/null
}; then
	run=(/usr/bin/env ${sandboxEnvironment} ${SANDBOX_EXEC} "\${profile[@]}" "\${run[@]}")
fi
[ -s "$folder/masks" ] || exec "\${run[@]}"
mask() {
	/usr/bin/awk -v masks="$folder/masks" '
		BEGIN { while ((getline line < masks) > 0) if (line != "") secret[++count] = line }
		{
			for (i = 1; i <= count; i++) {
				rest = $0
				out = ""
				while ((at = index(rest, secret[i])) > 0) {
					out = out substr(rest, 1, at - 1) "${SECRET_MASK}"
					rest = substr(rest, at + length(secret[i]))
				}
				$0 = out rest
			}
			print
			fflush()
		}'
}
set -o pipefail
if [ /dev/fd/1 -ef /dev/fd/2 ]; then
	"\${run[@]}" 2>&1 | mask
else
	{ "\${run[@]}" 2>&1 1>&3 3>&- | mask >&2; } 3>&1 | mask
fi
`;

export class SessionSecrets {
	readonly runScript: string;
	readonly #folder: string;
	#masks: readonly string[] = [];
	#confined = false;

	constructor(folder: string) {
		this.#folder = folder;
		this.runScript = join(folder, 'run');
		writeFileSync(this.runScript, RUN_SCRIPT, { mode: 0o700 });
	}

	confine(profile: string | null): void {
		this.#confined = profile !== null;
		const path = join(this.#folder, 'sandbox.sb');
		if (profile === null) {
			rmSync(path, { force: true });
			return;
		}
		const next = `${path}.${randomUUID()}`;
		writeFileSync(next, profile, { mode: 0o600 });
		renameSync(next, path);
	}

	passOutside(command: string): string {
		if (!this.#confined) return command;
		return `: ${OUTSIDE_THE_SANDBOX}${this.#pass('', '')}; ${command}`;
	}

	passInside(command: string, profile: string): string {
		if (!this.#confined) return command;
		return `: ${INSIDE_THE_SANDBOX}${this.#pass('.sb', profile)}; ${command}`;
	}

	#pass(extension: string, contents: string): string {
		const passes = join(this.#folder, 'passes');
		const pass = randomBytes(16).toString('hex');
		mkdirSync(passes, { recursive: true, mode: 0o700 });
		writeFileSync(join(passes, `${pass}${extension}`), contents, { mode: 0o600 });
		return pass;
	}

	async set(secrets: Readonly<Record<string, string>>): Promise<void> {
		this.#masks = masksOf([...this.#masks, ...Object.values(secrets)]);
		await replaceFile(join(this.#folder, 'masks'), this.#masks.map((mask) => `${mask}\n`).join(''));
		await replaceFile(join(this.#folder, 'secrets.sh'), exportLines(secrets));
	}

	maskText(text: string): string {
		return this.#masks.reduce((masked, secret) => masked.split(secret).join(SECRET_MASK), text);
	}

	mask(value: unknown): unknown {
		return this.#masks.length === 0 ? value : maskedValue(value, (text) => this.maskText(text));
	}

	async remove(): Promise<void> {
		await rm(this.#folder, { recursive: true, force: true });
	}
}

export function sessionSecretsFolder(bridgeFolder: string): string {
	return mkdtempSync(join(bridgeFolder, 'session-'));
}

export function bridgeSecretsFolder(parent: string = tmpdir()): string {
	for (const name of readdirSync(parent)) {
		const pid = BRIDGE_FOLDER.exec(name)?.[1];
		if (pid !== undefined && !isAlive(Number(pid))) {
			rmSync(join(parent, name), { recursive: true, force: true });
		}
	}
	const folder = mkdtempSync(join(parent, `${SECRETS_FOLDER_PREFIX}${process.pid}-`));
	process.once('exit', () => rmSync(folder, { recursive: true, force: true }));
	for (const signal of STOP_SIGNALS) {
		process.once(signal, () => process.exit(128 + signals[signal]));
	}
	return folder;
}

export function claudeShell(env: NodeJS.ProcessEnv = process.env): string {
	const candidates = [env['CLAUDE_CODE_SHELL'], env['SHELL']];
	return (
		candidates.find((shell) => shell && /bash|zsh/u.test(shell) && isExecutable(shell)) ??
		'/bin/zsh'
	);
}

function masksOf(values: readonly string[]): string[] {
	const parts = values
		.flatMap((value) => [value, ...value.split(/\r?\n/u)])
		.map((part) => part.trim());
	return [...new Set(parts.filter((part) => part.length >= MASKED_LENGTH))].sort(
		(a, b) => b.length - a.length,
	);
}

function exportLines(secrets: Readonly<Record<string, string>>): string {
	return Object.entries(secrets)
		.map(([name, value]) => `export ${name}=${shellQuoted(value)}\n`)
		.join('');
}

function shellQuoted(text: string): string {
	return `'${text.replaceAll("'", "'\\''")}'`;
}

function maskedValue(value: unknown, maskText: (text: string) => string): unknown {
	if (typeof value === 'string') return maskText(value);
	if (Array.isArray(value)) {
		const items = value.map((item: unknown) => maskedValue(item, maskText));
		return items.some((item, index) => item !== value[index]) ? items : value;
	}
	if (!isRecord(value)) return value;
	const entries = Object.entries(value);
	const masked = entries.map(([key, item]) => [key, maskedValue(item, maskText)] as const);
	return masked.some(([, item], index) => item !== entries[index]?.[1])
		? Object.fromEntries(masked)
		: value;
}

async function replaceFile(path: string, contents: string): Promise<void> {
	const next = `${path}.${randomUUID()}`;
	await writeFile(next, contents, { mode: 0o600 });
	await rename(next, path);
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return errnoCode(error) === 'EPERM';
	}
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
