import { describe, expect, it } from 'vitest';

import {
	EMPTY_WORKSTREAM_EXTENSION_CONFIGURATION,
	WorkstreamExtensionConfigurationError,
	isWorkstreamExtensionEnabled,
	parseWorkstreamExtensionConfiguration,
} from './workstream-extension-configuration';

describe('workstream extension configuration', () => {
	it('parses explicit extension settings and natural-language automation targets', () => {
		const configuration = parseWorkstreamExtensionConfiguration(
			JSON.stringify({
				schemaVersion: 1,
				extensions: {
					'example.preview': {
						enabled: true,
						settings: {
							'example.preview.auto-start': false,
							'example.preview.readiness-timeout-ms': 45_000,
							'example.preview.command': 'pnpm',
						},
						automations: [
							{
								id: 'start-after-frontend',
								when: '  the frontend Docker container becomes healthy  ',
								run: {
									workflow: 'example.preview.ensure-ready',
									input: {
										component: 'frontend',
										labels: ['browser', { mode: 'development' }],
										retry: null,
									},
								},
							},
							{
								id: 'open-after-ready',
								enabled: false,
								when: 'the preview reports that it is ready',
								run: {
									command: 'example.preview.open',
									args: [{ focus: true }],
								},
							},
						],
					},
					'acme.linear': { enabled: false },
				},
			}),
		);

		expect(configuration).toEqual({
			schemaVersion: 1,
			extensions: {
				'example.preview': {
					enabled: true,
					settings: {
						'example.preview.auto-start': false,
						'example.preview.readiness-timeout-ms': 45_000,
						'example.preview.command': 'pnpm',
					},
					automations: [
						{
							id: 'start-after-frontend',
							enabled: true,
							when: 'the frontend Docker container becomes healthy',
							run: {
								workflow: 'example.preview.ensure-ready',
								input: {
									component: 'frontend',
									labels: ['browser', { mode: 'development' }],
									retry: null,
								},
							},
						},
						{
							id: 'open-after-ready',
							enabled: false,
							when: 'the preview reports that it is ready',
							run: { command: 'example.preview.open', args: [{ focus: true }] },
						},
					],
				},
				'acme.linear': { enabled: false, settings: {}, automations: [] },
			},
		});
		expect(isWorkstreamExtensionEnabled(configuration, 'example.preview')).toBe(true);
		expect(isWorkstreamExtensionEnabled(configuration, 'acme.linear')).toBe(false);
		expect(isWorkstreamExtensionEnabled(configuration, 'acme.not-configured')).toBe(false);
	});

	it('returns deeply immutable normalized data', () => {
		const configuration = parseWorkstreamExtensionConfiguration(
			JSON.stringify({
				schemaVersion: 1,
				extensions: {
					'example.preview': {
						enabled: true,
						automations: [
							{
								id: 'start-preview',
								when: 'a frontend is ready',
								run: {
									workflow: 'example.preview.ensure-ready',
									input: { nested: { values: [1, 2] } },
								},
							},
						],
					},
				},
			}),
		);
		const preview = configuration.extensions['example.preview']!;
		const run = preview.automations[0]!.run;
		if (!('workflow' in run)) throw new Error('Expected workflow target');
		const nested = run.input.nested;
		if (!isNumberValues(nested)) throw new Error('Expected a nested values object');

		expect(Object.isFrozen(configuration)).toBe(true);
		expect(Object.isFrozen(configuration.extensions)).toBe(true);
		expect(Object.isFrozen(preview)).toBe(true);
		expect(Object.isFrozen(preview.settings)).toBe(true);
		expect(Object.isFrozen(preview.automations)).toBe(true);
		expect(Object.isFrozen(preview.automations[0])).toBe(true);
		expect(Object.isFrozen(run)).toBe(true);
		expect(Object.isFrozen(run.input)).toBe(true);
		expect(Object.isFrozen(nested)).toBe(true);
		expect(Object.isFrozen(nested.values)).toBe(true);
	});

	it('provides a frozen empty configuration for the missing-file state', () => {
		expect(EMPTY_WORKSTREAM_EXTENSION_CONFIGURATION).toEqual({
			schemaVersion: 1,
			extensions: {},
		});
		expect(
			isWorkstreamExtensionEnabled(EMPTY_WORKSTREAM_EXTENSION_CONFIGURATION, 'example.preview'),
		).toBe(false);
		expect(Object.isFrozen(EMPTY_WORKSTREAM_EXTENSION_CONFIGURATION)).toBe(true);
		expect(Object.isFrozen(EMPTY_WORKSTREAM_EXTENSION_CONFIGURATION.extensions)).toBe(true);
	});

	it.each([
		['malformed JSON', '{', /Invalid \.malini\/workspace\.json:/u],
		['non-object root', '[]', /must contain a JSON object/u],
		[
			'unsupported schema',
			JSON.stringify({ schemaVersion: 2, extensions: {} }),
			/schemaVersion must equal 1/u,
		],
		['missing extension map', JSON.stringify({ schemaVersion: 1 }), /\$\.extensions is required/u],
		[
			'unnamespaced extension id',
			JSON.stringify({ schemaVersion: 1, extensions: { preview: { enabled: true } } }),
			/namespaced lowercase extension id/u,
		],
		[
			'missing explicit enabled state',
			JSON.stringify({ schemaVersion: 1, extensions: { 'example.preview': {} } }),
			/\.enabled is required/u,
		],
		[
			'non-boolean enabled state',
			JSON.stringify({
				schemaVersion: 1,
				extensions: { 'example.preview': { enabled: 'yes' } },
			}),
			/\.enabled must be a boolean/u,
		],
		[
			'non-scalar setting',
			JSON.stringify({
				schemaVersion: 1,
				extensions: {
					'example.preview': {
						enabled: true,
						settings: { 'example.preview.command': ['pnpm'] },
					},
				},
			}),
			/must be a string, finite number, or boolean/u,
		],
		[
			'foreign setting',
			JSON.stringify({
				schemaVersion: 1,
				extensions: {
					'example.preview': {
						enabled: true,
						settings: { 'malini.repository.mode': 'fast' },
					},
				},
			}),
			/must be a contribution id owned by example\.preview/u,
		],
		[
			'non-array automations',
			JSON.stringify({
				schemaVersion: 1,
				extensions: { 'example.preview': { enabled: true, automations: {} } },
			}),
			/automations must be an array/u,
		],
		[
			'missing natural-language condition',
			JSON.stringify({
				schemaVersion: 1,
				extensions: {
					'example.preview': {
						enabled: true,
						automations: [{ id: 'start', run: { workflow: 'example.preview.ensure-ready' } }],
					},
				},
			}),
			/\.when is required/u,
		],
		[
			'ambiguous run target',
			JSON.stringify({
				schemaVersion: 1,
				extensions: {
					'example.preview': {
						enabled: true,
						automations: [
							{
								id: 'start',
								when: 'a frontend is ready',
								run: {
									workflow: 'example.preview.ensure-ready',
									command: 'example.preview.start',
								},
							},
						],
					},
				},
			}),
			/must select exactly one of workflow or command/u,
		],
		[
			'foreign run target',
			JSON.stringify({
				schemaVersion: 1,
				extensions: {
					'example.preview': {
						enabled: true,
						automations: [
							{
								id: 'start',
								when: 'a frontend is ready',
								run: { workflow: 'malini.repository.refresh' },
							},
						],
					},
				},
			}),
			/must be a contribution id owned by example\.preview/u,
		],
	] as const)('rejects %s', (_name, contents, expected) => {
		expect(() => parseWorkstreamExtensionConfiguration(contents)).toThrow(expected);
	});

	it('rejects unknown fields and duplicate automation ids', () => {
		expect(() =>
			parseWorkstreamExtensionConfiguration(
				JSON.stringify({ schemaVersion: 1, extensions: {}, permissive: true }),
			),
		).toThrow(/\$\.permissive is not supported/u);

		expect(() =>
			parseWorkstreamExtensionConfiguration(
				JSON.stringify({
					schemaVersion: 1,
					extensions: {
						'example.preview': {
							enabled: true,
							automations: [
								{
									id: 'start',
									when: 'the first condition',
									run: { workflow: 'example.preview.ensure-ready' },
								},
								{
									id: 'start',
									when: 'the second condition',
									run: { workflow: 'example.preview.ensure-ready' },
								},
							],
						},
					},
				}),
			),
		).toThrow(/duplicate automation id start/u);
	});

	it('refuses a derived field in configuration', () => {
		for (const field of [
			'start',
			'install',
			'installMarker',
			'migrate',
			'healthCheck',
			'dependsOn',
			'reuse',
		]) {
			expect(() =>
				parseWorkstreamExtensionConfiguration(
					JSON.stringify({ schemaVersion: 1, extensions: {}, [field]: {} }),
				),
			).toThrow(/is not supported by workstream configuration v1/u);
		}
		expect(() =>
			parseWorkstreamExtensionConfiguration(
				JSON.stringify({ schemaVersion: 1, extensions: {}, components: [] }),
			),
		).toThrow(/\$\.components is not supported by workstream configuration v1/u);
	});

	it('throws a distinguishable configuration error', () => {
		expect.assertions(2);
		try {
			parseWorkstreamExtensionConfiguration('{}');
		} catch (error) {
			expect(error).toBeInstanceOf(WorkstreamExtensionConfigurationError);
			expect(error).toHaveProperty('name', 'WorkstreamExtensionConfigurationError');
		}
	});
});

function isNumberValues(value: unknown): value is Readonly<{ values: readonly number[] }> {
	if (typeof value !== 'object' || value === null || !('values' in value)) return false;
	const { values } = value;
	return Array.isArray(values) && values.every((entry) => typeof entry === 'number');
}
