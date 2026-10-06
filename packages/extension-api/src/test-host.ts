import { mkdtemp, mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
	assertExtensionManifest,
	extensionPanelInstanceParts,
	type ExtensionManifest,
	type ExtensionSettingManifest,
} from './manifest.js';
import { ExtensionRegistry } from './registry.js';
import type {
	ExtensionAPI,
	ExtensionModule,
	ExtensionDeactivationReason,
	ExtensionCommandRegistration,
	ExtensionDisposable,
	ExtensionPanelRegistration,
	ExtensionPullRequestContext,
	ExtensionPullRequestCheckDiagnostics,
	ExtensionPullRequestReviewFeedback,
	ExtensionPullRequestTextUpdate,
	ExtensionRepositoryDiff,
	ExtensionRepositoryStatus,
	ExtensionSettingValue,
	ExtensionSettingChange,
	ExtensionSettingScope,
	ExtensionWorkflowRegistration,
	ExtensionWorkstreamEnsureInput,
	ExtensionWorkstreamSummary,
	ExtensionWorkstream,
	MaybePromise,
} from './types.js';

export type ExtensionRunRecord = {
	sequence: number;
	at: number;
	kind: string;
	payload: unknown;
};

export type TestFixtureRepository = {
	name: string;
	files: Readonly<Record<string, string>>;
	branch?: string;
	baseBranch?: string;
};

export type TestHostOptions = {
	manifest: unknown;
	fixtureRepository?: TestFixtureRepository;
	now?: number;
	secrets?: Readonly<Record<string, string>>;
	workstreams?: readonly ExtensionWorkstreamSummary[];
	ensureWorkstream?: (
		input: ExtensionWorkstreamEnsureInput,
	) => MaybePromise<ExtensionWorkstreamSummary>;
	repository?: {
		status?: Partial<ExtensionRepositoryStatus>;
		diffs?: readonly ExtensionRepositoryDiff[];
		uncommittedDiffs?: readonly ExtensionRepositoryDiff[];
		pullRequest?: Partial<ExtensionPullRequestContext>;
		reviewFeedback?: ExtensionPullRequestReviewFeedback;
		checkDiagnostics?: ExtensionPullRequestCheckDiagnostics;
		supportsPullRequestMutations?: boolean;
		pullRequestGate?: () => Promise<void>;
	};
	replay?: readonly ExtensionRunRecord[];
};

export type TestHostSnapshot = {
	panels: readonly string[];
	panelRegistrations: Readonly<Record<string, ExtensionPanelRegistration>>;
	commands: readonly string[];
	settings: Readonly<Record<string, ExtensionSettingValue>>;
	workflows: readonly string[];
	notifications: readonly { title: string; body: string; level?: string }[];
	recording: readonly ExtensionRunRecord[];
};

export type ExtensionTestHost = {
	readonly api: ExtensionAPI;
	readonly manifest: ExtensionManifest;
	readonly workstream: ExtensionWorkstream;
	activate(module: ExtensionModule): Promise<void>;
	deactivate(reason?: ExtensionDeactivationReason): Promise<void>;
	reload(): Promise<void>;
	emit<T>(event: string, payload: T): Promise<void>;
	invokeCommand<T = unknown>(id: string, ...args: readonly unknown[]): Promise<T>;
	runWorkflow<T = unknown>(
		id: string,
		input?: Readonly<Record<string, unknown>>,
		signal?: AbortSignal,
	): Promise<T>;
	advanceBy(ms: number): void;
	editPullRequestOnGithub(edit: Readonly<{ title?: string; body?: string }>): void;
	setWorkstream(workstream: Partial<ExtensionWorkstream> & { id: string }): Promise<void>;
	snapshot(): TestHostSnapshot;
	recording(): readonly ExtensionRunRecord[];
	assertClean(): void;
	assertReplayComplete(): void;
	cleanup(): Promise<void>;
};

