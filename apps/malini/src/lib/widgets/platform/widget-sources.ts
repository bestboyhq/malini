import { parseWidgetData, type WidgetData, type WidgetSource } from '$contract/widgets';
import { describeError } from '$main/errors';
import { preferredShell } from '$main/process/environment';
import type { ProcessRunner } from '$main/process/runner';
import type { RepositoriesPlatform } from '$shared/repositories/repositories.platform';
import { WidgetError } from './widget-files';

export const SOURCE_TIMEOUT_MS = 20_000;
export const COMMAND_OUTPUT_MAX_BYTES = 256 * 1024;
const ERROR_MAX_LENGTH = 300;
const STDERR_KEPT_LENGTH = 2_000;

export type SourceDeps = Readonly<{
	gh: RepositoriesPlatform['gh'];
	runner: ProcessRunner;
	environment: () => Readonly<Record<string, string>>;
}>;

export type SourceOutcome = Readonly<{ data: WidgetData }> | Readonly<{ error: string }>;

export type SourcePlace = Readonly<{ checkout: string; home: string | null }>;

export async function readWidgetSource(
	source: WidgetSource,
	place: SourcePlace,
	deps: SourceDeps,
): Promise<SourceOutcome> {
	try {
		return widgetData(await sourceOutput(source, place, deps));
	} catch (error) {
		return { error: describeError(error).trim().slice(0, ERROR_MAX_LENGTH) };
	}
}

function sourceOutput(source: WidgetSource, place: SourcePlace, deps: SourceDeps): Promise<string> {
	if (source.kind === 'github')
		return githubOutput(source.path, source.select, place.checkout, deps);
	if (source.kind === 'command') return commandOutput(source.run, place, deps);
	throw failed('Malini draws the plan itself.');
}

async function githubOutput(
	path: string,
	select: string | null,
	checkout: string,
	deps: SourceDeps,
): Promise<string> {
	const result = await deps.gh(
		['api', '--method', 'GET', path, ...(select === null ? [] : ['--jq', select])],
		{ cwd: checkout, timeoutMs: SOURCE_TIMEOUT_MS },
	);
	if (result.code !== 0) {
		throw failed(lastLine(result.stderr) || `gh api exited with status ${result.code}.`);
	}
	return result.stdout;
}

async function commandOutput(run: string, place: SourcePlace, deps: SourceDeps): Promise<string> {
	const env = { ...deps.environment(), MALINI_CHECKOUT: place.checkout };
	let stdout = '';
	let stderr = '';
	let bytes = 0;
	let stopped: 'timeout' | 'overflow' | null = null;
	const stop = (why: 'timeout' | 'overflow'): void => {
		stopped ??= why;
		if (handle.pid === null) return;
		try {
			deps.runner.signalProcessGroup(handle.pid, 'SIGKILL');
		} catch {}
	};
	const handle = deps.runner.spawn(preferredShell(env) ?? '/bin/sh', ['-c', run], {
		cwd: place.home ?? place.checkout,
		env,
		onStdout: (text) => {
			bytes += Buffer.byteLength(text);
			if (bytes > COMMAND_OUTPUT_MAX_BYTES) stop('overflow');
			else stdout += text;
		},
		onStderr: (text) => {
			stderr = (stderr + text).slice(-STDERR_KEPT_LENGTH);
		},
	});
	const timer = setTimeout(() => stop('timeout'), SOURCE_TIMEOUT_MS);
	const exit = await handle.exit.finally(() => clearTimeout(timer));
	if (stopped === 'timeout') throw failed('The command ran past 20 s and was stopped.');
	if (stopped === 'overflow') throw failed('The command printed more than 256 KB.');
	if (exit.kind === 'failed') throw failed(`The command could not start: ${exit.error}`);
	if (exit.kind === 'signaled') throw failed(`The command was stopped by ${exit.signal}.`);
	if (exit.code !== 0) {
		throw failed(lastLine(stderr) || `The command exited with status ${exit.code}.`);
	}
	return stdout;
}

function widgetData(output: string): SourceOutcome {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		return { error: 'The source did not print JSON.' };
	}
	const data = parseWidgetData(parsed);
	return data === null ? { error: 'The source printed JSON, but not an object.' } : { data };
}

function lastLine(text: string): string {
	return (
		text
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.at(-1) ?? ''
	);
}

function failed(message: string): WidgetError {
	return new WidgetError('source-failed', message);
}
