import type {
	ExtensionFileArgs,
	ListExtensionWorkstreamFilesArgs,
	WriteExtensionWorkstreamFileArgs,
} from '$contract/commands';
import type { MainContext } from '$main/context';
import type { ExtensionsPlatform, ExtensionsPlatformDeps } from '../extensions.platform';
import {
	listFiles,
	readFile,
	readRepositoryFile,
	statFile,
	validateOwner,
	writeFile,
} from './files';
import {
	ExtensionPackages,
	resolveExtensionPackagePaths,
	type ExtensionDevelopmentLog,
	type ExtensionPackagePaths,
} from './packages';

export function registerExtensions(
	context: MainContext,
	deps: ExtensionsPlatformDeps,
): ExtensionsPlatform {
	const { commands } = context;
	const resolver = deps.resolver;

	commands.define(
		'extensions.list-workstream-files',
		async (args: ListExtensionWorkstreamFilesArgs) => {
			const workstreamId = ownerArgs(args);
			const root = await resolver.resolveCheckout(workstreamId);
			return listFiles(root, args.glob);
		},
	);
	commands.define('extensions.read-workstream-file', async (args: ExtensionFileArgs) => {
		const workstreamId = ownerArgs(args);
		const root = await resolver.resolveCheckout(workstreamId);
		return readFile(root, stringArg(args, 'path'));
	});
	commands.define('extensions.read-repository-file', async (args: ExtensionFileArgs) => {
		const workstreamId = ownerArgs(args);
		return readRepositoryFile(resolver, workstreamId, stringArg(args, 'path'));
	});
	commands.define(
		'extensions.write-workstream-file',
		async (args: WriteExtensionWorkstreamFileArgs) => {
			const workstreamId = ownerArgs(args);
			const root = await resolver.resolveCheckout(workstreamId);
			await writeFile(root, stringArg(args, 'path'), stringArg(args, 'contents'));
		},
	);
	commands.define('extensions.stat-workstream-file', async (args: ExtensionFileArgs) => {
		const workstreamId = ownerArgs(args);
		const root = await resolver.resolveCheckout(workstreamId);
		return statFile(root, stringArg(args, 'path'));
	});

	return { packages: registerExtensionPackages(context, deps.packages ?? {}) };
}

function registerExtensionPackages(
	context: MainContext,
	overrides: Partial<ExtensionPackagePaths>,
): ExtensionPackages {
	const packages = new ExtensionPackages({
		...resolveExtensionPackagePaths(context),
		...overrides,
	});

	const { commands } = context;

	commands.define('extensions.list-sources', () => packages.listSources());
	commands.define('extensions.list-managed', () => packages.listManaged());
	commands.define('extensions.set-managed-enabled', (args: unknown) => {
		const enabled = field(args, 'enabled');
		if (typeof enabled !== 'boolean') {
			throw new Error('extensions.set-managed-enabled requires enabled');
		}
		return packages.setManagedEnabled(
			requireString(args, 'extensionId', 'extensions.set-managed-enabled'),
			enabled,
		);
	});
	commands.define('extensions.rollback-managed', (args: unknown) =>
		packages.rollbackManaged(requireString(args, 'extensionId', 'extensions.rollback-managed')),
	);
	commands.define('extensions.recovery-mode-enabled', () => packages.recoveryModeEnabled());
	commands.define('extensions.append-development-log', (args: unknown) => {
		const log = field(args, 'log');
		if (!isRecord(log)) throw new Error('extensions.append-development-log requires a log');
		return packages.appendDevelopmentLog(parseDevelopmentLog(log));
	});

	return packages;
}

function parseDevelopmentLog(log: Record<string, unknown>): ExtensionDevelopmentLog {
	const { timestamp, level, extensionId, event, message } = log;
	if (
		typeof timestamp !== 'string' ||
		typeof level !== 'string' ||
		typeof event !== 'string' ||
		typeof message !== 'string' ||
		(extensionId != null && typeof extensionId !== 'string')
	) {
		throw new Error('extensions.append-development-log received a malformed log');
	}
	return { timestamp, level, extensionId: extensionId ?? null, event, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(args: unknown, name: string): unknown {
	return isRecord(args) ? args[name] : undefined;
}

function requireString(args: unknown, name: string, command: string): string {
	const value = field(args, name);
	if (typeof value !== 'string') throw new Error(`${command} requires ${name}`);
	return value;
}

function ownerArgs(args: Readonly<{ extensionId: string; workstreamId: string }>): string {
	const extensionId = typeof args?.extensionId === 'string' ? args.extensionId : '';
	const workstreamId = typeof args?.workstreamId === 'string' ? args.workstreamId : '';
	validateOwner(extensionId, workstreamId);
	return workstreamId;
}

function stringArg<K extends string>(
	args: Readonly<Record<K, unknown>> | undefined,
	key: K,
): string {
	const value = args?.[key];
	if (typeof value !== 'string') {
		throw new Error(`Extension host command requires ${key}`);
	}
	return value;
}
