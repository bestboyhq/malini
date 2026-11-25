import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	fillWidgetKeys,
	parseWidgetData,
	widgetSite,
	type WidgetData,
	type WidgetSource,
} from '$contract/widgets';
import { describeError } from '$main/errors';
import { DownloadError, readBounded, type Fetch } from '$main/fs/download';
import { runBounded, type ProcessRunner } from '$main/process/runner';
import type { RepositoriesPlatform } from '$shared/repositories/repositories.platform';
import { WidgetError } from './widget-files';

export const SOURCE_TIMEOUT_MS = 20_000;
const ERROR_MAX_LENGTH = 300;
const ANSWER_MAX_BYTES = 5 * 1024 * 1024;
const ANSWER_DETAIL_MAX_LENGTH = 160;

export type SourceDeps = Readonly<{
	gh: RepositoriesPlatform['gh'];
	runner: ProcessRunner;
	environment: () => Readonly<Record<string, string>>;
	fetch: Fetch;
}>;

export type SourceOutcome = Readonly<{ data: WidgetData }> | Readonly<{ error: string }>;

type HttpSource = Extract<WidgetSource, { kind: 'http' }>;

export async function readWidgetSource(
	source: WidgetSource,
	checkout: string,
	deps: SourceDeps,
	keys: Readonly<Record<string, string>>,
): Promise<SourceOutcome> {
	try {
		return widgetData(await sourceOutput(source, checkout, deps, keys));
	} catch (error) {
		return { error: masked(describeError(error), keys).trim().slice(0, ERROR_MAX_LENGTH) };
	}
}

async function sourceOutput(
	source: WidgetSource,
	checkout: string,
	deps: SourceDeps,
	keys: Readonly<Record<string, string>>,
): Promise<string> {
	switch (source.kind) {
		case 'github':
			return githubOutput(source.path, source.select, checkout, deps);
		case 'http': {
			const answer = await httpOutput(source, deps.fetch, keys);
			return source.select === null ? answer : selected(answer, source.select, deps);
		}
		case 'retired':
			throw failed(
				'Widgets read APIs now, not scripts or MCP tools. Ask the agent to move this one.',
			);
		case 'plan':
			throw failed('Malini draws the plan itself.');
	}
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

async function httpOutput(
	source: HttpSource,
	fetch: Fetch,
	keys: Readonly<Record<string, string>>,
): Promise<string> {
	const site = widgetSite(source.url);
	const headers = new Headers(
		Object.entries(source.headers).map(([name, value]) => [name, fillWidgetKeys(value, keys)]),
	);
	if (source.body !== null && !headers.has('content-type')) {
		headers.set('content-type', 'application/json');
	}
	const signal = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
	try {
		const response = await fetch(source.url, {
			method: source.method,
			headers,
			...(source.body === null ? {} : { body: JSON.stringify(source.body) }),
			redirect: 'manual',
			signal,
		});
		const answer = (await readBounded(response, ANSWER_MAX_BYTES)).toString('utf8');
		if (response.status >= 300 && response.status < 400) {
			throw failed(`${site} redirected the request. Save the address it redirects to.`);
		}
		if (!response.ok) throw failed(`${site} answered ${response.status}.${detail(answer)}`);
		return answer;
	} catch (error) {
		if (error instanceof WidgetError) throw error;
		if (signal.aborted) throw failed(`${site} did not answer within 20 s.`);
		if (error instanceof DownloadError && error.kind === 'too-large') {
			throw failed(`${site} answered with more than 5 MB.`);
		}
		throw failed(`${site} did not answer: ${describeError(error)}`);
	}
}

async function selected(text: string, select: string, deps: SourceDeps): Promise<string> {
	const folder = await mkdtemp(join(tmpdir(), 'malini-widget-'));
	try {
		const input = join(folder, 'answer.json');
		await writeFile(input, text);
		const run = await runBounded(deps.runner, 'jq', ['-c', select, input], {
			deadline: Date.now() + SOURCE_TIMEOUT_MS,
			env: deps.environment(),
		}).catch(() => {
			throw failed('`select` needs jq. macOS 15 has it; on older macOS run `brew install jq`.');
		});
		if (run.exitCode === null) throw failed('jq ran past 20 s and was stopped.');
		if (run.exitCode !== 0) {
			throw failed(lastLine(run.stderr) || `jq exited with status ${run.exitCode}.`);
		}
		return run.stdout;
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
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

function detail(answer: string): string {
	const flat = answer.replace(/\s+/gu, ' ').trim();
	return flat === '' ? '' : ` ${flat.slice(0, ANSWER_DETAIL_MAX_LENGTH)}`;
}

function masked(text: string, keys: Readonly<Record<string, string>>): string {
	return Object.values(keys).reduce(
		(shown, value) => (value === '' ? shown : shown.replaceAll(value, '[secret]')),
		text,
	);
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
