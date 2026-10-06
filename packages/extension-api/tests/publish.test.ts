import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('@malini/extension-api stays private while exposing the complete internal contract', async () => {
	const packageJson = JSON.parse(
		await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
	) as {
		name: string;
		version: string;
		private?: boolean;
		publishConfig?: unknown;
		exports?: Record<string, unknown>;
	};
	assert.equal(packageJson.name, '@malini/extension-api');
	assert.match(packageJson.version, /^1\./u);
	assert.equal(packageJson.private, true);
	assert.equal(packageJson.publishConfig, undefined);
	assert.ok(packageJson.exports?.['.']);
	assert.ok(packageJson.exports?.['./test']);
	assert.equal(packageJson.exports?.['./manifest.schema.json'], './schema/manifest.schema.json');
});
