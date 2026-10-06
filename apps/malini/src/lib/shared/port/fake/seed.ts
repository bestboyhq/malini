import type {
	AgentRunChangePatch,
	AgentSessionChangePatch,
	AgentSessionChanges,
	ProviderCapability,
	StagedAgentAttachment,
} from '$contract/agent';
import type { WorktreeOperation } from '$contract/repositories';
import type { ExtensionSourceSnapshot, ManagedExtensionSourceSnapshot } from '$contract/system';

export type FakeProject = {
	id: string;
	name: string;
	repoPath: string;
	defaultBranch: string;
	remoteUrl?: string | null;
};

export type FakeWorkstream = {
	id: string;
	projectId: string;
	name: string;
	path: string;
	branch: string;
	baseBranch: string;
	status: 'active' | 'paused' | 'merged' | 'archived';
	checkoutState?: 'healthy' | 'path-diverged' | 'missing' | 'not-a-checkout' | 'unresolvable';
	checkoutIssue?: string | null;
	resolvedPath?: string | null;
};

export type FakeAgentEvent = {
	type: string;
	runId?: string;
	sessionId?: string;
	[key: string]: unknown;
};

export type FakeAgentScriptContext = {
	sessionId: string;
	runId: string;
	prompt: string;
};

export type FakeAgentScriptStep =
	FakeAgentEvent | ((context: FakeAgentScriptContext) => FakeAgentEvent);

export type FakeAgentSessionSeed = {
	id: string;
	workstreamId: string;
	displayName?: string;
	model?: string;
	status?: 'idle' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';
	currentRunId?: string | null;
	startedAt?: string;
	archivedAt?: string | null;
};

export type FakeAgentEventSeed = {
	runId: string;
	seq?: number;
	event: FakeAgentEvent;
	ephemeral?: boolean;
};

export type FakeWorkstreamGitStatus = {
	branch: string;
	dirtyPaths: readonly string[];
	conflictedPaths?: readonly string[];
	conflictMarkerPaths?: readonly string[];
	ahead: number;
	behind: number;
	hasUpstream?: boolean;
	mergeInProgress?: boolean;
	operationInProgress?: WorktreeOperation | null;
	headSha?: string | null;
};

export type FakeWorkstreamChangeTotals = {
	additions: number;
	deletions: number;
	files?: number;
};

export type PlatformSeed = {
	projects?: readonly FakeProject[];
	workstreams?: readonly FakeWorkstream[];
	diffs?: Record<string, string>;
	workstreamFiles?: Record<string, readonly string[]>;
	workstreamFileContents?: Record<string, Readonly<Record<string, string>>>;
	createdWorkstreamFileContents?: Readonly<Record<string, string>>;
	stagedAgentAttachments?: Record<string, readonly StagedAgentAttachment[]>;
	removeStagedAgentAttachmentErrors?: Record<string, string>;
	workstreamStatuses?: Record<string, FakeWorkstreamGitStatus>;
	workstreamChangeTotals?: Record<string, FakeWorkstreamChangeTotals>;
	extensionSources?: readonly ExtensionSourceSnapshot[];
	managedExtensionSources?: readonly ManagedExtensionSourceSnapshot[];
	managedExtensionHistory?: Readonly<Record<string, readonly ManagedExtensionSourceSnapshot[]>>;
	extensionRecoveryMode?: boolean;
	settings?: Record<string, string>;
	secrets?: Record<string, string>;
	agentScript?: readonly FakeAgentScriptStep[];
	agentSessions?: readonly FakeAgentSessionSeed[];
	agentEvents?: Record<string, readonly FakeAgentEventSeed[]>;
	agentSessionChanges?: Readonly<Record<string, AgentSessionChanges>>;
	agentRunChangePatches?: Readonly<Record<string, Readonly<Record<string, AgentRunChangePatch>>>>;
	agentSessionChangePatches?: Readonly<
		Record<string, Readonly<Record<string, AgentSessionChangePatch>>>
	>;
	agentSessionBootstrapFailures?: number;
	agentSessionBootstrapError?: string;
	providerCapabilities?: readonly ProviderCapability[];
};

export const defaultDiff = [
	'diff --git a/src/fake-platform.ts b/src/fake-platform.ts',
	'index 0123abc..4567def 100644',
	'--- a/src/fake-platform.ts',
	'+++ b/src/fake-platform.ts',
	'@@ -1,3 +1,5 @@',
	' export const mode = "fake";',
	'+export const fakePlatform = true;',
	'+export const deterministic = true;',
	' export const owner = "malini";',
].join('\n');

export const defaultAgentScript: readonly FakeAgentScriptStep[] = [
	({ sessionId, runId }) => ({ type: 'run.started', runId, sessionId }),
	({ runId, prompt }) => ({
		type: 'assistant.message',
		runId,
		text: `I will work on: ${prompt}`,
	}),
	({ runId }) => ({
		type: 'tool.started',
		runId,
		name: 'Edit',
		input: { path: 'src/fake-platform.ts' },
	}),
	({ runId }) => ({
		type: 'tool.completed',
		runId,
		name: 'Edit',
		output: { ok: true },
	}),
	({ runId }) => ({ type: 'file.changed', runId, path: 'src/fake-platform.ts' }),
	({ runId }) => ({ type: 'run.completed', runId, summary: 'Fake platform script completed.' }),
];

export const defaultProviderCapabilities: readonly ProviderCapability[] = [
	{
		state: 'ready',
		installed: true,
		authenticated: true,
		version: '2.1.196',
		account: { email: 'dev@example.com', plan: 'Claude Max' },
		models: [
			{
				id: 'default',
				label: 'Default',
				description: 'Opus with 1M context · Best for everyday, complex tasks',
				efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
			},
			{
				id: 'sonnet',
				label: 'Sonnet',
				description: 'Efficient for routine tasks',
				efforts: ['low', 'medium', 'high', 'max'],
			},
			{ id: 'haiku', label: 'Haiku', description: 'Fastest for quick answers', efforts: [] },
		],
		defaultModel: 'default',
		message: 'Signed in as dev@example.com',
	},
];

export const defaultSeed: PlatformSeed = {
	providerCapabilities: defaultProviderCapabilities,
	projects: [
		{
			id: 'fake-project-malini',
			name: 'malini',
			repoPath: '/Users/dev/work/malini',
			defaultBranch: 'main',
		},
		{
			id: 'fake-project-design-system',
			name: 'design-system',
			repoPath: '/Users/dev/work/design-system',
			defaultBranch: 'main',
		},
	],
	workstreams: [
		{
			id: 'fake-workstream-chat',
			projectId: 'fake-project-malini',
			name: 'Chat',
			path: '/tmp/malini/worktrees/fake-workstream-chat',
			branch: 'malini/fake-workstream-chat',
			baseBranch: 'main',
			status: 'active',
		},
		{
			id: 'fake-workstream-files',
			projectId: 'fake-project-malini',
			name: 'Files tree',
			path: '/tmp/malini/worktrees/fake-workstream-files',
			branch: 'malini/fake-workstream-files',
			baseBranch: 'main',
			status: 'paused',
		},
		{
			id: 'fake-workstream-design-archived',
			projectId: 'fake-project-design-system',
			name: 'Archived popover',
			path: '/tmp/malini/worktrees/fake-workstream-design-archived',
			branch: 'malini/fake-workstream-design-archived',
			baseBranch: 'main',
			status: 'archived',
		},
	],
	diffs: {
		'*': defaultDiff,
	},
	settings: {
		'chat.default-model': 'haiku',
	},
	secrets: {},
	agentScript: defaultAgentScript,
};
