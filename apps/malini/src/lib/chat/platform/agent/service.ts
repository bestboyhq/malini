import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
	REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL,
	type WorkstreamRenamedPayload,
} from '$contract/events';
import type { MainContext } from '$main/context';
import { IdSequence } from '../id-sequence';
import type { AgentRunLeases } from './lifecycle';
import { defineBridgeCommands, type SendPromptHooks } from './commands';
import { reapOrphansOnExit, reapOrphansOnStartup } from './lifecycle';
import { createElectronNodeProcessFactory, type BridgeProcessFactory } from './process';
import { BridgeRuntime, type BridgeRuntimeHooks } from './runtime';
import type { BridgeHealth, BridgeSupervisor } from './supervisor';

export interface AgentServiceDeps {
	readonly processFactory?: BridgeProcessFactory;
	readonly spawnEnvironment: () => Readonly<Record<string, string>>;
	readonly leases: AgentRunLeases;
	readonly bridgeScriptPath?: string;
	readonly verifyAttachment?: SendPromptHooks['verifyAttachment'];
	readonly collectAttachmentGarbage?: SendPromptHooks['collectAttachmentGarbage'];
	readonly hooks: BridgeRuntimeHooks & Pick<SendPromptHooks, 'captureCheckpoint'>;
	readonly log?: (line: string) => void;
}

export interface AgentService {
	readonly runtime: BridgeRuntime;
	readonly bridgeScriptPath: string;
	readonly started: boolean;
	health(): BridgeHealth;
	ensureReady(): Promise<BridgeSupervisor>;
	stop(): Promise<void>;
	closeOpenRunsForExit(): Promise<number>;
}

export function selectBridgeScriptPath(resourcesRoot: string, isDev: boolean): string {
	const bundled = join(resourcesRoot, 'agent-bridge', 'cli.js');
	if (existsSync(bundled)) return bundled;
	if (isDev) {
		let dir = resolve(resourcesRoot);
		for (let depth = 0; depth < 5; depth += 1) {
			const candidate = join(dir, 'packages', 'agent-bridge', 'dist', 'cli.js');
			if (existsSync(candidate)) return candidate;
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	return bundled;
}

export function missingBridgeScriptMessage(path: string): string {
	return `agent bridge script missing at ${path}; run \`corepack pnpm --filter @malini/agent-bridge build\``;
}

export function bridgePrivateRuntimeRoot(appDataRoot: string): string {
	return join(appDataRoot, 'agent', 'bridge-runtime');
}

const LEGACY_BRIDGE_RUNTIME_PARENT_DIR_NAME = 'agentic';

function legacyBridgePrivateRuntimeRoot(appDataRoot: string): string {
	return join(appDataRoot, LEGACY_BRIDGE_RUNTIME_PARENT_DIR_NAME, 'bridge-runtime');
}

export function removeLegacyBridgePrivateRuntimeRoot(appDataRoot: string): void {
	rmSync(legacyBridgePrivateRuntimeRoot(appDataRoot), { recursive: true, force: true });
	const legacyParent = dirname(legacyBridgePrivateRuntimeRoot(appDataRoot));
	if (existsSync(legacyParent) && readdirSync(legacyParent).length === 0) {
		rmSync(legacyParent, { recursive: true, force: true });
	}
}

export async function startAgentService(
	context: MainContext,
	deps: AgentServiceDeps,
): Promise<AgentService> {
	const log = deps.log ?? ((line: string) => console.error(line));
	const { db } = context;

	try {
		log(`agent: reaped ${reapOrphansOnStartup(db)} orphaned run(s) on startup`);
	} catch (error) {
		log(`agent: startup orphan reap failed (continuing): ${describe(error)}`);
	}

	const bridgeScriptPath =
		deps.bridgeScriptPath ?? selectBridgeScriptPath(context.resourcesRoot, context.isDev);
	const privateRuntimeRoot = bridgePrivateRuntimeRoot(context.appDataRoot);
	try {
		mkdirSync(privateRuntimeRoot, { recursive: true, mode: 0o700 });
	} catch (error) {
		log(`agent: could not create the bridge private runtime root: ${describe(error)}`);
	}
	try {
		removeLegacyBridgePrivateRuntimeRoot(context.appDataRoot);
	} catch (error) {
		log(`agent: could not remove the legacy bridge private runtime root: ${describe(error)}`);
	}

	const runtime = new BridgeRuntime({
		db,
		events: context.events,
		appDataRoot: context.appDataRoot,
		leases: deps.leases,
		supervisorConfig: {
			processFactory: deps.processFactory ?? createElectronNodeProcessFactory(),
			spawn: {
				scriptPath: bridgeScriptPath,
				args: ['--stdio'],
				env: {
					...deps.spawnEnvironment(),
					AGENT_BRIDGE_LOG: join(context.appDataRoot, 'agent-bridge.log'),
					MALINI_AGENT_BRIDGE_PRIVATE_RUNTIME_ROOT: privateRuntimeRoot,
				},
			},
			log,
		},
		hooks: deps.hooks,
		log,
	});

	let started = false;
	if (existsSync(bridgeScriptPath)) {
		started = await runtime.start();
	} else {
		log(`agent: ${missingBridgeScriptMessage(bridgeScriptPath)}`);
	}

	defineBridgeCommands(context.commands, {
		db,
		runtime,
		appDataRoot: context.appDataRoot,
		ids: new IdSequence(),
		leases: deps.leases,
		hooks: {
			...(deps.verifyAttachment ? { verifyAttachment: deps.verifyAttachment } : {}),
			...(deps.collectAttachmentGarbage
				? { collectAttachmentGarbage: deps.collectAttachmentGarbage }
				: {}),
			captureCheckpoint: deps.hooks.captureCheckpoint,
			captureRunFinish: (runId) => runtime.notifyRunFinished(runId, 'not-delivered'),
			notifyWorkstreamRenamed(workstreamId, name) {
				const payload: WorkstreamRenamedPayload = { workstreamId, name };
				context.events.emit(REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL, payload);
			},
		},
		log,
	});

	return {
		runtime,
		bridgeScriptPath,
		started,
		health() {
			return runtime.currentIfRunning()?.health() ?? { state: 'pending' };
		},
		ensureReady: () => runtime.ensureReady(),
		closeOpenRunsForExit,
		async stop() {
			await runtime.stop();
			await closeOpenRunsForExit();
		},
	};

	async function closeOpenRunsForExit(): Promise<number> {
		let reaped: string[];
		try {
			reaped = reapOrphansOnExit(db, (envelope, seq) => runtime.emitSynthetic(envelope, seq));
		} catch (error) {
			log(`agent: exit orphan reap failed: ${describe(error)}`);
			return 0;
		}
		for (const runId of reaped) {
			await runtime.notifyRunFinished(runId, 'app-exit');
		}
		return reaped.length;
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
