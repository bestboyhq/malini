import { vi } from 'vitest';

const UNDER_LOAD_TIMEOUT_MS = 10_000;
const waitFor = vi.waitFor;

const waitUnderLoad: typeof vi.waitFor = (callback, options) =>
	waitFor(
		callback,
		typeof options === 'number' ? options : { timeout: UNDER_LOAD_TIMEOUT_MS, ...options },
	);

vi.waitFor = waitUnderLoad;
