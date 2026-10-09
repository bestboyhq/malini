import type { CommandName } from '$contract/commands';
import type { AgentEventEnvelope } from '$contract/agent';

export type UsageValue = string | number | boolean | null;

export type UsageProperties = Readonly<Record<string, UsageValue | undefined>>;

export type UsageEvent = Readonly<{ event: string; properties: UsageProperties }>;

type CommandUsage = false | ((args: unknown) => UsageProperties);

const plain = (): UsageProperties => ({});

export const COMMAND_USAGE: Readonly<Record<CommandName, CommandUsage>> = {
	'app.close-guard': false,
	'app.copy-text': false,
	'app.delete-secret': false,
	'app.destroy-window': false,
	'app.focus-window': false,
	'app.get-secret': false,
	'app.interface-scale': (args) => ({ scale: number(args, 'scale') }),
	'app.list-settings': false,
	'app.logical-viewport': false,
	'app.notification-permission-granted': false,
	'app.notify': false,
	'app.open-external-url': false,
	'app.recent-diagnostics': false,
	'app.report-renderer-error': (args) => ({
		screen: screenOf(text(field(args, 'payload'), 'route')),
	}),
	'app.report-toast': (args) => {
		const payload = field(args, 'payload');
		return { level: text(payload, 'level'), screen: screenOf(text(payload, 'route')) };
	},
	'app.request-notification-permission': plain,
	'app.runtime-identity': false,
	'app.runtime-info': false,
	'app.set-secret': false,
	'app.set-setting': false,
	'app.shutdown-gracefully': false,
	'app.shutdown-impact': false,
	'app.take-notification-target': false,
	'chat.activate-session': false,
	'chat.agent-capabilities': false,
	'chat.agent-health': false,
	'chat.answer-question': (args) => ({ answers: count(args, 'answers') }),
	'chat.archive-session': plain,
	'chat.cancel-run': plain,
	'chat.decide-approval': (args) => ({
		decision: text(args, 'decision'),
		scope: text(args, 'scope'),
	}),
	'chat.get-or-create-session': false,
	'chat.list-events': false,
	'chat.list-recent-events': false,
	'chat.list-sessions': false,
	'chat.pick-and-stage-attachments': plain,
	'chat.read-staged-attachment': false,
	'chat.redo-checkpoint-restore': plain,
	'chat.refresh-mcp-status': false,
	'chat.remove-staged-attachment': false,
	'chat.reset-workstream-runs': plain,
	'chat.restart-agent': plain,
	'chat.restore-checkpoint': plain,
	'chat.run-change-patch': false,
	'chat.send-prompt': (args) => {
		const profile = field(args, 'profile');
		return {
			prompt_length: text(args, 'prompt')?.length,
			attachments: count(args, 'attachmentIds'),
			context_files: count(args, 'contextFiles'),
			transcript_references: count(args, 'transcriptReferences'),
			element_references: count(args, 'elementReferences'),
			effort: text(profile, 'effort'),
			mode: text(profile, 'mode'),
		};
	},
	'chat.session-change-patch': false,
	'chat.session-changes': false,
	'chat.stage-attachment-bytes': false,
	'chat.stage-fork-transcript': plain,
	'chat.start-session': (args) => ({ model: text(args, 'model') }),
	'chat.workstream-has-open-run': false,
	'extensions.append-development-log': false,
	'extensions.list-managed': false,
	'extensions.list-sources': false,
	'extensions.list-workstream-files': false,
	'extensions.read-repository-file': false,
	'extensions.read-workstream-file': false,
	'extensions.recovery-mode-enabled': false,
	'extensions.rollback-managed': (args) => ({ extension: text(args, 'extensionId') }),
	'extensions.set-managed-enabled': (args) => ({
		extension: text(args, 'extensionId'),
		enabled: flag(args, 'enabled'),
	}),
	'extensions.stat-workstream-file': false,
	'extensions.write-workstream-file': false,
	'providers.run-claude-setup': (args) => ({ step: text(args, 'step') }),
	'pull-requests.check-diagnostics': false,
	'pull-requests.create': (args) => ({ draft: flag(args, 'draft') ?? false }),
	'pull-requests.mark-ready': plain,
	'pull-requests.merge': (args) => ({ merge_method: text(args, 'mergeMethod') }),
	'pull-requests.resolve-addressed-review-threads': plain,
	'pull-requests.review-feedback': false,
	'pull-requests.status': false,
	'pull-requests.update-metadata': false,
	'repositories.abort-workstream-operation': plain,
	'repositories.archive-workstream': plain,
	'repositories.base-files': false,
	'repositories.claim-docker-service': false,
	'repositories.commit-workstream': plain,
	'repositories.connect': (args) => ({ source: text(field(args, 'source'), 'kind') }),
	'repositories.create-repository': plain,
	'repositories.create-workstream': plain,
	'repositories.delete-workstream': plain,
	'repositories.disconnect': plain,
	'repositories.github-auth-status': false,
	'repositories.list-clones': false,
	'repositories.list-github-repositories': false,
	'repositories.list-owned-docker-containers': false,
	'repositories.list-repositories': false,
	'repositories.list-workstreams': false,
	'repositories.open-workstream-in-editor': plain,
	'repositories.owner-avatar': false,
	'repositories.pick-folder': false,
	'repositories.provision-dependencies': plain,
	'repositories.pull-workstream': plain,
	'repositories.push-workstream': plain,
	'repositories.restart-workstream-on-base': plain,
	'repositories.read-workstream-image': false,
	'repositories.record-owned-docker-containers': false,
	'repositories.release-owned-docker-container': false,
	'repositories.remove': plain,
	'repositories.reveal-workstream': plain,
	'repositories.sync-workstream-base': plain,
	'repositories.workstream-change-totals': false,
	'repositories.workstream-diff': false,
	'repositories.workstream-files': false,
	'repositories.workstream-snapshot': false,
	'repositories.workstream-status': false,
	'routines.confirm-run': plain,
	'routines.create-draft': (args) => ({
		origin: text(args, 'origin') ?? 'user',
		evidence: count(args, 'evidence'),
	}),
	'routines.delete': plain,
	'routines.demote': plain,
	'routines.dismiss-suggestion': plain,
	'routines.list': false,
	'routines.list-gated-runs': false,
	'routines.list-suggestions': false,
	'routines.promote': plain,
	'routines.record-gated-run': (args) => ({ trigger: text(args, 'event') }),
	'routines.reject-run': plain,
};

