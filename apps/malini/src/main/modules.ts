import { homedir } from 'node:os';
import type { BrowserWindow } from 'electron';
import { consolePlatformLog, platformLineSink } from '$main/diagnostics/platform-log';
import { describeError } from '$main/errors';
import { buildSpawnEnvironment } from '$main/process/environment';
import { createNodeProcessRunner } from '$main/process/runner';
import { registerBrowser } from '$lib/browser/platform/register';
import { AgentRunLeases, type Lease } from '$lib/chat/chat.platform';
import type { FilePicker } from '$lib/chat/platform/attachments/picker';
import type { BridgeProcessFactory } from '$lib/chat/platform/agent/process';
import { registerChat, type ChatPlatform } from '$lib/chat/platform/register';
import { registerRepositories } from '$shared/repositories/platform/register';
import {
	restoreStrandedCheckouts,
	type RepositoriesPlatform,
} from '$shared/repositories/repositories.platform';
import { registerProviders } from '$shared/providers/platform/register';
import { askForMicrophone, openMicrophoneSettings } from '$shared/sounds/platform/microphone';
import { registerSounds } from '$shared/sounds/platform/register';
import { pickSoundFile } from '$shared/sounds/platform/sound-file-dialog';
import { createElectronShellHost, type AppPlatform, type ShellHost } from '$lib/app/app.platform';
import { resolveBootEnvironment } from '$lib/app/platform/boot-environment';
import { followSavedThemeMode, registerApp } from '$lib/app/platform/register';
import type { MainContext } from './context';
import type { ExtensionsPlatform } from '$lib/extensions/extensions.platform';
import { registerExtensions } from '$lib/extensions/platform/register';
import { registerJobs } from '$lib/jobs/platform/register';
import { registerPullRequests } from '$lib/pull-requests/platform/register';
import { registerScratchpad } from '$lib/scratchpad/platform/register';
import { registerSecrets } from '$lib/secrets/platform/register';
import { claudeConfigFiles } from '$lib/skills/platform/claude-settings';
import { registerSkills } from '$lib/skills/platform/register';
import { registerStats } from '$lib/stats/platform/register';

export interface ModuleOptions {
	getMainWindow(): BrowserWindow | null;
	overrides?: ModuleOverrides;
}

export interface ModuleOverrides {
	readonly shellHost?: ShellHost;
	readonly filePicker?: FilePicker;
	readonly bridgeProcessFactory?: BridgeProcessFactory;
	readonly bridgeScriptPath?: string;
	readonly startupReclaim?: boolean;
	readonly log?: (line: string) => void;
}

export interface Modules {
	readonly repositories: RepositoriesPlatform;
	readonly app: AppPlatform;
	readonly extensions: ExtensionsPlatform;
	readonly chat: ChatPlatform;
	openUrl(url: string): void;
	shutdown(): Promise<void>;
}

async function leased<T>(acquire: () => Lease, body: () => Promise<T>): Promise<T> {
	const lease = acquire();
	try {
		return await body();
	} finally {
		lease.release();
	}
}

