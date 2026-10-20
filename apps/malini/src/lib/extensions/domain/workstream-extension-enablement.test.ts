import { describe, expect, it } from 'vitest';

import {
	parseWorkstreamExtensionConfiguration,
	setWorkstreamExtensionEnabled,
} from './workstream-extension-configuration';

describe('setWorkstreamExtensionEnabled', () => {
	it('preserves repository settings and automations while changing enablement', () => {
		const configuration = parseWorkstreamExtensionConfiguration(
			JSON.stringify({
				schemaVersion: 1,
				extensions: {
					'example.linear': {
						enabled: false,
						settings: {},
						automations: [
							{
								id: 'refresh-linear',
								when: 'when a new workstream is created',
								run: { command: 'example.linear.refresh', args: [] },
							},
						],
					},
				},
			}),
		);

		const enabled = setWorkstreamExtensionEnabled(configuration, 'example.linear', true);

		expect(enabled.extensions['example.linear']).toEqual({
			enabled: true,
			settings: {},
			automations: [
				{
					id: 'refresh-linear',
					enabled: true,
					when: 'when a new workstream is created',
					run: { command: 'example.linear.refresh', args: [] },
				},
			],
		});
		expect(setWorkstreamExtensionEnabled(enabled, 'example.linear', true)).toBe(enabled);
	});

	it('creates the smallest valid opt-in entry', () => {
		const empty = parseWorkstreamExtensionConfiguration('{"schemaVersion":1,"extensions":{}}');
		expect(
			setWorkstreamExtensionEnabled(empty, 'example.workstream-setup', true).extensions,
		).toEqual({
			'example.workstream-setup': { enabled: true, settings: {}, automations: [] },
		});
	});
});
