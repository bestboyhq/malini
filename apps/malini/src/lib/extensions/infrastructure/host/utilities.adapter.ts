import type { ExtensionAPI } from '@malini/extension-api';

import { readPublicEnv } from '$shared/env/public-env';
import { reportUnprotectedSecretStorage } from '$shared/errors/unprotected-secret-storage';
import { invoke } from '$shared/port/invoke';

import type { ExtensionStateStorage } from '../../domain/extension-storage';

export function createDesktopExtensionClock(): ExtensionAPI['clock'] {
	return {
		now: () => Date.now(),
		sleep: (ms, signal) => abortableDelay(ms, signal),
	};
}

export function createDesktopExtensionIds(
	nextId: () => string = () => globalThis.crypto.randomUUID(),
): ExtensionAPI['ids'] {
	return {
		next: (prefix = 'extension') => `${prefix}-${nextId()}`,
	};
}

export function createDesktopExtensionNotifications(): ExtensionAPI['notifications'] {
	return {
		show: async ({ title, body }) => invoke('app.notify', { options: { title, body } }),
	};
}

export function createDesktopExtensionUI(): ExtensionAPI['ui'] {
	return {
		openExternal: async (url) => {
			const parsed = new URL(url);
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
				throw new Error(`Extensions can only open HTTP(S) URLs, received ${parsed.protocol}`);
			}
			await invoke('app.open-external-url', { url: parsed.toString() });
		},
	};
}

export function createDesktopExtensionSecrets(input: {
	extensionId: string;
	storage?: ExtensionStateStorage;
	nativeKeychainEnabled?: boolean;
}): ExtensionAPI['secrets'] {
	const service = `malini.extension.${input.extensionId}`;
	const nativeKeychainEnabled =
		input.nativeKeychainEnabled ?? readPublicEnv('PUBLIC_USE_KEYCHAIN') === 'true';
	if (!nativeKeychainEnabled) {
		const storage = input.storage ?? globalThis.localStorage;
		const storageKey = (key: string): string => `${service}:${requireSecretKey(key)}`;
		const reportFallback = onceReporter(
			`Extension secrets for ${service} are stored unencrypted in localStorage because the native keychain is disabled. Set PUBLIC_USE_KEYCHAIN=true in a native release build to store them in the OS keychain.`,
		);
		return {
			get: async (key) => {
				reportFallback();
				return storage.getItem(storageKey(key));
			},
			set: async (key, value) => {
				reportFallback();
				storage.setItem(storageKey(key), value);
			},
			delete: async (key) => {
				reportFallback();
				storage.removeItem(storageKey(key));
			},
		};
	}
	return {
		get: (key) => invoke('app.get-secret', { service, key: requireSecretKey(key) }),
		set: (key, value) => invoke('app.set-secret', { service, key: requireSecretKey(key), value }),
		delete: (key) => invoke('app.delete-secret', { service, key: requireSecretKey(key) }),
	};
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	if (!Number.isFinite(ms) || ms < 0)
		throw new Error('Extension sleep duration must be non-negative');
	if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Extension sleep aborted'));
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const abort = (): void => {
			clearTimeout(timeout);
			cleanup();
			reject(signal?.reason ?? new Error('Extension sleep aborted'));
		};
		const cleanup = (): void => signal?.removeEventListener('abort', abort);
		signal?.addEventListener('abort', abort, { once: true });
	});
}

function onceReporter(message: string): () => void {
	let reported = false;
	return () => {
		if (reported) return;
		reported = true;
		reportUnprotectedSecretStorage(message);
	};
}

function requireSecretKey(key: string): string {
	const value = key.trim();
	if (!value) throw new Error('Extension secret key cannot be empty');
	return value;
}