export async function registerModules(
	context: MainContext,
	options: ModuleOptions,
): Promise<Modules> {
	const overrides = options.overrides ?? {};
	const log = overrides.log ?? platformLineSink(consolePlatformLog());
	const processRunner = createNodeProcessRunner();
	const agentRunLeases = new AgentRunLeases();
	const shellHost = overrides.shellHost ?? createElectronShellHost();
	followSavedThemeMode(context.db, shellHost);

	await restoreStrandedCheckouts(context.db, context.appDataRoot);
	const stopBackgroundCommands = async (workstreamId: string): Promise<void> => {
		await chat.stopWorkstreamBackgroundCommands(workstreamId);
		await agentRunLeases.runChangeCaptureSettled(workstreamId);
	};
	const repositories = registerRepositories(context, {
		getMainWindow: options.getMainWindow,
		runner: processRunner,
		log,
		guardRunLease: async (workstreamId, teardown) => {
			await stopBackgroundCommands(workstreamId);
			return leased(
				() => agentRunLeases.acquireWorkstreamTeardown(context.db, workstreamId),
				async () => {
					await stats.stopWorkstreamLeftovers(workstreamId);
					return teardown();
				},
			);
		},
		guardCheckoutMove: (workstreamId, move) =>
			leased(() => agentRunLeases.acquireCheckoutMove(context.db, workstreamId), move),
		guardBranchUpdate: async (workstreamId, move) => {
			await stopBackgroundCommands(workstreamId);
			return leased(() => agentRunLeases.acquireCheckoutMove(context.db, workstreamId), move);
		},
		nameWorkstream: (task) => chat.nameWorkstream(task),
		...(overrides.startupReclaim === undefined ? {} : { startupReclaim: overrides.startupReclaim }),
	});

	const pullRequests = registerPullRequests(context, { runner: repositories.gh });

	registerScratchpad(context);

	registerSounds(context, {
		askForMicrophone,
		openMicrophoneSettings,
		pickSoundFile: () => pickSoundFile(options.getMainWindow()),
	});

	const providers = registerProviders(context);

	await resolveBootEnvironment(context);

	const browser = registerBrowser(context, { getMainWindow: options.getMainWindow });

	const secrets = registerSecrets(context, { sealer: shellHost });

	const extensions = registerExtensions(context, {
		resolver: repositories.checkouts,
		readCheckout: repositories.readCheckout,
		bestboy: () => stats.bestboy,
	});

	const chat = await registerChat(context, {
		resolver: repositories.checkouts,
		leases: agentRunLeases,
		secrets,
		extensions,
		resolveWorkstreamCheckout: (workstreamId) =>
			repositories.checkouts.resolveCheckout(workstreamId),
		spawnEnvironment: buildSpawnEnvironment,
		claudeSettings: () => claudeConfigFiles(buildSpawnEnvironment(), homedir()).settings,
		browser,
		theme: () => shellHost.theme(),
		shippingFailure: (workstreamId) => pullRequests.failure(workstreamId),
		log,
		...(overrides.filePicker ? { picker: overrides.filePicker } : {}),
		...(overrides.bridgeProcessFactory ? { processFactory: overrides.bridgeProcessFactory } : {}),
		...(overrides.bridgeScriptPath ? { bridgeScriptPath: overrides.bridgeScriptPath } : {}),
	});

	registerSkills(context, {
		listSkills: (cwd, turnedOff) => chat.listSkills(cwd, turnedOff),
		resolveCheckout: (workstreamId) => repositories.checkouts.resolveCheckout(workstreamId),
		claudeConfig: () => claudeConfigFiles(buildSpawnEnvironment(), homedir()),
	});

	const app = registerApp(context, {
		getMainWindow: options.getMainWindow,
		host: shellHost,
		ownership: repositories.ownership,
		runner: processRunner,
		cancelAgentRuns: () => chat.closeOpenRunsForExit(),
		containerCount: () => repositories.containerCount(),
	});

	const jobs = registerJobs(context, {
		suggestTitle: (task, job) => chat.suggestTitle(task, job),
		choose: (task, job, choices) => chat.choose(task, job, choices),
		shipping: pullRequests.shipping,
		resume: (event) => chat.resume(event),
		deliveries: (event) => chat.deliveries(event),
		deliver: async (wake) => {
			await chat.deliver({ ...wake, kind: 'report' });
		},
	});
	jobs.start();
	repositories.overlaps.start();
	app.announceUpdate();
	app.announceStart();

	const stats = registerStats(context, {
		runner: processRunner,
		browserTabs: () => browser.tabProcesses(),
		agentHostProcessId: () => chat.bridgeProcessId(),
		runningContainerIds: async () => {
			if (repositories.containerCount() === 0) return [];
			const containers = await repositories.listOwnedContainers();
			return containers
				.filter((container) => container.state === 'running')
				.map((container) => container.containerId);
		},
		stopBackgroundTask: (sessionId, taskId) => chat.stopBackgroundTask(sessionId, taskId),
		nameService: (task) => chat.nameService(task),
		openExternal: (url) => shellHost.openExternal(url),
		cipher: shellHost,
	});
	stats.start();
	extensions.start();
	app.streaming.start();

	let shuttingDown: Promise<void> | null = null;
	const shutdown = (): Promise<void> => {
		shuttingDown ??= (async () => {
			stats.stop();
			app.streaming.stop();
			pullRequests.dispose();
			jobs.dispose();
			repositories.watchers.dispose();
			repositories.overlaps.dispose();
			repositories.cancelGitHubSignIn();
			providers.stop();
			await chat.stop();
			try {
				const outcome = await app.shutdownGracefully();
				if (outcome.errors.length > 0) {
					log(
						`shutdown: ${outcome.errors.length} step(s) did not finish: ${outcome.errors.join('; ')}`,
					);
				}
			} catch (error) {
				log(`shutdown: graceful shutdown failed: ${describeError(error)}`);
			}
			await app.shutdownUsageData();
			await app.windowStateSaved();
		})();
		return shuttingDown;
	};

	return {
		repositories,
		app,
		extensions,
		chat,
		openUrl: (url) => stats.openUrl(url),
		shutdown,
	};
}