export async function createTestHost(options: TestHostOptions): Promise<ExtensionTestHost> {
	const manifest = assertExtensionManifest(options.manifest);
	const root = await mkdtemp(join(tmpdir(), 'malini-extension-'));
	const repository = options.fixtureRepository ?? { name: 'fixture', files: {} };
	const repositoryPath = join(root, repository.name);
	await mkdir(repositoryPath, { recursive: true });
	for (const [path, contents] of Object.entries(repository.files)) {
		const target = safePath(repositoryPath, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, contents, 'utf8');
	}

	const workstream: ExtensionWorkstream = {
		id: 'workstream-1',
		path: repositoryPath,
		repositoryPath,
		repositoryFullName: repository.name,
		branch: repository.branch ?? 'feature/test',
		baseBranch: repository.baseBranch ?? 'main',
	};
	const registry = new ExtensionRegistry();
	const panels = new Map<string, ExtensionPanelRegistration>();
	const commands = new Map<string, ExtensionCommandRegistration>();
	const settingDefinitions = new Map<string, ExtensionSettingManifest>();
	const settings = new Map<string, ExtensionSettingValue>();
	const settingListeners = new Set<(change: ExtensionSettingChange) => unknown>();
	const state = new Map<string, unknown>();
	const workflows = new Map<string, ExtensionWorkflowRegistration>();
	const listeners = new Map<string, Set<(payload: unknown) => unknown>>();
	const notifications: Array<{ title: string; body: string; level?: string }> = [];
	const secrets = new Map(Object.entries(options.secrets ?? {}));
	const records: ExtensionRunRecord[] = [];
	const expectedReplay = options.replay ? [...options.replay] : null;
	let replayCursor = 0;
	let now = options.now ?? 1_700_000_000_000;
	let nextId = 1;
	let loadedModule: ExtensionModule | null = null;
	let registered = false;
	let pullRequestState: ExtensionPullRequestContext | null = null;
	let pullRequestBody = '';

	const currentPullRequest = (): ExtensionPullRequestContext =>
		pullRequestState ?? {
			state: options.repository?.pullRequest?.state ?? 'not_open',
			number: options.repository?.pullRequest?.number ?? null,
			title: options.repository?.pullRequest?.title ?? null,
			url: options.repository?.pullRequest?.url ?? null,
			baseBranch: options.repository?.pullRequest?.baseBranch ?? workstream.baseBranch,
			headBranch: options.repository?.pullRequest?.headBranch ?? workstream.branch,
			headSha: options.repository?.pullRequest?.headSha ?? null,
			...(options.repository?.pullRequest?.mergeable === undefined
				? {}
				: { mergeable: options.repository.pullRequest.mergeable }),
			...(options.repository?.pullRequest?.mergeableState === undefined
				? {}
				: { mergeableState: options.repository.pullRequest.mergeableState }),
			behindBase: options.repository?.pullRequest?.behindBase ?? null,
			checks: options.repository?.pullRequest?.checks ?? 'unknown',
			checkItems: options.repository?.pullRequest?.checkItems ?? [],
			viewerCanMerge:
				options.repository?.pullRequest?.viewerCanMerge === undefined
					? Boolean(options.repository?.supportsPullRequestMutations)
					: options.repository.pullRequest.viewerCanMerge,
			allowedMergeMethods:
				options.repository?.pullRequest?.allowedMergeMethods ??
				(options.repository?.supportsPullRequestMutations ? ['squash'] : []),
			defaultMergeMethod: options.repository?.pullRequest?.defaultMergeMethod ?? null,
			reviewDecision: options.repository?.pullRequest?.reviewDecision ?? null,
			unresolvedReviewThreadCount:
				options.repository?.pullRequest?.unresolvedReviewThreadCount === undefined
					? 0
					: options.repository.pullRequest.unresolvedReviewThreadCount,
		};

	const declared = {
		panels: new Set(manifest.contributes?.panels?.map(({ id }) => id) ?? []),
		commands: new Set(manifest.contributes?.commands?.map(({ id }) => id) ?? []),
		settings: new Set(manifest.contributes?.settings?.map(({ id }) => id) ?? []),
		workflows: new Set(manifest.contributes?.workflows?.map(({ id }) => id) ?? []),
	};

	function record(kind: string, payload: unknown): void {
		const entry: ExtensionRunRecord = { sequence: records.length + 1, at: now, kind, payload };
		records.push(entry);
		if (expectedReplay) {
			const expected = expectedReplay[replayCursor];
			if (
				!expected ||
				expected.kind !== entry.kind ||
				stableJson(normalizeEphemeralPaths(expected.payload)) !==
					stableJson(normalizeEphemeralPaths(entry.payload))
			) {
				throw new Error(
					`Replay diverged at ${replayCursor + 1}: expected ${stableJson(expected)}, received ${stableJson(entry)}`,
				);
			}
			replayCursor += 1;
		}
	}

	function contributionDisposable<T>(
		kind: keyof typeof declared,
		id: string,
		registryMap: Map<string, T>,
		value: T,
	): ExtensionDisposable {
		if (!declared[kind].has(id)) {
			throw new Error(`${kind} contribution ${id} is not declared in manifest.json`);
		}
		if (registryMap.has(id)) throw new Error(`Duplicate ${kind} contribution: ${id}`);
		registryMap.set(id, value);
		record(`${kind}.register`, { id });
		return {
			dispose: () => {
				registryMap.delete(id);
				record(`${kind}.dispose`, { id });
			},
		};
	}

	function documentTemplate(panelId: string): ExtensionPanelRegistration | undefined {
		const parts = extensionPanelInstanceParts(panelId);
		if (!parts) return undefined;
		const declaration = manifest.contributes?.panels?.find(({ id }) => id === parts.templateId);
		return declaration?.instances === true ? panels.get(parts.templateId) : undefined;
	}

	function track(
		disposable: ExtensionDisposable,
		policy?: import('./registry.js').ExtensionLifecycleDisposePolicy,
	): ExtensionDisposable {
		return registry.track(manifest.id, disposable, policy);
	}

	const api: ExtensionAPI = {
		manifest,
		workstream: {
			current: () => workstream,
			listFiles: async (_glob, workstreamId) => {
				assertCurrentWorkstream(workstream, workstreamId);
				return listFiles(repositoryPath);
			},
			readFile: async (path, workstreamId) => {
				assertCurrentWorkstream(workstream, workstreamId);
				return readFile(safePath(repositoryPath, path), 'utf8');
			},
			readRepositoryFile: async (path, workstreamId) => {
				assertCurrentWorkstream(workstream, workstreamId);
				return readFile(safePath(repositoryPath, path), 'utf8');
			},
			writeFile: async (path, contents, workstreamId) => {
				assertCurrentWorkstream(workstream, workstreamId);
				const target = safePath(repositoryPath, path);
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, contents, 'utf8');
				record('workstream.writeFile', { path, contents });
			},
			stat: async (path, workstreamId) => {
				assertCurrentWorkstream(workstream, workstreamId);
				try {
					const result = await stat(safePath(repositoryPath, path));
					return {
						kind: result.isDirectory() ? 'directory' : 'file',
						size: result.size,
					};
				} catch (error) {
					if (isMissingFileError(error)) return null;
					throw error;
				}
			},
		},
		repository: {
			status: async (workstreamId) => {
				assertCurrentWorkstream(workstream, workstreamId);
				const status: ExtensionRepositoryStatus = {
					branch: options.repository?.status?.branch ?? workstream.branch,
					baseBranch: options.repository?.status?.baseBranch ?? workstream.baseBranch,
					dirtyPaths: options.repository?.status?.dirtyPaths ?? [],
					conflictedPaths: options.repository?.status?.conflictedPaths ?? [],
					conflictMarkerPaths: options.repository?.status?.conflictMarkerPaths ?? [],
					ahead: options.repository?.status?.ahead ?? 0,
					behind: options.repository?.status?.behind ?? 0,
					hasUpstream: options.repository?.status?.hasUpstream ?? true,
					mergeInProgress: options.repository?.status?.mergeInProgress ?? false,
					operationInProgress: options.repository?.status?.operationInProgress ?? null,
				};
				record('repository.status', status);
				return status;
			},
			diff: async (path, workstreamId, scope) => {
				assertCurrentWorkstream(workstream, workstreamId);
				const resolvedScope = scope ?? 'branch';
				const source =
					resolvedScope === 'uncommitted'
						? (options.repository?.uncommittedDiffs ?? options.repository?.diffs ?? [])
						: (options.repository?.diffs ?? []);
				const diffs = source.filter((entry) => path === undefined || entry.path === path);
				record('repository.diff', { path: path ?? null, scope: resolvedScope });
				return diffs;
			},
			pullRequest: async (workstreamId, query) => {
				assertCurrentWorkstream(workstream, workstreamId);
				await options.repository?.pullRequestGate?.();
				const current = currentPullRequest();
				const terminalWithoutExactBinding =
					query?.pullRequestNumber === undefined &&
					(current.state === 'closed' || current.state === 'merged');
				const context =
					terminalWithoutExactBinding ||
					(query?.pullRequestNumber !== undefined && query.pullRequestNumber !== current.number)
						? {
								...current,
								state: 'not_open' as const,
								number: null,
								title: null,
								url: null,
								headSha: null,
								mergeable: null,
								mergeableState: null,
								checks: 'none' as const,
								checkItems: [],
								viewerCanMerge: false,
								allowedMergeMethods: [],
								defaultMergeMethod: null,
								reviewDecision: null,
								unresolvedReviewThreadCount: 0,
							}
						: current;
				record('repository.pullRequest', { query: query ?? null, context });
				return context;
			},
			createPullRequest: async (input, workstreamId) => {
				assertCurrentWorkstream(workstream, workstreamId);
				if (!input.title.trim()) throw new Error('Pull request title cannot be empty');
				const context: ExtensionPullRequestContext = {
					state: input.draft ? 'draft' : 'open',
					number: options.repository?.pullRequest?.number ?? 1,
					title: input.title.trim(),
					url: options.repository?.pullRequest?.url ?? 'https://example.test/pull/1',
					baseBranch: input.baseBranch ?? workstream.baseBranch,
					headBranch: workstream.branch,
					headSha: options.repository?.pullRequest?.headSha ?? null,
					checks: 'pending',
					checkItems: [],
					viewerCanMerge:
						options.repository?.pullRequest?.viewerCanMerge === undefined
							? Boolean(options.repository?.supportsPullRequestMutations)
							: options.repository.pullRequest.viewerCanMerge,
					allowedMergeMethods:
						options.repository?.pullRequest?.allowedMergeMethods ??
						(options.repository?.supportsPullRequestMutations ? ['squash'] : []),
					defaultMergeMethod: options.repository?.pullRequest?.defaultMergeMethod ?? null,
					reviewDecision: null,
					unresolvedReviewThreadCount: 0,
				};
				pullRequestState = context;
				pullRequestBody = input.body ?? '';
				record('repository.createPullRequest', { input, context });
				return context;
			},
			...(options.repository?.supportsPullRequestMutations
				? {
						markPullRequestReadyForReview: async (input, workstreamId) => {
							assertCurrentWorkstream(workstream, workstreamId);
							const current = currentPullRequest();
							assertPullRequestNumber(current, input.number);
							if (current.state !== 'draft' && current.state !== 'open') {
								throw new Error('Only a draft pull request can be marked ready for review');
							}
							const context: ExtensionPullRequestContext = {
								...current,
								state: 'open',
							};
							pullRequestState = context;
							record('repository.markPullRequestReadyForReview', { input, context });
							return context;
						},
						updatePullRequestMetadata: async (input, workstreamId) => {
							assertCurrentWorkstream(workstream, workstreamId);
							const current = currentPullRequest();
							assertPullRequestNumber(current, input.number);
							const published = current.state === 'open' || current.state === 'draft';
							const owned = (text: string, update?: ExtensionPullRequestTextUpdate) =>
								published && update && text.trim() === update.expected.trim() ? update.next : null;
							const result = {
								title: owned(current.title ?? '', input.title),
								body: owned(pullRequestBody, input.body),
							};
							if (result.title !== null) pullRequestState = { ...current, title: result.title };
							if (result.body !== null) pullRequestBody = result.body;
							record('repository.updatePullRequestMetadata', { input, result });
							return result;
						},
						mergePullRequest: async (input, workstreamId) => {
							assertCurrentWorkstream(workstream, workstreamId);
							const current = currentPullRequest();
							assertPullRequestNumber(current, input.number);
							if (current.state === 'draft') {
								throw new Error('Draft pull requests must be marked ready before merging');
							}
							if (current.state !== 'open' && current.state !== 'merged') {
								throw new Error('Only an open pull request can be merged');
							}
							if (current.headSha && input.expectedHeadSha !== current.headSha) {
								throw new Error('Pull request head changed; refresh before merging');
							}
							const context: ExtensionPullRequestContext = {
								...current,
								state: 'merged',
							};
							pullRequestState = context;
							record('repository.mergePullRequest', { input, context });
							return context;
						},
					}
				: {}),
			...(options.repository?.reviewFeedback
				? {
						pullRequestReviewFeedback: async (input, workstreamId) => {
							assertCurrentWorkstream(workstream, workstreamId);
							assertDiagnosticPullRequestRevision(currentPullRequest(), input);
							const feedback = cloneReviewFeedback(options.repository!.reviewFeedback!);
							record('repository.pullRequestReviewFeedback', { input, feedback });
							return feedback;
						},
					}
				: {}),
			...(options.repository?.checkDiagnostics
				? {
						pullRequestCheckDiagnostics: async (input, workstreamId) => {
							assertCurrentWorkstream(workstream, workstreamId);
							assertDiagnosticPullRequestRevision(currentPullRequest(), input);
							const diagnostics = cloneCheckDiagnostics(options.repository!.checkDiagnostics!);
							record('repository.pullRequestCheckDiagnostics', { input, diagnostics });
							return diagnostics;
						},
					}
				: {}),
			refresh: async (workstreamId) => {
				assertCurrentWorkstream(workstream, workstreamId);
				record('repository.refresh', { workstreamId: workstreamId ?? workstream.id });
			},
			commit: async (message, workstreamId, run) => {
				assertCurrentWorkstream(workstream, workstreamId);
				record('repository.commit', run ? { message, run } : { message });
				return `commit-${nextId++}`;
			},
			push: async (workstreamId) => {
				assertCurrentWorkstream(workstream, workstreamId);
				record('repository.push', {});
				return workstream.branch;
			},
			pullLatest: async (baseBranch, workstreamId) => {
				assertCurrentWorkstream(workstream, workstreamId);
				const target = baseBranch?.trim() || workstream.baseBranch;
				record('repository.pullLatest', { baseBranch: target });
				return target;
			},
			abortOperation: async (workstreamId) => {
				assertCurrentWorkstream(workstream, workstreamId);
				record('repository.abortOperation', {});
			},
		},
		panels: {
			register: (panel) => track(contributionDisposable('panels', panel.id, panels, panel)),
			open: (panelId, options) => {
				if (!panels.has(panelId) && !documentTemplate(panelId)) {
					throw new Error(`Unknown panel contribution: ${panelId}`);
				}
				record('panels.open', { panelId, ...options });
			},
		},
		commands: {
			register: (command) =>
				track(contributionDisposable('commands', command.id, commands, command)),
			execute: async (id: string, ...args: readonly unknown[]) => {
				const command = commands.get(id);
				if (!command) throw new Error(`Unknown extension command: ${id}`);
				record('commands.execute', { id, args });
				return await command.handler(...args);
			},
		},
		settings: {
			register: (setting) => {
				const disposable = contributionDisposable(
					'settings',
					setting.id,
					settingDefinitions,
					setting,
				);
				const key = scopedKey(setting.id, defaultSettingScope(setting, workstream));
				if (!settings.has(key)) settings.set(key, setting.default);
				return track({
					dispose: async () => {
						await disposable.dispose();
						settings.delete(key);
					},
				});
			},
			get: (id: string, scope?: ExtensionSettingScope) => {
				const definition = settingDefinitions.get(id);
				if (!definition) throw new Error(`Unknown extension setting: ${id}`);
				const key = scopedKey(id, scope ?? defaultSettingScope(definition, workstream));
				if (!settings.has(key)) settings.set(key, definition.default);
				return settings.get(key) ?? definition.default;
			},
			set: async (id, value, scope) => {
				const definition = settingDefinitions.get(id);
				if (!definition) throw new Error(`Unknown extension setting: ${id}`);
				assertSettingValue(definition, value);
				const resolvedScope = scope ?? defaultSettingScope(definition, workstream);
				settings.set(scopedKey(id, resolvedScope), value);
				const change = { id, value, scope: resolvedScope };
				record('settings.set', change);
				for (const listener of settingListeners) await listener(change);
			},
			onDidChange: (listener) => {
				settingListeners.add(listener);
				return track({
					dispose: () => {
						settingListeners.delete(listener);
					},
				});
			},
		},
		state: {
			get: async (key: string, scope: ExtensionSettingScope = { kind: 'global' }) =>
				state.get(scopedKey(key, scope)) ?? null,
			set: async <T>(key: string, value: T, scope: ExtensionSettingScope = { kind: 'global' }) => {
				state.set(scopedKey(key, scope), value);
				record('state.set', { key, scope, value });
			},
			delete: async (key, scope = { kind: 'global' }) => {
				state.delete(scopedKey(key, scope));
				record('state.delete', { key, scope });
			},
		},
		workflows: {
			register: (workflow) =>
				track(contributionDisposable('workflows', workflow.id, workflows, workflow)),
		},
		events: {
			on: <T>(event: string, listener: (payload: T) => unknown) => {
				const group = listeners.get(event) ?? new Set();
				const opaqueListener = listener as (payload: unknown) => unknown;
				group.add(opaqueListener);
				listeners.set(event, group);
				return track({
					dispose: () => {
						group.delete(opaqueListener);
						if (group.size === 0) listeners.delete(event);
					},
				});
			},
			emit: async <T>(event: string, payload: T) => {
				record('events.emit', { event, payload });
				for (const listener of listeners.get(event) ?? []) await listener(payload);
			},
		},
		notifications: {
			show: async (input) => {
				notifications.push({ ...input });
				record('notifications.show', input);
			},
		},
		clock: {
			now: () => now,
			sleep: async (ms, signal) => {
				if (signal?.aborted) throw signal.reason ?? new Error('Sleep aborted');
				now += ms;
				record('clock.sleep', { ms });
			},
		},
		ids: {
			next: (prefix = 'id') => `${prefix}-${nextId++}`,
		},
		ui: {
			openExternal: async (url) => record('ui.openExternal', { url }),
		},
		navigation: {
			listWorkstreams: async () => {
				const workstreams =
					options.workstreams ??
					([
						{
							id: workstream.id,
							name: repository.name,
							branch: workstream.branch,
							...(workstream.repositoryFullName
								? { repositoryFullName: workstream.repositoryFullName }
								: {}),
						},
					] satisfies readonly ExtensionWorkstreamSummary[]);
				record('navigation.listWorkstreams', {});
				return workstreams.map((workstream) => ({ ...workstream }));
			},
			...(options.ensureWorkstream
				? {
						ensureWorkstream: async (input: ExtensionWorkstreamEnsureInput) => {
							record('navigation.ensureWorkstream', input);
							const workstream = await options.ensureWorkstream!(input);
							return { ...workstream };
						},
					}
				: {}),
			openWorkstream: async (input) => {
				if (!input.workstreamId.trim()) throw new Error('Workstream id cannot be empty');
				record('navigation.openWorkstream', input);
			},
		},
		secrets: {
			get: async (key) => secrets.get(key) ?? null,
			set: async (key, value) => {
				secrets.set(key, value);
				record('secrets.set', { key, value: '<redacted>' });
			},
			delete: async (key) => {
				secrets.delete(key);
				record('secrets.delete', { key });
			},
		},
		subscriptions: { add: track },
	};

	function ensureRegistered(module: ExtensionModule): void {
		if (registered) return;
		registry.register({ manifest, module, createAPI: () => api });
		registered = true;
	}

	return {
		api,
		manifest,
		workstream,
		activate: async (module) => {
			loadedModule = module;
			ensureRegistered(module);
			await registry.activate(manifest.id);
		},
		deactivate: async (reason) => registry.deactivate(manifest.id, reason),
		reload: async () => {
			if (!loadedModule) throw new Error('No extension module loaded');
			await registry.reload(manifest.id);
		},
		emit: (event, payload) => api.events.emit(event, payload),
		invokeCommand: async <T>(id: string, ...args: readonly unknown[]) =>
			expectValue<T>(await api.commands.execute(id, ...args)),
		runWorkflow: async <T>(
			id: string,
			input: Readonly<Record<string, unknown>> = {},
			signal = new AbortController().signal,
		) => {
			const workflow = workflows.get(id);
			if (!workflow) throw new Error(`Unknown extension workflow: ${id}`);
			const updates: unknown[] = [];
			record('workflows.execute', { id, input });
			return expectValue<T>(
				await workflow.run({
					workstream,
					input,
					report: (update) => {
						updates.push(update);
						record('workflows.update', { id, update });
					},
					signal,
				}),
			);
		},
		editPullRequestOnGithub: (edit) => {
			const current = currentPullRequest();
			if (edit.title !== undefined) pullRequestState = { ...current, title: edit.title };
			if (edit.body !== undefined) pullRequestBody = edit.body;
		},
		advanceBy: (ms) => {
			now += ms;
		},
		setWorkstream: async (nextWorkstream) => {
			const previous = { ...workstream };
			const current = { ...workstream, ...nextWorkstream };
			await api.events.emit('malini.workstream.changing', { previous, current });
			Object.assign(workstream, nextWorkstream);
			record('workstream.changed', { previous, current });
			await api.events.emit('malini.workstream.changed', { previous, current });
		},
		snapshot: () => ({
			panels: [...panels.keys()],
			panelRegistrations: Object.fromEntries(panels),
			commands: [...commands.keys()],
			settings: Object.fromEntries(
				[...settingDefinitions.entries()].map(([id, definition]) => [
					id,
					settings.get(scopedKey(id, defaultSettingScope(definition, workstream))) ??
						definition.default,
				]),
			),
			workflows: [...workflows.keys()],
			notifications: notifications.map((item) => ({ ...item })),
			recording: records.map((entry) => ({ ...entry })),
		}),
		recording: () => records.map((entry) => ({ ...entry })),
		assertClean: () => {
			const leaks = [
				panels.size ? `${panels.size} panel(s)` : '',
				commands.size ? `${commands.size} command(s)` : '',
				workflows.size ? `${workflows.size} workflow(s)` : '',
				listeners.size ? `${listeners.size} event listener group(s)` : '',
			].filter(Boolean);
			if (leaks.length > 0) throw new Error(`Extension cleanup leaked ${leaks.join(', ')}`);
		},
		assertReplayComplete: () => {
			if (expectedReplay && replayCursor !== expectedReplay.length) {
				throw new Error(`Replay ended at ${replayCursor}/${expectedReplay.length} records`);
			}
		},
		cleanup: async () => {
			const state = registry.get(manifest.id)?.state;
			if (state && state !== 'inactive')
				await registry.deactivate(manifest.id).catch(() => undefined);
			await rm(root, { recursive: true, force: true });
		},
	};
}

