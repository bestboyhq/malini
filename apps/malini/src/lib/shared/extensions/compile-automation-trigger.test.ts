import { EXTENSION_EVENTS } from '@malini/extension-api';
import { describe, expect, it } from 'vitest';

import { compileWorkstreamAutomation } from './compile-automation-trigger';

describe('compileWorkstreamAutomation', () => {
	it('compiles supported natural-language triggers into deterministic predicates', () => {
		const created = compileWorkstreamAutomation('When a new workstream is created');
		expect(created.event).toBe(EXTENSION_EVENTS.workstreamCreated);
		expect(created.matches({ workstreamId: 'workstream-1' })).toBe(true);
		expect(() => compileWorkstreamAutomation('When a workstream is first opened')).toThrow(
			/Unsupported extension automation trigger/u,
		);

		const frontend = compileWorkstreamAutomation(
			'Preview when a frontend Docker container boots up',
		);
		expect(frontend.event).toBe(EXTENSION_EVENTS.resourceReady);
		expect(frontend.matches({ kind: 'docker', state: 'ready', componentId: 'frontend-web' })).toBe(
			true,
		);
		expect(frontend.matches({ kind: 'docker', state: 'ready', componentId: 'backend-api' })).toBe(
			false,
		);
		const healthyFrontend = compileWorkstreamAutomation(
			'The frontend Docker container becomes healthy',
		);
		expect(
			healthyFrontend.matches({
				kind: 'docker',
				state: 'ready',
				componentKind: 'frontend',
			}),
		).toBe(true);
		expect(
			healthyFrontend.matches({
				kind: 'process',
				state: 'ready',
				componentKind: 'frontend',
			}),
		).toBe(false);

		const genericFrontend = compileWorkstreamAutomation('When a frontend resource becomes ready');
		expect(genericFrontend.event).toBe(EXTENSION_EVENTS.resourceReady);
		expect(genericFrontend.description).toBe('When a frontend resource becomes ready');
		expect(
			genericFrontend.matches({
				kind: 'process',
				state: 'ready',
				componentKind: 'frontend',
			}),
		).toBe(true);
		expect(
			genericFrontend.matches({
				kind: 'docker',
				state: 'ready',
				componentId: 'frontend-web',
			}),
		).toBe(true);
		expect(
			genericFrontend.matches({
				kind: 'process',
				state: 'ready',
				componentId: 'backend-api',
			}),
		).toBe(false);
		expect(
			genericFrontend.matches({
				kind: 'process',
				state: 'starting',
				componentKind: 'frontend',
			}),
		).toBe(false);
		expect(() => compileWorkstreamAutomation('whenever it feels useful')).toThrow(
			/Unsupported extension automation trigger/u,
		);
	});
});
