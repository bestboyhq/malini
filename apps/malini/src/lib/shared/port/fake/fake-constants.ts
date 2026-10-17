import type { DesktopRuntimeIdentity } from '$contract/system';

export function fakePixelPng(): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(
		atob(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
		),
		(character) => character.charCodeAt(0),
	);
}

export const FAKE_IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
};

export const FAKE_RUNTIME_IDENTITY = Object.freeze({
	productName: 'malini Fake',
	bundleIdentifier: 'com.malini.app.fake',
	version: '0.0.0-fake',
	buildProfile: 'debug',
	pid: 4_242,
	executablePath: '/fake/malini Fake.app/Contents/MacOS/malini',
	executableFingerprint: 'fake-executable-sha256',
	appDataRoot: '/fake/Library/Application Support/com.malini.app.fake',
}) satisfies DesktopRuntimeIdentity;

export const FAKE_BUNDLE_IDENTIFIER = FAKE_RUNTIME_IDENTITY.bundleIdentifier;

export const FAKE_APP_INSTANCE_ID = 'fake-app-instance';

export function fakeComposeSegment(value: string): string {
	return value
		.toLowerCase()
		.replace(/^@/u, '')
		.replace(/[^a-z0-9_-]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
}
