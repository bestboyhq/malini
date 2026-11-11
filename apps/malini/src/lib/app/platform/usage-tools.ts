import type { CommandOutcome, StartedCommand } from '$main/ipc/registry';

export type ToolActivity =
	| 'tool_install_started'
	| 'tool_install_finished'
	| 'tool_install_failed'
	| 'tool_sign_in_started'
	| 'tool_sign_in_finished'
	| 'tool_sign_in_cancelled'
	| 'tool_sign_in_failed';

export interface ToolEvent {
	readonly name: ToolActivity;
	readonly props: Readonly<Record<string, string | number>>;
}

interface ToolStep {
	readonly tool: 'claude_code' | 'github';
	readonly action: 'install' | 'sign_in';
}

const GITHUB_SIGN_IN_START = 'repositories.start-github-sign-in';

const BEGINS: Readonly<Record<string, ToolStep>> = {
	'providers.install-claude-code': { tool: 'claude_code', action: 'install' },
	'repositories.install-github-cli': { tool: 'github', action: 'install' },
	'providers.sign-in-to-claude': { tool: 'claude_code', action: 'sign_in' },
	[GITHUB_SIGN_IN_START]: { tool: 'github', action: 'sign_in' },
};

const ENDS: Readonly<Record<string, ToolStep>> = {
	...BEGINS,
	'repositories.finish-github-sign-in': { tool: 'github', action: 'sign_in' },
};

const MAX_VALUE_CHARS = 60;

export interface ToolTracker {
	begin(started: StartedCommand): ToolEvent | null;
	end(outcome: CommandOutcome): ToolEvent | null;
}

export function createToolTracker(clock: () => number = () => performance.now()): ToolTracker {
	const startedAt = new Map<string, number>();
	const attempts = new Map<string, number>();
	const keyOf = ({ tool, action }: ToolStep): string => `${tool}:${action}`;
	return {
		begin: ({ command }) => {
			const step = BEGINS[command];
			if (!step) return null;
			const key = keyOf(step);
			// ponytail: attempts count presses since launch; persist them if retries across restarts matter
			const attempt = (attempts.get(key) ?? 0) + 1;
			attempts.set(key, attempt);
			startedAt.set(key, clock());
			return {
				name: `tool_${step.action}_started`,
				props: { tool: step.tool, attempt },
			};
		},
		end: (outcome) => {
			const step = ENDS[outcome.command];
			if (!step || (outcome.ok && outcome.command === GITHUB_SIGN_IN_START)) return null;
			const key = keyOf(step);
			const began = startedAt.get(key);
			startedAt.delete(key);
			const props = {
				tool: step.tool,
				attempt: attempts.get(key) ?? 1,
				seconds: Math.round((began === undefined ? outcome.durationMs : clock() - began) / 1000),
			};
			if (!outcome.ok) {
				const { name, kind, code } = outcome.failure;
				return {
					name: `tool_${step.action}_failed`,
					props: {
						...props,
						stage: clip(kind ?? 'unknown'),
						error: clip(name),
						...(code === null ? {} : { code: clip(code) }),
					},
				};
			}
			return {
				name:
					step.action === 'sign_in' && outcome.result === 'cancelled'
						? 'tool_sign_in_cancelled'
						: `tool_${step.action}_finished`,
				props,
			};
		},
	};
}

function clip(value: string): string {
	return value.slice(0, MAX_VALUE_CHARS);
}
