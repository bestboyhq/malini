import type { FakeBridge } from './fake-bridge';
import {
	cloneProjects,
	cloneWorkstreams,
	cloneWorkstreamGitStatus,
	stableHash,
	uniqueSorted,
	type FakeState,
} from './state';
import {
	FAKE_APP_INSTANCE_ID,
	FAKE_BUNDLE_IDENTIFIER,
	FAKE_IMAGE_MEDIA_TYPES,
	FAKE_PIXEL_PNG_BASE64,
	FAKE_PIXEL_PNG_BYTES,
	fakeComposeSegment,
} from './fake-constants';
import type { FakeProject, FakeWorkstream } from './seed';
import type {
	AuthStatusDto,
	ConnectedRepositoryDto,
	ImportSource,
	ProjectDto,
	PullRequestStatusDto,
	WorkstreamDto,
	WorkstreamImageBytes,
} from '$contract/repositories';
import type { OwnedContainer } from '$contract/system';

const FAKE_CREATED_AT = '2026-01-01T00:00:00.000Z';

const FAKE_GITHUB_AUTH: AuthStatusDto = Object.freeze({
	authenticated: true,
	installed: true,
	login: 'fake-user',
	host: 'github.com',
	message: null,
});

export type FakeGithubState = {
	clones: ConnectedRepositoryDto[];
	nextCloneId: number;
	pullRequests: Map<string, PullRequestStatusDto>;
};

const githubStates = new WeakMap<FakeBridge, FakeGithubState>();

export function fakeGithubState(bridge: FakeBridge): FakeGithubState {
	const existing = githubStates.get(bridge);
	if (existing) return existing;
	const created: FakeGithubState = { clones: [], nextCloneId: 1, pullRequests: new Map() };
	githubStates.set(bridge, created);
	bridge.onReset(() => {
		created.clones = [];
		created.nextCloneId = 1;
		created.pullRequests.clear();
	});
	return created;
}