const USAGE_BY_NAME: Readonly<Record<string, CommandUsage>> = COMMAND_USAGE;

export function commandUsage(
	command: string,
	args: unknown,
	outcome: Readonly<{ durationMs: number; failure?: FailureShape }>,
): UsageEvent[] {
	const failure = outcome.failure;
	const failed: UsageEvent[] = failure
		? [
				{
					event: 'app.command-failed',
					properties: {
						command,
						duration_ms: outcome.durationMs,
						...failureProperties(failure),
					},
				},
			]
		: [];
	const describe = Object.hasOwn(COMMAND_USAGE, command) ? USAGE_BY_NAME[command] : undefined;
	if (!describe) return failed;
	return [
		{
			event: command,
			properties: {
				...describe(args),
				ok: !failure,
				duration_ms: outcome.durationMs,
				...(failure ? failureProperties(failure) : {}),
			},
		},
		...failed,
	];
}

type FailureShape = Readonly<{ name: string; code: string | null; kind: string | null }>;

function failureProperties(failure: FailureShape): UsageProperties {
	return { error_name: failure.name, error_code: failure.code, error_kind: failure.kind };
}

export function screenOf(route: string | undefined): string | undefined {
	if (route === undefined) return undefined;
	const [path = ''] = route.replace(/^#/, '').split(/[?#]/);
	const segments = path.split('/');
	if (segments[1] === 'workstreams' && segments[2]) segments[2] = ':workstreamId';
	return segments.join('/') || '/';
}

export interface RunUsageContext {
	now(): number;
	sessionModel(sessionId: string): string | null;
}

interface RunTally {
	readonly startedAt: number;
	readonly model: string | null;
	toolCalls: number;
	toolFailures: number;
	shellCommands: number;
	shellFailures: number;
	readonly files: Set<string>;
	approvals: number;
	questions: number;
	usage: UsageProperties;
}

const ERROR_TEXT_LIMIT = 200;

export class RunUsage {
	readonly #runs = new Map<string, RunTally>();
	readonly #context: RunUsageContext;

	constructor(context: RunUsageContext) {
		this.#context = context;
	}

	observe(envelope: AgentEventEnvelope): UsageEvent | null {
		const event = envelope.event;
		const type = text(event, 'type');
		const tally = this.#runs.get(envelope.runId);
		switch (type) {
			case 'run.started':
				return this.#start(envelope);
			case 'tool.completed':
				if (tally) {
					tally.toolCalls += 1;
					if (flag(event, 'isError')) tally.toolFailures += 1;
				}
				return null;
			case 'tool.failed':
				if (tally) {
					tally.toolCalls += 1;
					tally.toolFailures += 1;
				}
				return null;
			case 'command.completed':
				if (tally) {
					tally.shellCommands += 1;
					if (number(event, 'exitCode') !== 0) tally.shellFailures += 1;
				}
				return null;
			case 'file.changed': {
				const path = text(event, 'path');
				if (tally && path) tally.files.add(path);
				return null;
			}
			case 'approval.requested':
				if (tally) tally.approvals += 1;
				return null;
			case 'question.requested':
				if (tally) tally.questions += 1;
				return null;
			case 'usage.updated':
				if (tally) tally.usage = tokenUsage(event);
				return null;
			case 'run.completed':
				return this.#finish(envelope, 'chat.run-completed', {});
			case 'run.failed': {
				const error = text(event, 'error');
				return this.#finish(envelope, 'chat.run-failed', {
					cancelled: error === 'cancelled',
					error: error?.slice(0, ERROR_TEXT_LIMIT),
				});
			}
			default:
				return null;
		}
	}

	#start(envelope: AgentEventEnvelope): UsageEvent {
		const model = this.#context.sessionModel(envelope.sessionId);
		this.#runs.set(envelope.runId, {
			startedAt: this.#context.now(),
			model,
			toolCalls: 0,
			toolFailures: 0,
			shellCommands: 0,
			shellFailures: 0,
			files: new Set(),
			approvals: 0,
			questions: 0,
			usage: {},
		});
		return { event: 'chat.run-started', properties: { model, concurrent_runs: this.#runs.size } };
	}

	#finish(envelope: AgentEventEnvelope, event: string, outcome: UsageProperties): UsageEvent {
		const tally = this.#runs.get(envelope.runId);
		this.#runs.delete(envelope.runId);
		if (!tally) {
			return {
				event,
				properties: { ...outcome, model: this.#context.sessionModel(envelope.sessionId) },
			};
		}
		return {
			event,
			properties: {
				...outcome,
				...tally.usage,
				model: tally.model,
				duration_ms: Math.round(this.#context.now() - tally.startedAt),
				tool_calls: tally.toolCalls,
				tool_failures: tally.toolFailures,
				shell_commands: tally.shellCommands,
				shell_failures: tally.shellFailures,
				files_changed: tally.files.size,
				approvals: tally.approvals,
				questions: tally.questions,
			},
		};
	}
}

function tokenUsage(event: unknown): UsageProperties {
	return {
		input_tokens: number(event, 'inputTokens'),
		output_tokens: number(event, 'outputTokens'),
		cost_usd: number(event, 'costUsd'),
		context_tokens: number(event, 'contextTokens'),
		context_window_tokens: number(event, 'contextWindowTokens'),
	};
}

function field(source: unknown, key: string): unknown {
	return typeof source === 'object' && source !== null ? Reflect.get(source, key) : undefined;
}

function text(source: unknown, key: string): string | undefined {
	const value = field(source, key);
	return typeof value === 'string' ? value : undefined;
}

function number(source: unknown, key: string): number | undefined {
	const value = field(source, key);
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function flag(source: unknown, key: string): boolean | undefined {
	const value = field(source, key);
	return typeof value === 'boolean' ? value : undefined;
}

function count(source: unknown, key: string): number {
	const value = field(source, key);
	return Array.isArray(value) ? value.length : 0;
}
