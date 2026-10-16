import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { GH_SHA256, verifySha256 } from './fetch-gh.mjs';

test('a download is accepted only when its sha256 matches the pinned one', () => {
	const bytes = new TextEncoder().encode('gh');
	const digest = createHash('sha256').update(bytes).digest('hex');

	assert.doesNotThrow(() => verifySha256(bytes, digest));
	assert.throws(() => verifySha256(bytes, GH_SHA256), /expected da922c20/u);
});