export function installRepositoriesFake(bridge: FakeBridge, state: FakeState): void {
	const emit = <T>(event: string, payload: T): void => {
		bridge.emit(event, payload);
	};

	bridge.define('repositories.owner-avatar', async () => null);

	installGithubFake(bridge);

	bridge.define('repositories.claim-docker-service', async (input) => {
		const composeProject =
			input.composeProject?.trim() ||
			`${fakeComposeSegment(input.repository)}-${fakeComposeSegment(input.scope)}`;
		return {
			bundleIdentifier: FAKE_BUNDLE_IDENTIFIER,
			appInstanceId: FAKE_APP_INSTANCE_ID,
			composeProject,
			overlay: {
				path: `/fake/app-data/docker-ownership/${composeProject}/${input.service}/compose-labels.yml`,
				labels: {
					'app.malini.app': FAKE_BUNDLE_IDENTIFIER,
					'app.malini.workstream': input.workstreamId,
					'app.malini.compose-project': composeProject,
					'app.malini.service': input.service,
					'app.malini.owner': input.owner,
				},
			},
			composeFiles: [`${input.repository}/compose.yaml`],
		};
	});

	bridge.define('repositories.record-owned-docker-containers', async (input) => {
		for (const container of input.containers) {
			state.ownedDockerContainers[container.containerId] = {
				containerId: container.containerId,
				containerName: container.containerName,
				state: 'running',
				bundleIdentifier: FAKE_BUNDLE_IDENTIFIER,
				appInstanceId: FAKE_APP_INSTANCE_ID,
				workstreamId: container.workstreamId ?? null,
				composeProject: container.composeProject,
				service: container.service,
				owner: dockerContainerOwner(container.owner),
				cwd: container.cwd,
				startedAt: new Date(0).toISOString(),
				appPid: 1,
				evidence: 'label-and-record',
				startedByThisInstance: true,
			};
		}
	});

	bridge.define('repositories.release-owned-docker-container', async (input) => {
		delete state.ownedDockerContainers[input.containerId];
	});

	bridge.define('repositories.list-owned-docker-containers', async () => {
		return Object.values(state.ownedDockerContainers).map((container) => ({ ...container }));
	});

	bridge.define('repositories.create-repository', async (input) => {
		const sanitizedName = deriveProjectName(input.repoUrl);
		const id = localProjectId(sanitizedName);
		const repoPath = `/tmp/malini/repositories/${sanitizedName}/base`;
		const project: FakeProject = {
			id,
			name: sanitizedName,
			repoPath,
			defaultBranch: 'main',
			remoteUrl: input.repoUrl,
		};
		state.projects = [project, ...state.projects.filter((existing) => existing.id !== id)];
		return repoPath;
	});

	bridge.define('repositories.create-workstream', async (input) => {
		const path = `/tmp/malini/workstreams/${input.workstreamId}`;
		const workstream: FakeWorkstream = {
			id: input.workstreamId,
			projectId: input.projectId,
			name: input.name,
			path,
			branch: `malini/${input.workstreamId}`,
			baseBranch: input.baseBranch,
			status: 'active',
		};
		state.workstreams = [
			workstream,
			...state.workstreams.filter((existing) => existing.id !== input.workstreamId),
		];
		const inheritedFiles = state.createdWorkstreamFileContents;
		state.workstreamFiles[input.workstreamId] = uniqueSorted([
			...Object.keys(inheritedFiles),
			...(state.workstreamFiles[input.workstreamId] ?? []),
		]);
		state.extensionWorkstreamFiles[input.workstreamId] = {
			...inheritedFiles,
			...(state.extensionWorkstreamFiles[input.workstreamId] ?? {}),
		};
		emit('repositories:workstream-created', { workstreamId: input.workstreamId, workstream });
		return path;
	});

	bridge.define('repositories.sync-workstream-base', () => 'current');

	bridge.define('repositories.provision-dependencies', async (input) => {
		const files = new Set(state.workstreamFiles[input.workstreamId] ?? []);
		const announce = (payload: Record<string, unknown>) =>
			emit('repositories:workstream-install-status', {
				type: 'repositories:workstream-install-status',
				workstreamId: input.workstreamId,
				...payload,
			});
		if (files.has('node_modules') || !files.has('package.json')) {
			const reason = files.has('node_modules') ? 'already-installed' : 'no-manifest';
			announce({ status: 'skipped', reason });
			return 'skipped';
		}
		const command = files.has('pnpm-lock.yaml')
			? 'pnpm install --frozen-lockfile'
			: files.has('package-lock.json')
				? 'npm ci'
				: null;
		if (!command) {
			announce({ status: 'skipped', reason: 'unrecognized-project' });
			return 'skipped';
		}
		announce({ status: 'running', command });
		announce({ status: 'succeeded', command });
		return 'succeeded';
	});

	bridge.define('repositories.archive-workstream', async (input) => {
		state.workstreams = state.workstreams.map((workstream) =>
			workstream.id === input.workstreamId ? { ...workstream, status: 'archived' } : workstream,
		);
		emit('repositories:workstream-removed', { workstreamId: input.workstreamId, archived: true });
		return { savedWork: null };
	});

	bridge.define('repositories.delete-workstream', async (input) => {
		state.workstreams = state.workstreams.filter(
			(workstream) => workstream.id !== input.workstreamId,
		);
		emit('repositories:workstream-removed', { workstreamId: input.workstreamId, deleted: true });
		return { savedWork: null };
	});

	bridge.define('repositories.remove', async (input) => {
		const github = fakeGithubState(bridge);
		const clone = github.clones.find((candidate) => candidate.id === input.repoId);
		const projectId = clone
			? localProjectId(deriveProjectName(`https://github.com/${clone.fullName}.git`))
			: input.repoId.replace(/^local:/u, '');
		const archived = state.workstreams.filter((workstream) => workstream.projectId === projectId);
		state.workstreams = state.workstreams.filter((workstream) => !archived.includes(workstream));
		state.projects = state.projects.filter((project) => project.id !== projectId);
		github.clones = github.clones.filter((candidate) => candidate !== clone);
		for (const workstream of archived) {
			emit('repositories:workstream-removed', { workstreamId: workstream.id, archived: true });
		}
	});

	bridge.define('repositories.reveal-workstream', async () => {});

	bridge.define('repositories.open-workstream-in-editor', async () => {});

	bridge.define('repositories.commit-workstream', async (input) => {
		return `fake-commit-${stableHash(`${input.workstreamId}:${input.message}`)}`;
	});

	bridge.define('repositories.push-workstream', async (input) => {
		const workstream = state.workstreams.find((entry) => entry.id === input.workstreamId);
		return workstream?.branch ?? `malini/${input.workstreamId}`;
	});

	bridge.define('repositories.pull-workstream', async (input) => {
		return input.baseBranch;
	});

	bridge.define('repositories.restart-workstream-on-base', async (input) => {
		const branch =
			state.workstreams.find((entry) => entry.id === input.workstreamId)?.branch ??
			`malini/${input.workstreamId}`;
		const { pullRequests } = fakeGithubState(bridge);
		for (const [key, status] of pullRequests) {
			if (key.endsWith(`:${branch}`) && status.state === 'merged') pullRequests.delete(key);
		}
		return branch;
	});

	bridge.define('repositories.abort-workstream-operation', async (input) => {
		const status = state.workstreamStatuses[input.workstreamId];
		if (!status) return;
		state.workstreamStatuses[input.workstreamId] = {
			...status,
			dirtyPaths: [],
			conflictedPaths: [],
			conflictMarkerPaths: [],
			mergeInProgress: false,
			operationInProgress: null,
		};
	});

	bridge.define('repositories.workstream-diff', async (input) => {
		const pathKey =
			input.path === null ? input.workstreamId : `${input.workstreamId}:${input.path}`;
		return state.diffs[pathKey] ?? state.diffs[input.workstreamId] ?? state.diffs['*'] ?? '';
	});

	bridge.define('repositories.workstream-files', async (input) => {
		return [...(state.workstreamFiles[input.workstreamId] ?? [])]
			.sort((left, right) => left.localeCompare(right))
			.map((path) => ({ path }));
	});

	bridge.define('repositories.base-files', async (input) => {
		const project = state.projects.find(({ repoPath }) => repoPath === input.repoPath);
		if (!project) throw new Error(`Unknown repository: ${input.repoPath}`);
		const workstream = state.workstreams.find(
			({ projectId, baseBranch }) => projectId === project.id && baseBranch === input.baseBranch,
		);
		return [...(workstream ? (state.workstreamFiles[workstream.id] ?? []) : [])].sort(
			(left, right) => left.localeCompare(right),
		);
	});

	bridge.define('repositories.read-workstream-image', async (input) => {
		const mediaType = FAKE_IMAGE_MEDIA_TYPES[input.path.split('.').pop()?.toLowerCase() ?? ''];
		if (!mediaType) return null;
		return {
			mediaType,
			base64: FAKE_PIXEL_PNG_BASE64,
			size: FAKE_PIXEL_PNG_BYTES,
		} satisfies WorkstreamImageBytes;
	});

	bridge.define('repositories.workstream-status', async (input) => {
		const workstream = state.workstreams.find((entry) => entry.id === input.workstreamId);
		return cloneWorkstreamGitStatus(
			state.workstreamStatuses[input.workstreamId] ?? {
				branch: workstream?.branch ?? `malini/${input.workstreamId}`,
				dirtyPaths: [],
				conflictedPaths: [],
				conflictMarkerPaths: [],
				ahead: 0,
				behind: 0,
				hasUpstream: true,
				mergeInProgress: false,
				operationInProgress: null,
			},
		);
	});

	bridge.define('repositories.workstream-change-totals', async (input) => {
		const totals = state.workstreamChangeTotals[input.workstreamId] ?? {
			additions: 0,
			deletions: 0,
			files: 0,
		};
		return { ...totals };
	});

	bridge.define('repositories.workstream-snapshot', async (input) => {
		const totals = state.workstreamChangeTotals[input.workstreamId] ?? {
			additions: 0,
			deletions: 0,
			files: 0,
		};
		return {
			patch: state.diffs[input.workstreamId] ?? state.diffs['*'] ?? '',
			totals: { ...totals },
		};
	});

	bridge.define('repositories.list-workstreams', async () =>
		cloneWorkstreams(state.workstreams).map(fakeWorkstreamDto),
	);

	bridge.define('repositories.list-repositories', async () =>
		cloneProjects(state.projects).map(fakeProjectDto),
	);
}

