import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtensionPanelComponent } from '../src/types.js';

const mount = (): ReturnType<ExtensionPanelComponent['mount']> => ({
	dispose: () => undefined,
});

test('panel mount timing is opt-in and keeps deferred host paint as the default', () => {
	const deferred: ExtensionPanelComponent = { mount };
	const immediate: ExtensionPanelComponent = {
		mountTiming: 'immediate',
		mount,
	};

	assert.equal(deferred.mountTiming, undefined);
	assert.equal(immediate.mountTiming, 'immediate');
});
