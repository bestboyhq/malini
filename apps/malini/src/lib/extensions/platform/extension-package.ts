import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
	MANIFEST_FILE,
	README_FILE,
	packageProblem,
	readMarketplaceManifest,
	skillsIn,
	type MarketplaceManifest,
} from '../domain/marketplace-manifest';

export const PACKAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PACKAGE_MAX_DECODED_BYTES = 10 * 1024 * 1024;

const PACKAGE_FORMAT = 1;
const JSON_MAX_BYTES = Math.ceil((PACKAGE_MAX_DECODED_BYTES * 4) / 3) + 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

export type PackageFile = Readonly<{ path: string; bytes: Buffer }>;

export type ExtensionPackage = Readonly<{
	manifest: MarketplaceManifest;
	files: readonly PackageFile[];
	skills: readonly string[];
	readme: string | null;
}>;

export function packExtension(files: readonly PackageFile[]): Buffer {
	const json = JSON.stringify({
		format: PACKAGE_FORMAT,
		files: files.map(({ path, bytes }) => ({ path, data: bytes.toString('base64') })),
	});
	return gzipSync(Buffer.from(json, 'utf8'));
}

export function readExtensionPackage(bytes: Buffer): ExtensionPackage {
	return extensionFrom(unpackExtension(bytes));
}

export function extensionFrom(files: readonly PackageFile[]): ExtensionPackage {
	const manifestFile = files.find((file) => file.path === MANIFEST_FILE);
	if (!manifestFile) throw new Error('The package has no malini.json.');
	const reading = readMarketplaceManifest(parseJson(manifestFile.bytes, MANIFEST_FILE));
	if (reading.problem) throw new Error(problemText(reading.problem));
	const entries = files.map(({ path, bytes }) => ({ path, size: bytes.length }));
	const problem = packageProblem(entries, reading.manifest);
	if (problem) throw new Error(problemText(problem));
	const readme = files.find((file) => file.path === README_FILE);
	return {
		manifest: reading.manifest,
		files,
		skills: skillsIn(entries),
		readme: readme ? readme.bytes.toString('utf8') : null,
	};
}

export function sha256Of(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function unpackExtension(bytes: Buffer): PackageFile[] {
	if (bytes.length > PACKAGE_MAX_BYTES) {
		throw new Error(`The package is over ${PACKAGE_MAX_BYTES / 1024 / 1024} MB.`);
	}
	let json: Buffer;
	try {
		json = gunzipSync(bytes, { maxOutputLength: JSON_MAX_BYTES });
	} catch {
		throw new Error('The package is not a gzip file Malini can open, or it unpacks too large.');
	}
	const parsed = parseJson(json, 'The package');
	if (!isRecord(parsed) || parsed.format !== PACKAGE_FORMAT || !Array.isArray(parsed.files)) {
		throw new Error(`The package is not a Malini package, format ${PACKAGE_FORMAT}.`);
	}
	const files: readonly unknown[] = parsed.files;
	let decoded = 0;
	return files.map((file, index) => {
		if (!isRecord(file) || typeof file.path !== 'string' || typeof file.data !== 'string') {
			throw new Error(`File ${index} in the package has no path or data.`);
		}
		if (file.data.length % 4 !== 0 || !BASE64.test(file.data)) {
			throw new Error(`${file.path} is not base64.`);
		}
		const fileBytes = Buffer.from(file.data, 'base64');
		decoded += fileBytes.length;
		if (decoded > PACKAGE_MAX_DECODED_BYTES) {
			throw new Error(`The package unpacks to over ${PACKAGE_MAX_DECODED_BYTES / 1024 / 1024} MB.`);
		}
		return { path: file.path, bytes: fileBytes };
	});
}

function parseJson(bytes: Buffer, what: string): unknown {
	try {
		return JSON.parse(bytes.toString('utf8'));
	} catch {
		throw new Error(`${what} is not valid JSON.`);
	}
}

function problemText(problem: Readonly<{ field: string; error: string }>): string {
	return problem.field ? `${problem.error} (${problem.field})` : problem.error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