function installGithubFake(bridge: FakeBridge): void {
	const github = fakeGithubState(bridge);

	bridge.define('repositories.github-auth-status', async () => ({ ...FAKE_GITHUB_AUTH }));

	bridge.define('repositories.pick-folder', async () => null);

	bridge.define('repositories.list-clones', async () =>
		github.clones.map((clone) => ({ ...clone })),
	);

	bridge.define('repositories.list-github-repositories', async () => [
		{
			fullName: 'rabbits/hutch',
			description: 'Where the rabbits live.',
			cloneUrl: 'https://github.com/rabbits/hutch.git',
		},
		{
			fullName: 'rabbits/burrow',
			description: null,
			cloneUrl: 'https://github.com/rabbits/burrow.git',
		},
	]);

	bridge.define('repositories.connect', async (input) => {
		const identity = importSourceIdentity(input.source);
		const duplicate = github.clones.some(
			(clone) => clone.fullName.toLowerCase() === identity.fullName.toLowerCase(),
		);
		if (duplicate) throw new Error(`Repository ${identity.fullName} is already connected`);
		const clone: ConnectedRepositoryDto = {
			id: `fake-repo-${github.nextCloneId++}`,
			fullName: identity.fullName,
			defaultBranch: 'main',
			localPath: identity.localPath,
			remoteUrl: identity.remoteUrl,
			createdAt: new Date().toISOString(),
		};
		github.clones = [clone, ...github.clones];
		return { ...clone };
	});

	bridge.define('repositories.disconnect', async (input) => {
		github.clones = github.clones.filter((clone) => clone.id !== input.repoId);
	});
}