async function listFiles(root: string, directory = root): Promise<readonly string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const result: string[] = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) result.push(...(await listFiles(root, path)));
		else result.push(relative(root, path).split(sep).join('/'));
	}
	return result.sort();
}

function safePath(root: string, path: string): string {
	const target = resolve(root, path);
	if (target !== root && !target.startsWith(`${root}${sep}`)) {
		throw new Error(`Fixture path escapes repository: ${path}`);
	}
	return target;
}

function assertCurrentWorkstream(workstream: ExtensionWorkstream, workstreamId?: string): void {
	if (workstreamId !== undefined && workstreamId !== workstream.id) {
		throw new Error(`Unknown fixture workstream: ${workstreamId}`);
	}
}

function assertPullRequestNumber(context: ExtensionPullRequestContext, number: number): void {
	if (!Number.isSafeInteger(number) || number <= 0 || context.number !== number) {
		throw new Error(`Unknown pull request: ${number}`);
	}
}

function assertDiagnosticPullRequestRevision(
	context: ExtensionPullRequestContext,
	input: Readonly<{ number: number; expectedHeadSha: string }>,
): void {
	assertPullRequestNumber(context, input.number);
	if (!context.headSha || context.headSha !== input.expectedHeadSha) {
		throw new Error('Pull request head changed; refresh diagnostics before retrying');
	}
}

