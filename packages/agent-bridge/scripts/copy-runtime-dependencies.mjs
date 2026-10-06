import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distNodeModules = resolve(packageRoot, 'dist/node_modules');
const packageRequire = createRequire(resolve(packageRoot, 'package.json'));
const runtimePackageRoots = ['@anthropic-ai/claude-agent-sdk'];
/**
 * @typedef {object} PackageManifest
 * @property {string} [name]
 * @property {string} [version]
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [optionalDependencies]
 */

const obsoleteRuntimePaths = [
	resolve(packageRoot, 'dist/loop'),
	resolve(packageRoot, 'dist/tools'),
	resolve(packageRoot, 'dist/transports'),
	resolve(packageRoot, 'dist/providers/agent'),
];
/** @type {Map<string, string>} */
const copiedVersions = new Map();
const stagingRoot = await mkdtemp(resolve(packageRoot, 'node_modules/.agent-bridge-runtime-'));
const stagedNodeModules = resolve(stagingRoot, 'node_modules');

try {
	for (const packageName of runtimePackageRoots) {
		const installedPackage = await resolveInstalledPackage(packageRequire, packageName);
		await copyDependencyClosure(packageName, installedPackage);
	}

	await publishRuntimeTree(stagedNodeModules, distNodeModules);
	for (const obsoletePath of obsoleteRuntimePaths) {
		await rm(obsoletePath, { recursive: true, force: true });
	}
} finally {
	await rm(stagingRoot, { recursive: true, force: true });
}

/**
 * @param {string} packageName
 * @param {string} installedPackage
 * @returns {Promise<void>}
 */
async function copyDependencyClosure(packageName, installedPackage) {
	const manifest = await readManifest(installedPackage);
	if (typeof manifest.version !== 'string') {
		throw new Error(`runtime package ${packageName} has no version in its manifest`);
	}
	const existingVersion = copiedVersions.get(packageName);
	if (existingVersion) {
		if (existingVersion !== manifest.version) {
			throw new Error(
				`runtime package version collision for ${packageName}: ${existingVersion} and ${manifest.version}`,
			);
		}
		return;
	}

	copiedVersions.set(packageName, manifest.version);
	await copyPackage(packageName, installedPackage);
	const packageLocalRequire = createRequire(resolve(installedPackage, 'package.json'));
	for (const dependencyName of Object.keys(manifest.dependencies ?? {}).sort()) {
		const dependencyPackage = await resolveInstalledPackage(packageLocalRequire, dependencyName);
		await copyDependencyClosure(dependencyName, dependencyPackage);
	}
	for (const optionalName of Object.keys(manifest.optionalDependencies ?? {}).sort()) {
		let optionalPackage;
		try {
			optionalPackage = await resolveInstalledPackage(packageLocalRequire, optionalName);
		} catch {
			continue;
		}
		await copyDependencyClosure(optionalName, optionalPackage);
	}
}

/**
 * @param {string} packageName
 * @param {string} installedPackage
 * @returns {Promise<void>}
 */
async function copyPackage(packageName, installedPackage) {
	const bundledPackage = resolve(stagedNodeModules, packageName);
	const nestedNodeModules = `${installedPackage}/node_modules/`;
	await mkdir(dirname(bundledPackage), { recursive: true });
	await cp(installedPackage, bundledPackage, {
		recursive: true,
		dereference: true,
		filter: (source) => !source.startsWith(nestedNodeModules) && !source.endsWith('.d.ts'),
	});
}

/**
 * @param {string} sourceRoot
 * @param {string} targetRoot
 * @returns {Promise<void>}
 */
async function publishRuntimeTree(sourceRoot, targetRoot) {
	/** @type {string[]} */
	const files = [];
	await collectFiles(sourceRoot, files);
	files.sort((left, right) => {
		const leftIsManifest = left.endsWith('/package.json') || left === 'package.json';
		const rightIsManifest = right.endsWith('/package.json') || right === 'package.json';
		if (leftIsManifest !== rightIsManifest) return leftIsManifest ? 1 : -1;
		return left.localeCompare(right);
	});

	for (const file of files) {
		const source = resolve(sourceRoot, file);
		const target = resolve(targetRoot, file);
		await mkdir(dirname(target), { recursive: true });
		await rename(source, target);
	}
}

/**
 * @param {string} root
 * @param {string[]} files
 * @param {string} [current]
 * @returns {Promise<void>}
 */
async function collectFiles(root, files, current = root) {
	for (const entry of await readdir(current, { withFileTypes: true })) {
		const entryPath = resolve(current, entry.name);
		if (entry.isDirectory()) {
			await collectFiles(root, files, entryPath);
		} else if (entry.isFile()) {
			files.push(relative(root, entryPath));
		} else {
			throw new Error(`unsupported runtime dependency entry: ${entryPath}`);
		}
	}
}

/**
 * @param {NodeJS.Require} requireFromPackage
 * @param {string} packageName
 * @returns {Promise<string>}
 */
async function resolveInstalledPackage(requireFromPackage, packageName) {
	let entry;
	try {
		entry = await realpath(requireFromPackage.resolve(`${packageName}/package.json`));
	} catch (error) {
		if (!isErrnoException(error) || error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
		entry = await realpath(requireFromPackage.resolve(packageName));
	}
	let candidate = dirname(entry);
	while (candidate !== dirname(candidate)) {
		try {
			const manifest = await readManifest(candidate);
			if (manifest.name === packageName) return candidate;
		} catch (manifestError) {
			if (!isErrnoException(manifestError) || manifestError.code !== 'ENOENT') {
				throw manifestError;
			}
		}
		candidate = dirname(candidate);
	}
	throw new Error(`could not locate package root for ${packageName}`);
}

/**
 * @param {string} packageDirectory
 * @returns {Promise<PackageManifest>}
 */
async function readManifest(packageDirectory) {
	/** @type {unknown} */
	const parsed = JSON.parse(await readFile(resolve(packageDirectory, 'package.json'), 'utf8'));
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`package manifest in ${packageDirectory} is not an object`);
	}
	return /** @type {PackageManifest} */ (parsed);
}

/**
 * @param {unknown} error
 * @returns {error is NodeJS.ErrnoException}
 */
function isErrnoException(error) {
	return error instanceof Error && 'code' in error;
}
