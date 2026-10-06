import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExtensionManifest } from '../src/manifest.js';

const validManifest = {
	schemaVersion: 1,
	id: 'example.reference',
	name: 'Reference',
	version: '1.0.0',
	apiVersion: 1,
	description: 'Reference extension',
	publisher: 'example',
	entrypoint: './dist/index.js',
	activationEvents: ['onStartup'],
	contributes: {
		panels: [{ id: 'reference.panel', label: 'Reference', icon: 'sparkles' }],
	},
};

test('accepts a valid v1 extension manifest', () => {
	assert.equal(validateExtensionManifest(validManifest).valid, true);
});

test('rejects unsafe entrypoints and duplicate contribution ids', () => {
	const result = validateExtensionManifest({
		...validManifest,
		entrypoint: '../private.js',
		contributes: {
			panels: [{ id: 'same.id', label: 'One', icon: 'one' }],
			commands: [{ id: 'same.id', title: 'Two' }],
		},
	});
	assert.equal(result.valid, false);
	if (!result.valid) {
		assert.match(result.issues.map(({ message }) => message).join('\n'), /relative path/u);
		assert.match(result.issues.map(({ message }) => message).join('\n'), /duplicate contribution/u);
	}
});

test('rejects duplicate activation events and invalid setting defaults', () => {
	const result = validateExtensionManifest({
		...validManifest,
		activationEvents: ['onStartup', 'onStartup'],
		contributes: {
			settings: [
				{ id: 'example.count', label: 'Count', type: 'number', default: 'many' },
				{
					id: 'example.mode',
					label: 'Mode',
					type: 'select',
					default: 'missing',
					options: [{ label: 'Smart', value: 'smart' }],
				},
			],
		},
	});
	assert.equal(result.valid, false);
	if (!result.valid) {
		assert.ok(result.issues.some(({ message }) => message.includes('duplicate activation event')));
		assert.ok(
			result.issues.some(({ message }) => message.includes('must match setting type number')),
		);
		assert.ok(
			result.issues.some(({ message }) => message.includes('must match a select option value')),
		);
	}
});