function cloneReviewFeedback(
	feedback: ExtensionPullRequestReviewFeedback,
): ExtensionPullRequestReviewFeedback {
	return {
		unresolvedThreads:
			feedback.unresolvedThreads === null
				? null
				: feedback.unresolvedThreads.map((thread) => ({
						...thread,
						comments: thread.comments.map((comment) => ({ ...comment })),
					})),
		requestedChangeReviews:
			feedback.requestedChangeReviews === null
				? null
				: feedback.requestedChangeReviews.map((review) => ({ ...review })),
		unresolvedThreadsComplete: feedback.unresolvedThreadsComplete,
		requestedChangeReviewsComplete: feedback.requestedChangeReviewsComplete,
		truncated: feedback.truncated,
	};
}

function cloneCheckDiagnostics(
	diagnostics: ExtensionPullRequestCheckDiagnostics,
): ExtensionPullRequestCheckDiagnostics {
	return {
		checkRuns:
			diagnostics.checkRuns === null
				? null
				: diagnostics.checkRuns.map((check) => ({
						...check,
						annotations:
							check.annotations === null
								? null
								: check.annotations.map((annotation) => ({ ...annotation })),
					})),
		checkRunsComplete: diagnostics.checkRunsComplete,
		commitStatuses:
			diagnostics.commitStatuses === null
				? null
				: diagnostics.commitStatuses.map((status) => ({ ...status })),
		commitStatusesComplete: diagnostics.commitStatusesComplete,
		truncated: diagnostics.truncated,
	};
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code?: unknown }).code === 'ENOENT'
	);
}

