export type PlatformLogLevel = 'info' | 'warn' | 'error';

export interface PlatformLog {
	info(line: string): void;
	warn(line: string): void;
	error(line: string): void;
}

export interface PlatformOutput {
	info(...values: unknown[]): void;
	warn(...values: unknown[]): void;
	error(...values: unknown[]): void;
}

export function consolePlatformLog(output: PlatformOutput = console): PlatformLog {
	return {
		info: (line) => output.info(line),
		warn: (line) => output.warn(line),
		error: (line) => output.error(line),
	};
}

export function platformLineSink(log: PlatformLog): (line: string) => void {
	let bridgeLevel: PlatformLogLevel = 'warn';
	return (line) => {
		const bridgeLine = bridgeStderrLine(line);
		if (bridgeLine !== null) bridgeLevel = bridgeStderrLevel(bridgeLine, bridgeLevel);
		log[bridgeLine === null ? platformLineLevel(line) : bridgeLevel](line);
	};
}

export function platformLineLevel(line: string): PlatformLogLevel {
	if (INFO_LINES.some((pattern) => pattern.test(line))) return 'info';
	if (WARN_LINES.some((pattern) => pattern.test(line))) return 'warn';
	return 'error';
}

export function bridgeStderrLevel(
	stderrLine: string,
	previous: PlatformLogLevel = 'warn',
): PlatformLogLevel {
	if (STACK_CONTINUATION.test(stderrLine)) return previous;
	if (BRIDGE_FAILURE.test(stderrLine)) return 'error';
	if (PROVIDER_BANNER.test(stderrLine)) return 'info';
	return 'warn';
}

const BRIDGE_STDERR_PREFIX = 'agent-bridge stderr: ';

const INFO_LINES: readonly RegExp[] = [/^agent: reaped 0 orphaned run\(s\) on startup$/u];

const WARN_LINES: readonly RegExp[] = [
	/^agent: reaped \d+ orphaned run\(s\) on startup$/u,
	/^agent: remembered approval `[^`]*` (?:bridge unavailable|was not acknowledged); showing prompt/u,
	/^agent: bridge replacement terminalized /u,
	/^agent: Claude did not name the chat, /u,
	/^malini: (?:stopped watching|not watching) workstream /u,
	/^malini: watching workstream `[^`]*` without its git dir/u,
];

const STACK_CONTINUATION = /^\s+(?:at\s|\.\.\.|\{|\}|[A-Za-z_$][\w$]*:)/u;
const BRIDGE_FAILURE = /^\s*(?:FATAL\b|dispatch error\b)|\b(?:error|exception|fatal)\b/iu;
const PROVIDER_BANNER = /^\[agent-provider\]/u;

function bridgeStderrLine(line: string): string | null {
	return line.startsWith(BRIDGE_STDERR_PREFIX) ? line.slice(BRIDGE_STDERR_PREFIX.length) : null;
}
