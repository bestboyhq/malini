import type { Project, Repository, Workstream } from '$shared/repositories/repositories.api';
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';

const SESSION_ID = '01JCOREAGENTSESSION00000000A';
const RUN_ID = '01JCOREAGENTRUNCOMPATIBLE0000B';

export const projectsFixture: Project[] = [
	{
		id: '01JCOREPROJCORE0000000000000A',
		name: 'malini',
		repoPath: '/Users/dev/work/malini',
		defaultBranch: 'main',
	},
	{
		id: '01JCOREPROJCORE0000000000000B',
		name: 'design-system',
		repoPath: '/Users/dev/work/design-system',
		defaultBranch: 'main',
	},
	{
		id: '01JCOREPROJCORE0000000000000C',
		name: 'mobile-app',
		repoPath: '/Users/dev/work/mobile-app',
		defaultBranch: 'develop',
	},
	{
		id: '01JCOREPROJCORE0000000000000D',
		name: 'archive-bot',
		repoPath: '/Users/dev/work/archive-bot',
		defaultBranch: 'main',
	},
];

function projectId(index: number): string {
	const project = projectsFixture[index];
	if (!project) throw new Error(`projectsFixture has no entry ${index}`);
	return project.id;
}

export const workstreamsFixture: Workstream[] = [
	{
		id: '01JMALINIWORKSTREAMMALINI000000000A',
		projectId: projectId(0),
		name: 'Refactor auth',
		path: '/var/folders/malini/worktrees/01JMALINIWORKSTREAMMALINI000000000A',
		branch: 'malini/01JMALINIWORKSTREAMMALINI000000000A',
		baseBranch: 'main',
		status: 'active',
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: null,
	},
	{
		id: '01JMALINIWORKSTREAMMALINI000000000B',
		projectId: projectId(0),
		name: 'Split monorepo',
		path: '/var/folders/malini/worktrees/01JMALINIWORKSTREAMMALINI000000000B',
		branch: 'malini/01JMALINIWORKSTREAMMALINI000000000B',
		baseBranch: 'main',
		status: 'active',
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: null,
	},
	{
		id: '01JMALINIWORKSTREAMMALINI000000000C',
		projectId: projectId(1),
		name: 'Popover pass',
		path: '/var/folders/malini/worktrees/01JMALINIWORKSTREAMMALINI000000000C',
		branch: 'malini/01JMALINIWORKSTREAMMALINI000000000C',
		baseBranch: 'main',
		status: 'active',
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: null,
	},
	{
		id: '01JMALINIWORKSTREAMMALINI000000000D',
		projectId: projectId(2),
		name: 'Biometric prompt',
		path: '/var/folders/malini/worktrees/01JMALINIWORKSTREAMMALINI000000000D',
		branch: 'malini/01JMALINIWORKSTREAMMALINI000000000D',
		baseBranch: 'develop',
		status: 'paused',
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: null,
	},
	{
		id: '01JMALINIWORKSTREAMMALINI000000000E',
		projectId: projectId(0),
		name: 'Rate limiter',
		path: '/var/folders/malini/worktrees/01JMALINIWORKSTREAMMALINI000000000E',
		branch: 'malini/01JMALINIWORKSTREAMMALINI000000000E',
		baseBranch: 'main',
		status: 'merged',
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: null,
	},
	{
		id: '01JMALINIWORKSTREAMMALINI000000000F',
		projectId: projectId(3),
		name: '2024 purge',
		path: '/var/folders/malini/worktrees/01JMALINIWORKSTREAMMALINI000000000F',
		branch: 'malini/01JMALINIWORKSTREAMMALINI000000000F',
		baseBranch: 'main',
		status: 'archived',
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: null,
	},
];

export const repositoriesFixture: Repository[] = [
	{
		id: '01JMALINIREPOSITORYMALINI00000000A',
		fullName: 'bestboyhq/malini',
		defaultBranch: 'main',
		localPath: '/Users/dev/code/malini',
		remoteUrl: 'https://github.com/bestboyhq/malini.git',
		createdAt: '2026-06-14T09:00:00.000Z',
	},
	{
		id: '01JMALINIREPOSITORYMALINI00000000B',
		fullName: 'bestboyhq/design-system',
		defaultBranch: 'main',
		localPath: null,
		remoteUrl: 'https://github.com/bestboyhq/design-system.git',
		createdAt: '2026-06-15T11:20:00.000Z',
	},
];

export const agentEventsFixture: AgentEvent[] = [
	{ type: 'run.started', runId: RUN_ID, sessionId: SESSION_ID },
	{ type: 'plan.updated', runId: RUN_ID, text: 'Inspect repo + read README' },
	{ type: 'tool.started', runId: RUN_ID, name: 'Bash', input: { cmd: 'ls' } },
	{ type: 'command.started', runId: RUN_ID, command: 'ls -la' },
	{ type: 'command.output', runId: RUN_ID, stream: 'stdout', text: 'drwxr-xr-x  .git\n' },
	{ type: 'command.completed', runId: RUN_ID, command: 'ls -la', exitCode: 0 },
	{ type: 'tool.completed', runId: RUN_ID, name: 'Bash', output: { ok: true } },
	{ type: 'file.changed', runId: RUN_ID, path: 'src/chat/index.ts' },
	{ type: 'assistant.message', runId: RUN_ID, text: 'I will scaffold the domain.' },
	{ type: 'plan.updated', runId: RUN_ID, text: 'Write domain types next' },
	{ type: 'tool.started', runId: RUN_ID, name: 'WriteFile', input: { path: 'src/a.ts' } },
	{ type: 'file.changed', runId: RUN_ID, path: 'src/a.ts' },
	{ type: 'tool.completed', runId: RUN_ID, name: 'WriteFile', output: { ok: true } },
	{ type: 'usage.updated', runId: RUN_ID, inputTokens: 1234, outputTokens: 2401, costUsd: 0.0431 },
	{
		type: 'approval.requested',
		runId: RUN_ID,
		approvalId: 'appr_01H',
		reason: 'edit dependency manifest',
	},
	{ type: 'assistant.message', runId: RUN_ID, text: 'Approve and I will continue.' },
	{ type: 'tool.started', runId: RUN_ID, name: 'EditFile', input: { path: 'package.json' } },
	{ type: 'tool.completed', runId: RUN_ID, name: 'EditFile', output: { ok: true } },
	{ type: 'file.changed', runId: RUN_ID, path: 'package.json' },
	{ type: 'run.completed', runId: RUN_ID, summary: 'Scaffolded src/chat/*.' },
];

export const agentEventEnvelopesFixture: EventEnvelope[] = agentEventsFixture.map(
	(event, index) => ({
		sessionId: SESSION_ID,
		runId: RUN_ID,
		seq: index + 1,
		event,
	}),
);

export const unknownAgentEventsFixture: AgentEvent[] = [
	{ type: 'unknown', raw: { type: 'thinking.delta', data: 'partial thought' } },
	{ type: 'unknown', raw: { type: 'foo.bar', arbitrary: true } },
];