function assertSettingValue(
	definition: ExtensionSettingManifest,
	value: ExtensionSettingValue,
): void {
	if (definition.type === 'select') {
		if (
			typeof value !== 'string' ||
			!definition.options?.some((option) => option.value === value)
		) {
			throw new Error(`Invalid value for setting ${definition.id}`);
		}
		return;
	}
	if (typeof value !== definition.type)
		throw new Error(`Invalid value for setting ${definition.id}`);
}

function defaultSettingScope(
	definition: ExtensionSettingManifest,
	workstream: ExtensionWorkstream,
): ExtensionSettingScope {
	if (definition.scope === 'workstream') return { kind: 'workstream', id: workstream.id };
	if (definition.scope === 'repository')
		return { kind: 'repository', id: workstream.repositoryPath };
	return { kind: 'global' };
}

function scopedKey(key: string, scope: ExtensionSettingScope): string {
	return scope.kind === 'global' ? key : `${scope.kind}:${scope.id}:${key}`;
}

function stableJson(value: unknown): string {
	return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortObject);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, sortObject(entry)]),
	);
}

function normalizeEphemeralPaths(value: unknown): unknown {
	if (typeof value === 'string') {
		return value.replace(
			/(?:[A-Za-z]:)?[^\s"'`]*[\\/]malini-extension-[^\\/\s]+[\\/][^\\/\s]+/gu,
			'<workstream>',
		);
	}
	if (Array.isArray(value)) return value.map((entry) => normalizeEphemeralPaths(entry));
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [key, normalizeEphemeralPaths(entry)]),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectValue<T>(value: unknown): T;
function expectValue(value: unknown): unknown {
	return value;
}
