import { readFileSync } from 'node:fs';

const OS_RELEASE_FILES = ['/etc/os-release', '/usr/lib/os-release'];

export function systemLabel(
	platform: NodeJS.Platform,
	version: string,
	arch: string,
	osRelease = '',
): string {
	if (platform === 'darwin') return `macOS ${version} ${arch}`;
	if (platform === 'win32') return `Windows ${version} ${arch}`;
	const kernel = /^\d+(?:\.\d+)*/u.exec(version)?.[0] ?? version;
	const distribution = [releaseField(osRelease, 'NAME'), releaseField(osRelease, 'VERSION_ID')]
		.filter((part) => part !== '')
		.join(' ');
	return `Linux ${kernel} ${arch}${distribution === '' ? '' : ` (${distribution})`}`;
}

function releaseField(osRelease: string, key: string): string {
	const value = new RegExp(`^${key}=(.*)$`, 'mu').exec(osRelease)?.[1]?.trim() ?? '';
	return value.replace(/^(["'])(.*)\1$/u, '$2');
}

export function currentSystemLabel(): string {
	return systemLabel(
		process.platform,
		process.getSystemVersion(),
		process.arch,
		process.platform === 'linux' ? readOsRelease() : '',
	);
}

function readOsRelease(): string {
	for (const file of OS_RELEASE_FILES) {
		try {
			return readFileSync(file, 'utf8');
		} catch {
			continue;
		}
	}
	return '';
}
