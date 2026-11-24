import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	parseWidgetData,
	type WidgetData,
	type WidgetNeed,
	type WidgetSource,
} from '$contract/widgets';
import { describeError } from '$main/errors';
import { runBounded, type ProcessRunner } from '$main/process/runner';
import type { RepositoriesPlatform } from '$shared/repositories/repositories.platform';
import { WidgetError } from './widget-files';

export const SOURCE_TIMEOUT_MS = 20_000;
const ERROR_MAX_LENGTH = 300;

export type McpToolOutcome =
	| Readonly<{ kind: 'output'; text: string }>
	| Readonly<{ kind: 'missing' | 'needs-auth' | 'off' | 'no-tool' | 'not-read-only' }>
	| Readonly<{ kind: 'failed'; error: string }>;

export type McpToolCaller = (
	cwd: string,
	server: string,
	tool: string,
	args: Readonly<Record<string, unknown>>,
) => Promise<McpToolOutcome>;

export type SourceDeps = Readonly<{
	gh: RepositoriesPlatform['gh'];
	runner: ProcessRunner;
	environment: () => Readonly<Record<string, string>>;
	mcp: McpToolCaller;
}>;

export type SourceOutcome =
	Readonly<{ data: WidgetData }> | Readonly<{ error: string; need: WidgetNeed | null }>;

type McpSource = Extract<WidgetSource, { kind: 'mcp' }>;

class SourceNeed extends WidgetError {
	readonly need: WidgetNeed;

	constructor(need: WidgetNeed, message: string) {
		super('source-failed', message);
		this.need = need;
	}
}

export async function readWidgetSource(
	source: WidgetSource,
	checkout: string,
	deps: SourceDeps,
): Promise<SourceOutcome> {
	try {
		return widgetData(await sourceOutput(source, checkout, deps));
	} catch (error) {
		return {
			error: describeError(error).trim().slice(0, ERROR_MAX_LENGTH),
			need: error instanceof SourceNeed ? error.need : null,
		};
	}
}

function sourceOutput(source: WidgetSource, checkout: string, deps: SourceDeps): Promise<string> {
	if (source.kind === 'github') return githubOutput(source.path, source.select, checkout, deps);
	if (source.kind === 'mcp') return mcpOutput(source, checkout, deps);
	if (source.kind === 'command') {
		throw failed('Widgets read MCP servers now, not scripts. Ask the agent to move this one.');
	}
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

async function mcpOutput(source: McpSource, checkout: string, deps: SourceDeps): Promise<string> {
	const { server, tool } = source;
	const outcome = await deps.mcp(checkout, server, tool, source.arguments);
	switch (outcome.kind) {
		case 'output':
			return source.select === null ? outcome.text : selected(outcome.text, source.select, deps);
		case 'missing':
			throw new SourceNeed('add', `${server} is not one of your MCP servers.`);
		case 'needs-auth':
			throw new SourceNeed('sign-in', `${server} needs you to sign in.`);
		case 'off':
			throw new SourceNeed('turn-on', `${server} is turned off.`);
		case 'no-tool':
			throw failed(`${server} has no tool \`${tool}\`.`);
		case 'not-read-only':
			throw failed(`\`${tool}\` can change data, so a widget cannot run it.`);
		case 'failed':
			throw failed(outcome.error);
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
		return { error: 'The source did not print JSON.', need: null };
	}
	const data = parseWidgetData(parsed);
	return data === null
		? { error: 'The source printed JSON, but not an object.', need: null }
		: { data };
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
