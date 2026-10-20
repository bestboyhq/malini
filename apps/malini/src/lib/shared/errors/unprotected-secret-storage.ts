import { captureRendererError } from './renderer-error-sink';

const UNPROTECTED_SECRET_STORAGE = 'UnprotectedSecretStorage';

export function reportUnprotectedSecretStorage(message: string): void {
	console.warn(`[${UNPROTECTED_SECRET_STORAGE}] ${message}`);
	const detail = new Error(message);
	detail.name = UNPROTECTED_SECRET_STORAGE;
	captureRendererError('caught', detail);
}
