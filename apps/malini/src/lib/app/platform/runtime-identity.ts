import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { DesktopRuntimeIdentity } from '$contract/system';

export type { DesktopRuntimeIdentity };

export const BUNDLE_IDENTIFIER = 'app.malini.desktop';

export const DEVELOPMENT_BUNDLE_IDENTIFIER = `${BUNDLE_IDENTIFIER}.dev`;

export interface RuntimeIdentityInputs {
	productName: string;
	version: string;
	isDev: boolean;
	executablePath: string;
	appDataRoot: string;
	pid?: number;
}

export function bundleIdentifierFor(isDev: boolean): string {
	return isDev ? DEVELOPMENT_BUNDLE_IDENTIFIER : BUNDLE_IDENTIFIER;
}

export async function sha256FileFingerprint(path: string): Promise<string> {
	const hash = createHash('sha256');
	try {
		await pipeline(createReadStream(path), hash);
	} catch (error) {
		throw new Error(
			`could not fingerprint executable: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return hash.digest('hex');
}

export function createRuntimeIdentityProvider(
	inputs: RuntimeIdentityInputs,
): () => Promise<DesktopRuntimeIdentity> {
	const build = async (): Promise<DesktopRuntimeIdentity> => {
		let executablePath: string;
		try {
			executablePath = await realpath(inputs.executablePath);
		} catch (error) {
			throw new Error(
				`could not canonicalize current executable: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		return {
			productName: inputs.productName,
			bundleIdentifier: bundleIdentifierFor(inputs.isDev),
			version: inputs.version,
			buildProfile: inputs.isDev ? 'debug' : 'release',
			pid: inputs.pid ?? process.pid,
			executablePath,
			executableFingerprint: await sha256FileFingerprint(executablePath),
			appDataRoot: inputs.appDataRoot,
		};
	};
	let cached: Promise<DesktopRuntimeIdentity> | null = null;
	return () => {
		if (cached === null) {
			cached = build().catch((error: unknown) => {
				cached = null;
				throw error;
			});
		}
		return cached;
	};
}
