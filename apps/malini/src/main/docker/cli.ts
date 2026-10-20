import { describeError } from '$main/errors';
import { buildSpawnEnvironment, resolveToolPath } from '$main/process/environment';
import { boundedRunSucceeded, runBounded, type ProcessRunner } from '$main/process/runner';
import { assertSafeLabelValue, LABEL_APP } from './labels';

export const DOCKER_PS_TIMEOUT_MS = 15_000;

const PS_FORMAT = '{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Labels}}';

export interface LiveContainer {
	id: string;
	name: string;
	state: string;
	labels: Record<string, string>;
}

export function dockerBinary(): string {
	return resolveToolPath('docker') ?? 'docker';
}

export function parseDockerPs(output: string): LiveContainer[] {
	const containers: LiveContainer[] = [];
	for (const line of output.split('\n')) {
		if (line.trim().length === 0) continue;
		const [id, name, state, rawLabels] = line.split('\t');
		if (id === undefined || name === undefined || state === undefined) continue;
		const trimmedId = id.trim();
		if (trimmedId.length === 0) continue;
		containers.push({
			id: trimmedId,
			name: name.trim(),
			state: state.trim(),
			labels: parseLabels(rawLabels ?? ''),
		});
	}
	return containers;
}

export function parseLabels(raw: string): Record<string, string> {
	const labels: Record<string, string> = {};
	for (const pair of raw.split(',')) {
		const trimmed = pair.trim();
		if (trimmed.length === 0) continue;
		const separator = trimmed.indexOf('=');
		if (separator === -1) continue;
		labels[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
	}
	return labels;
}

export async function listLiveContainers(runner: ProcessRunner): Promise<LiveContainer[]> {
	const run = await dockerPs(runner, ['--format', PS_FORMAT]);
	return parseDockerPs(run);
}

export async function labeledContainerIds(
	runner: ProcessRunner,
	bundleIdentifier: string,
): Promise<string[]> {
	assertSafeLabelValue('bundle identifier', bundleIdentifier);
	const run = await dockerPs(runner, [
		'--filter',
		`label=${LABEL_APP}=${bundleIdentifier}`,
		'--format',
		'{{.ID}}',
	]);
	return run
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

async function dockerPs(runner: ProcessRunner, tail: readonly string[]): Promise<string> {
	let run;
	try {
		run = await runBounded(runner, dockerBinary(), ['ps', '--all', '--no-trunc', ...tail], {
			deadline: Date.now() + DOCKER_PS_TIMEOUT_MS,
			env: buildSpawnEnvironment(),
		});
	} catch (error) {
		throw new Error(`could not run \`docker ps\`: ${describeError(error)}`);
	}
	if (!boundedRunSucceeded(run)) {
		throw new Error(`\`docker ps\` failed: ${run.stderr.trim()}`);
	}
	return run.stdout;
}
