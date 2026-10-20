import type { MaliniApi } from './index';

declare global {
	interface Window {
		malini: MaliniApi;
	}
}

export {};
