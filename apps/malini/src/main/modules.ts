import type { BrowserWindow } from 'electron';
import { consolePlatformLog, platformLineSink } from '$main/diagnostics/platform-log';
import { describeError } from '$main/errors';
import { buildSpawnEnvironment } from '$main/process/environment';
import { createNodeProcessRunner } from '$main/process/runner';
import { AgentRunLeases } from '$lib/chat/chat.platform';
import type { FilePicker } from '$lib/chat/platform/attachments/picker';
import type { BridgeProcessFactory } from '$lib/chat/platform/agent/process';
import { registerChat, type ChatPlatform } from '$lib/chat/platform/register';
import { registerRepositories } from '$shared/repositories/platform/register';
import {
	restoreStrandedCheckouts,
	type RepositoriesPlatform,
} from '$shared/repositories/repositories.platform';
import { registerProviders } from '$shared/providers/platform/register';
import type { AppPlatform, ShellHost } from '$lib/app/app.platform';
import { resolveBootEnvironment } from '$lib/app/platform/boot-environment';
import { registerApp } from '$lib/app/platform/register';
import type { MainContext } from './context';
import type { ExtensionsPlatform } from '$lib/extensions/extensions.platform';
import { registerExtensions } from '$lib/extensions/platform/register';
import { registerPullRequests } from '$lib/pull-requests/platform/register';
import { registerRoutines } from '$lib/routines/platform/register';

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
	shutdown(): Promise<void>;
}

export async function registerModules(
	context: MainContext,
	options: ModuleOptions,
): Promise<Modules> {
	const overrides = options.overrides ?? {};
	const log = overrides.log ?? platformLineSink(consolePlatformLog());
	const processRunner = createNodeProcessRunner();
	const agentRunLeases = new AgentRunLeases();

	await restoreStrandedCheckouts(context.db, context.appDataRoot);
	const repositories = registerRepositories(context, {
		getMainWindow: options.getMainWindow,
		runner: processRunner,
		log,
		guardRunLease: async (workstreamId, teardown) => {
			const lease = agentRunLeases.acquireWorkstreamTeardown(context.db, workstreamId);
			try {
				return await teardown();
			} finally {
				lease.release();
			}
		},
		...(overrides.startupReclaim === undefined ? {} : { startupReclaim: overrides.startupReclaim }),
	});

	registerPullRequests(context);

	registerRoutines(context);

	registerProviders(context);

	await resolveBootEnvironment(context);

	const chat = await registerChat(context, {
		resolver: repositories.checkouts,
		leases: agentRunLeases,
		resolveWorkstreamCheckout: (workstreamId) =>
			repositories.checkouts.resolveCheckout(workstreamId),
		spawnEnvironment: buildSpawnEnvironment,
		log,
		...(overrides.filePicker ? { picker: overrides.filePicker } : {}),
		...(overrides.bridgeProcessFactory ? { processFactory: overrides.bridgeProcessFactory } : {}),
		...(overrides.bridgeScriptPath ? { bridgeScriptPath: overrides.bridgeScriptPath } : {}),
	});

	const app = registerApp(context, {
		getMainWindow: options.getMainWindow,
		...(overrides.shellHost ? { host: overrides.shellHost } : {}),
		ownership: repositories.ownership,
		runner: processRunner,
		cancelAgentRuns: () => chat.closeOpenRunsForExit(),
		containerCount: () => repositories.containerCount(),
		sessionModel: (sessionId) => chat.sessionModel(sessionId),
	});

	const extensions = registerExtensions(context, { resolver: repositories.checkouts });

	let shuttingDown: Promise<void> | null = null;
	const shutdown = (): Promise<void> => {
		shuttingDown ??= (async () => {
			repositories.watchers.dispose();
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
		shutdown,
	};
}
