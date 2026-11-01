import type {
	ExtensionFileArgs,
	ListExtensionWorkstreamFilesArgs,
	WriteExtensionWorkstreamFileArgs,
} from '$contract/commands';
import { isAbsolute, join } from 'node:path';
import type { MainContext } from '$main/context';
import {
	listRepositoryCatalog,
	resolveConnectedRepository,
	resolveRepositoryCheckout,
} from '$shared/repositories/repositories.platform';
import type { ExtensionsPlatform, ExtensionsPlatformDeps } from '../extensions.platform';
import {
	listFiles,
	readFile,
	readRepositoryFile,
	statFile,
	validateOwner,
	writeFile,
} from './files';
import { Marketplace, type PublishSource } from './marketplace';
import { MarketplaceClient } from './marketplace-client';
import { readOpenedFile, statOpenedFile, writeOpenedFile } from './opened-files';
import {
	ExtensionPackages,
	resolveExtensionPackagePaths,
	type ExtensionDevelopmentLog,
	type ExtensionPackagePaths,
} from './packages';

const MARKETPLACE_REFRESH_MS = 60 * 60 * 1000;

export function registerExtensions(
	context: MainContext,
	deps: ExtensionsPlatformDeps,
): ExtensionsPlatform {
	const { commands, db } = context;
	const { resolver, readCheckout } = deps;

	commands.define(
		'extensions.list-workstream-files',
		async (args: ListExtensionWorkstreamFilesArgs) => {
			const workstreamId = ownerArgs(args);
			return readCheckout(workstreamId, (root) => listFiles(root, args.glob));
		},
	);
	commands.define('extensions.read-workstream-file', async (args: ExtensionFileArgs) => {
		const workstreamId = ownerArgs(args);
		const path = stringArg(args, 'path');
		if (isAbsolute(path)) return readOpenedFile(db, workstreamId, path);
		return readCheckout(workstreamId, (root) => readFile(root, path));
	});
	commands.define('extensions.read-repository-file', async (args: ExtensionFileArgs) => {
		const workstreamId = ownerArgs(args);
		return readRepositoryFile(resolver, workstreamId, stringArg(args, 'path'));
	});
	commands.define(
		'extensions.write-workstream-file',
		async (args: WriteExtensionWorkstreamFileArgs) => {
			const workstreamId = ownerArgs(args);
			const path = stringArg(args, 'path');
			const contents = stringArg(args, 'contents');
			if (isAbsolute(path)) await writeOpenedFile(db, workstreamId, path, contents);
			else await readCheckout(workstreamId, (root) => writeFile(root, path, contents));
		},
	);
	commands.define('extensions.stat-workstream-file', async (args: ExtensionFileArgs) => {
		const workstreamId = ownerArgs(args);
		const path = stringArg(args, 'path');
		if (isAbsolute(path)) return statOpenedFile(db, workstreamId, path);
		return readCheckout(workstreamId, (root) => statFile(root, path));
	});

	const marketplace = registerMarketplace(context, deps);
	let refreshing: NodeJS.Timeout | undefined;
	return {
		packages: registerExtensionPackages(context, deps.packages ?? {}),
		pluginFolders: () => marketplace.pluginFolders(),
		start: () => {
			void marketplace.refresh();
			refreshing = setInterval(() => void marketplace.refresh(), MARKETPLACE_REFRESH_MS).unref();
		},
		stop: () => clearInterval(refreshing),
	};
}

function registerMarketplace(context: MainContext, deps: ExtensionsPlatformDeps): Marketplace {
	const { commands, db, events, appDataRoot } = context;
	const marketplace = new Marketplace({
		db,
		events,
		root: join(appDataRoot, 'extensions'),
		client: new MarketplaceClient(deps.bestboy),
		bestboy: deps.bestboy,
		sources: () => publishSources(context),
	});

	commands.define('extensions.list-listings', () => marketplace.listings());
	commands.define('extensions.get-listing', (args: unknown) => {
		const { publisher, name } = extensionRef(args);
		return marketplace.detail(publisher, name);
	});
	commands.define('extensions.list-installed', () => marketplace.installed());
	commands.define('extensions.install', (args: unknown) => {
		const { publisher, name } = extensionRef(args);
		return marketplace.install(publisher, name);
	});
	commands.define('extensions.uninstall', (args: unknown) =>
		marketplace.uninstall(slugArg(args, 'name')),
	);
	commands.define('extensions.switch', (args: unknown) => {
		const enabled = field(args, 'enabled');
		if (typeof enabled !== 'boolean') throw new Error('extensions.switch needs enabled.');
		return marketplace.switch(slugArg(args, 'name'), enabled);
	});
	commands.define('extensions.publishing', () => marketplace.publishing());
	commands.define('extensions.publish', (args: unknown) => {
		const repositoryId = field(args, 'repositoryId');
		if (
			typeof repositoryId !== 'string' ||
			repositoryId.length === 0 ||
			repositoryId.length > 300
		) {
			throw new Error('extensions.publish needs a repositoryId.');
		}
		return marketplace.publish(repositoryId);
	});
	commands.define('extensions.claim-handle', async (args: unknown) => {
		const handle = field(args, 'handle');
		if (typeof handle !== 'string' || handle.length > 100) {
			throw new Error('extensions.claim-handle needs a handle.');
		}
		return { problem: await deps.bestboy().claimHandle(handle) };
	});
	return marketplace;
}

async function publishSources(context: MainContext): Promise<PublishSource[]> {
	const { db, appDataRoot } = context;
	const sources: PublishSource[] = [];
	for (const repository of await listRepositoryCatalog(db)) {
		if (repository.hidden) continue;
		const connected = await resolveConnectedRepository(db, repository.id);
		const dir = connected ? resolveRepositoryCheckout(db, appDataRoot, connected) : null;
		if (dir) sources.push({ id: repository.id, fullName: repository.fullName, dir });
	}
	return sources;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function extensionRef(args: unknown): Readonly<{ publisher: string; name: string }> {
	return { publisher: slugArg(args, 'publisher'), name: slugArg(args, 'name') };
}

function slugArg(args: unknown, name: string): string {
	const value = field(args, name);
	if (typeof value !== 'string' || value.length > 64 || !SLUG.test(value)) {
		throw new Error(`${name} must be lowercase letters, digits and single hyphens.`);
	}
	return value;
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
