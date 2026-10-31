import type {
	AgentReasoningEffort,
	AgentSessionChanges,
	ProviderCapability,
} from '$contract/agent';
import type { ExtensionListing, InstalledExtension } from '$contract/marketplace';
import type {
	OwnerAvatar,
	PullRequestStatusDto,
	WorkstreamImageRead,
} from '$contract/repositories';
import type { DemoEmit, DemoHandlers } from './demo-bridge';
import { browserHandlers } from './demo-browser';
import { demoMediaUrl } from './demo-media';
import { DEMO_DAY, filesOf, OWNER, PROJECTS } from './demo-data';
import {
	clickShipButton,
	createLead,
	mergedPullRequest,
	pullRequestUrl,
	sendPrompt,
	sessionSummaries,
	shipOf,
	startSession,
	shipStates,
	transcript,
	workstreamOf,
	workstreams,
} from './demo-live';

const NOW = `${DEMO_DAY}T10:45:00.000Z`;

const DEMO_EXTENSIONS: readonly ExtensionListing[] = [
	{
		publisher: 'acme',
		name: 'postgres',
		displayName: 'Postgres',
		description: 'Agents read your schema and run read-only queries.',
		version: '1.2.0',
		publishedOn: DEMO_DAY,
		repository: null,
		mcpServers: [{ name: 'postgres', url: 'https://mcp.acme.dev/postgres' }],
		skills: ['query-plans'],
	},
	{
		publisher: 'acme',
		name: 'release-notes',
		displayName: 'Release notes',
		description: 'Writes release notes from the pull requests a merge brings in.',
		version: '0.4.1',
		publishedOn: DEMO_DAY,
		repository: null,
		mcpServers: [],
		skills: ['release-notes'],
	},
];

function demoExtension(publisher: string, name: string): ExtensionListing {
	const listing = DEMO_EXTENSIONS.find(
		(extension) => extension.publisher === publisher && extension.name === name,
	);
	if (!listing) throw new Error(`${publisher}/${name} is not in the marketplace.`);
	return listing;
}

function installedDemoExtension(listing: ExtensionListing): InstalledExtension {
	const { publishedOn: _publishedOn, ...installed } = listing;
	return { ...installed, enabled: true, withdrawn: false, installedAt: NOW };
}

async function readImage(path: string): Promise<WorkstreamImageRead> {
	const url = demoMediaUrl(path);
	if (!url) return { status: 'missing' };
	const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
	return {
		status: 'ready',
		bytes: { mediaType: path.endsWith('.mp4') ? 'video/mp4' : 'image/webp', data },
	};
}

async function ownerAvatar(): Promise<OwnerAvatar | null> {
	const url = demoMediaUrl(`${OWNER}.webp`);
	if (!url) return null;
	const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
	return { mediaType: 'image/webp', base64: btoa(String.fromCharCode(...bytes)) };
}