function importSourceIdentity(source: ImportSource): {
	fullName: string;
	localPath: string | null;
	remoteUrl: string | null;
} {
	if (source.kind === 'clone-url') {
		const url = source.url ?? '';
		return { fullName: fullNameFromRemoteUrl(url) ?? url, localPath: null, remoteUrl: url };
	}
	const path = source.path ?? '';
	const folder = path
		.replace(/[\\/]+$/u, '')
		.split(/[\\/]/u)
		.filter(Boolean)
		.at(-1);
	return { fullName: folder ?? path, localPath: path, remoteUrl: null };
}

function fullNameFromRemoteUrl(remoteUrl: string): string | null {
	const path = normalizeRemotePath(remoteUrl);
	if (!path) return null;
	const parts = path.split('/').filter(Boolean);
	if (parts.length < 2) return null;
	return `${parts.at(-2)}/${parts.at(-1)}`;
}

function localProjectId(projectName: string): string {
	return `local__${projectName}`;
}

function deriveProjectName(repoUrl: string): string {
	const pathish = normalizeRemotePath(repoUrl);
	if (pathish) {
		const parts = pathish.split('/').filter(Boolean);
		if (parts.length >= 2) {
			const owner = parts[parts.length - 2] ?? 'owner';
			const repo = parts[parts.length - 1] ?? 'repo';
			return sanitizeProjectSegment(`${owner}__${repo}`);
		}
	}

	return deriveLegacyProjectName(repoUrl);
}

function deriveLegacyProjectName(repoUrl: string): string {
	const withoutTrailingSlash = repoUrl.trimEnd().replace(/\/+$/u, '');
	const withoutGitSuffix = withoutTrailingSlash.endsWith('.git')
		? withoutTrailingSlash.slice(0, -4)
		: withoutTrailingSlash;
	return sanitizeProjectSegment(withoutGitSuffix.split('/').filter(Boolean).at(-1) ?? 'repo');
}

function normalizeRemotePath(repoUrl: string): string | null {
	const withoutTrailingSlash = repoUrl.trimEnd().replace(/\/+$/u, '');
	const withoutGitSuffix = withoutTrailingSlash.endsWith('.git')
		? withoutTrailingSlash.slice(0, -4)
		: withoutTrailingSlash;

	if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(withoutGitSuffix)) {
		return withoutGitSuffix.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//iu, '');
	}

	if (/^[^@\s]+@[^:\s]+:/u.test(withoutGitSuffix)) {
		return withoutGitSuffix.replace(/^[^@\s]+@[^:\s]+:/u, '');
	}

	return null;
}

function sanitizeProjectSegment(input: string): string {
	return Array.from(input)
		.map((character) => (/^[a-zA-Z0-9_-]$/u.test(character) ? character : '_'))
		.join('');
}

function dockerContainerOwner(owner: string): OwnedContainer['owner'] {
	if (owner === 'extension' || owner === 'workstream' || owner === 'shared') return owner;
	return null;
}

function fakeWorkstreamDto(workstream: FakeWorkstream): WorkstreamDto {
	return {
		id: workstream.id,
		projectId: workstream.projectId,
		name: workstream.name,
		path: workstream.path,
		branch: workstream.branch,
		baseBranch: workstream.baseBranch,
		status: workstream.status,
		createdAt: FAKE_CREATED_AT,
		checkoutState: workstream.checkoutState ?? 'healthy',
		checkoutIssue: workstream.checkoutIssue ?? null,
		resolvedPath: workstream.resolvedPath ?? null,
	};
}

function fakeProjectDto(project: FakeProject): ProjectDto {
	return {
		id: project.id,
		name: project.name,
		repoPath: project.repoPath,
		defaultBranch: project.defaultBranch,
		createdAt: FAKE_CREATED_AT,
		remoteUrl: project.remoteUrl ?? null,
	};
}
