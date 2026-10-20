import { strict as assert } from 'node:assert';
import test from 'node:test';

import { needsFreshDevServer } from './dogfood.mjs';

test('source changes ride on the dev server watch', () => {
	assert.equal(
		needsFreshDevServer([
			'apps/malini/src/main/index.ts',
			'apps/malini/src/lib/chat/presentation/Chat.svelte',
			'packages/agent-bridge/src/cli.ts',
			'docs/packaging.md',
		]),
		false,
	);
});

test('a dependency change needs an install and a fresh dev server', () => {
	assert.equal(needsFreshDevServer(['pnpm-lock.yaml']), true);
	assert.equal(needsFreshDevServer(['packages/agent-bridge/package.json']), true);
	assert.equal(needsFreshDevServer(['pnpm-workspace.yaml']), true);
});

test('a build config change needs a fresh dev server', () => {
	assert.equal(needsFreshDevServer(['apps/malini/electron.vite.config.ts']), true);
	assert.equal(needsFreshDevServer(['apps/malini/svelte.config.mjs']), true);
	assert.equal(needsFreshDevServer(['tsconfig.base.json']), true);
	assert.equal(needsFreshDevServer(['packages/agent-bridge/scripts/generate-protocol.mjs']), true);
});