const EFFORTS: AgentReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const CLAUDE: ProviderCapability = {
	state: 'ready',
	installed: true,
	authenticated: true,
	version: '2.4.0',
	account: { plan: 'Max' },
	models: [
		{ id: 'claude-fable-5-1', label: 'Fable 5.1', description: '', efforts: EFFORTS },
		{ id: 'claude-opus-5-5', label: 'Opus 5.5', description: '', efforts: EFFORTS },
		{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', description: '', efforts: EFFORTS },
		{ id: 'claude-haiku-5-5', label: 'Haiku 5.5', description: '', efforts: EFFORTS },
	],
	defaultModel: 'claude-opus-5-5',
	message: '',
};

function sessionChanges(workstreamId: string, id: string): AgentSessionChanges {
	const workstream = workstreamOf(workstreamId);
	const runIds = workstream?.runs.map((run) => run.id) ?? [];
	const files = (workstream?.files ?? []).map((file) => ({ ...file, isBinary: false }));
	return {
		sessionId: id,
		runs: (workstream?.runs ?? []).map((run) => ({
			runId: run.id,
			beforeCommit: 'base',
			afterCommit: 'head',
			files,
			capturedAt: NOW,
		})),
		files: files.map((file) => ({ ...file, runIds })),
		beforeCommit: 'base',
		afterCommit: 'head',
		capturedAt: NOW,
	};
}

function pullRequestStatus(workstreamId: string): PullRequestStatusDto {
	const workstream = workstreamOf(workstreamId);
	const ship = shipOf(workstreamId);
	const landed = mergedPullRequest(workstreamId);
	const number = landed ?? ship?.pullRequestNumber ?? null;
	return {
		state: landed !== null ? 'merged' : number === null ? 'not_open' : 'open',
		number,
		url: number === null ? null : pullRequestUrl(workstreamId, number),
		title: workstream?.name ?? null,
		draft: ship?.phase === 'draft',
		headRef: workstream?.branch ?? '',
		baseRef: 'main',
		headSha: null,
		includesLocalHead: true,
		mergeable: true,
		mergeableState: 'clean',
		behindBase: 0,
		checksState: ship?.phase === 'queued' ? 'pending' : 'success',
		checks: [],
		viewerCanMerge: true,
		allowedMergeMethods: ['squash'],
		defaultMergeMethod: 'squash',
		reviewDecision: null,
		unresolvedReviewThreadCount: 0,
		updatedAt: NOW,
	};
}

function totals(workstreamId: string): { additions: number; deletions: number; files: number } {
	const files = workstreamOf(workstreamId)?.files ?? [];
	return {
		additions: files.reduce((sum, file) => sum + file.additions, 0),
		deletions: files.reduce((sum, file) => sum + file.deletions, 0),
		files: files.length,
	};
}

export const demoHandlers = (emit: DemoEmit): DemoHandlers => ({
	...browserHandlers(emit),
	'app.take-notification-target': () => null,
	'app.take-menu-command': () => null,
	'app.runtime-info': () => ({
		app: '1.0.0',
		electron: '',
		node: '',
		chrome: '',
		sqlite: '',
		dataDirectory: '',
	}),
	'app.theme-mode': () => undefined,
	'app.streaming': () => false,
	'app.update-status': () => ({ state: 'idle' }),
	'app.close-guard': () => undefined,
	'app.report-toast': () => ({ path: '', persistedAt: NOW, sizeBytes: 0, rotated: false }),
	'app.report-renderer-error': () => ({
		path: '',
		persistedAt: NOW,
		sizeBytes: 0,
		rotated: false,
	}),
	'app.list-settings': () => ({ 'sounds.finished': 'none', 'sounds.needs-you': 'none' }),
	'app.set-setting': () => undefined,
	'repositories.github-reach': () => 'ok',
	'repositories.github-auth-status': () => ({
		authenticated: true,
		installed: true,
		login: 'you',
		host: 'github.com',
		message: null,
	}),
	'repositories.list-repositories': () => PROJECTS,
	'repositories.list-workstreams': () => workstreams(),
	'repositories.create-lead': (args) => createLead(args),
	'repositories.list-archived-workstreams': () => [],
	'repositories.list-hidden': () => [],
	'repositories.list-clones': () => [],
	'repositories.owner-avatar': ({ owner }) => (owner === OWNER ? ownerAvatar() : null),
	'repositories.workstream-files': ({ workstreamId }) => filesOf(workstreamOf(workstreamId)),
	'repositories.workstream-change-totals': ({ workstreamId }) => totals(workstreamId),
	'repositories.workstream-snapshot': ({ workstreamId }) => ({
		patch: '',
		totals: totals(workstreamId),
	}),
	'repositories.workstream-status': ({ workstreamId }) => ({
		branch: workstreamOf(workstreamId)?.branch ?? 'main',
		dirtyPaths: (workstreamOf(workstreamId)?.files ?? []).map((file) => file.path),
		conflictedPaths: [],
		conflictMarkerPaths: [],
		ahead: 0,
		behind: 0,
		hasUpstream: false,
		mergeInProgress: false,
		operationInProgress: null,
		headSha: null,
	}),
	'pull-requests.ship-states': () => shipStates(),
	'pull-requests.button-clicked': (args) =>
		'workstreamIds' in args ? null : clickShipButton(emit, args.workstreamId, args.button),
	'pull-requests.status': ({ workstreamId }) => pullRequestStatus(workstreamId ?? ''),
	'repositories.sync-own-pull-requests': () => [],
	'repositories.read-workstream-image': ({ path }) => readImage(path),
	'repositories.workstream-diff': () => '',
	'repositories.base-files': () => [],
	'scratchpad.load': () => null,
	'chat.agent-capabilities': () => [CLAUDE],
	'chat.session-changes': ({ workstreamId, sessionId: id }) => sessionChanges(workstreamId, id),
	'chat.known-session-changes': ({ workstreamId, sessionId: id }) =>
		sessionChanges(workstreamId, id),
	'chat.tool-output': () => null,
	'extensions.stat-workstream-file': () => null,
	'extensions.list-workstream-files': ({ workstreamId }) =>
		filesOf(workstreamOf(workstreamId)).map((file) => file.path),
	'pull-requests.workstream-opened': () => null,
	'jobs.list-definitions': () => [],
	'jobs.list-runs': () => [],
	'jobs.list-decisions': () => [],
	'jobs.list-suggestions': () => [],
	'jobs.list-agent-actions': () => [],
	'secrets.list-requests': () => [],
	'secrets.list': () => [],
	'chat.list-sessions': ({ workstreamId }) => sessionSummaries(workstreamId),
	'chat.get-or-create-session': ({ workstreamId, model }) => startSession(workstreamId, model),
	'chat.start-session': ({ workstreamId, model }) => startSession(workstreamId, model),
	'chat.activate-session': () => undefined,
	'chat.send-prompt': ({ sessionId: id, prompt, clientRequestId }) =>
		sendPrompt(emit, id, prompt, clientRequestId),
	'chat.list-events': ({ sessionId: id, afterSeq }) =>
		transcript(id).filter((envelope) => envelope.seq > afterSeq),
	'chat.list-event-page': ({ sessionId: id, afterSeq }) => {
		const envelopes = transcript(id).filter((envelope) => envelope.seq > afterSeq);
		return { envelopes, startSeq: afterSeq, complete: true, overBudget: false };
	},
	'chat.agent-health': () => true,
	'chat.workstream-has-open-run': () => false,
	'chat.workstream-has-working-run': () => false,
	'chat.shell-runs': () => [],
	'chat.turned-off-mcp-servers': () => [],
	'chat.watch-mcp-servers': () => ({ servers: [], settled: true, turnedOff: [] }),
	'chat.list-permission-grants': () => [],
	'skills.list': () => [],
	'skills.usage': () => ({ since: null, uses: [], turnedOff: [], plugins: [] }),
	'stats.workstream-running': () => [],
	'stats.activity': () => ({
		today: DEMO_DAY,
		runs: 0,
		jobRuns: 0,
		agentSeconds: 0,
		runningAgents: 0,
		days: [],
		repositories: [],
	}),
	'stats.resources': () => ({ machineMemoryBytes: 32 * 1024 ** 3, samples: [] }),
	'sounds.list': () => [],
	'extensions.list-sources': () => [],
	'extensions.list-listings': () => ({ listings: DEMO_EXTENSIONS, unreachable: null }),
	'extensions.list-installed': () => [],
	'extensions.get-listing': ({ publisher, name }) => {
		const listing = demoExtension(publisher, name);
		return {
			listing,
			readme: null,
			versions: [{ version: listing.version, publishedOn: listing.publishedOn, yanked: false }],
		};
	},
	'extensions.install': ({ publisher, name }) =>
		installedDemoExtension(demoExtension(publisher, name)),
	'extensions.publishing': () => ({ signedIn: false, handle: null, extensions: [] }),
	'extensions.recovery-mode-enabled': () => false,
});
