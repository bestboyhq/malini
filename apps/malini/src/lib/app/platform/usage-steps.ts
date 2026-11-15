import type { ShipStateRecord } from '$contract/pull-requests';
import { USAGE_STEPS, type UsageStep } from '$contract/system';
import type { CommandOutcome } from '$main/ipc/registry';

export type UsageProps = Readonly<Record<string, string | number>>;

const SETUP_STEPS: Readonly<Record<string, string>> = {
	'repositories.pick-folder': 'pick_folder',
	'repositories.connect': 'connect',
	'repositories.list-github-repositories': 'list_repositories',
	'repositories.create-github-repository': 'create_github_repository',
	'repositories.create-repository': 'clone',
	'repositories.read-base-branch': 'read_base',
	'repositories.create-workstream': 'workstream',
	'repositories.sync-workstream-base': 'sync_base',
	'repositories.provision-dependencies': 'dependencies',
	'chat.start-session': 'start_session',
	'chat.send-prompt': 'send_prompt',
};

const RESULT_OUTCOMES = [
	'current',
	'advanced',
	'diverged',
	'cancelled',
	'skipped',
	'already-running',
	'succeeded',
	'failed',
	'aborted',
];

const SKIP_REASONS = ['already-installed', 'no-manifest', 'unrecognized-project'];

const MAX_VALUE_CHARS = 60;

export function isUsageStep(args: unknown): args is UsageStep {
	if (typeof args !== 'object' || args === null) return false;
	const step: unknown = Reflect.get(args, 'step');
	const value: unknown = Reflect.get(args, 'value');
	return Object.entries(USAGE_STEPS).some(
		([name, values]) => name === step && values.some((known) => known === value),
	);
}

export function setupStep(outcome: CommandOutcome): UsageProps | null {
	const step = SETUP_STEPS[outcome.command];
	if (step === undefined) return null;
	const seconds = Math.round(outcome.durationMs / 1000);
	if (!outcome.ok) {
		const { name, kind, code } = outcome.failure;
		return {
			step,
			outcome: 'failed',
			seconds,
			error: clip(name),
			stage: clip(kind ?? 'unknown'),
			...(code === null ? {} : { code: clip(code) }),
		};
	}
	const reason = known(field(outcome.result, 'reason'), SKIP_REASONS);
	return {
		step,
		outcome: resultOutcome(outcome.result),
		seconds,
		...(reason === null ? {} : { reason }),
	};
}

export function shipBlock(state: ShipStateRecord | null): UsageProps | null {
	if (state === null) return null;
	if (state.needsYou) return { by: 'needs_you', reason: state.needsYou.reason };
	if (state.waitsFor) return { by: 'waits_for', reason: state.waitsFor };
	if (state.failures > 0) return { by: 'failing', reason: state.step ?? state.phase };
	return null;
}

function resultOutcome(result: unknown): string {
	if (result === null) return 'cancelled';
	return known(result, RESULT_OUTCOMES) ?? known(field(result, 'status'), RESULT_OUTCOMES) ?? 'ok';
}

function field(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function known(value: unknown, allowed: readonly string[]): string | null {
	return allowed.find((candidate) => candidate === value) ?? null;
}

export function clip(value: string): string {
	return value.slice(0, MAX_VALUE_CHARS);
}
