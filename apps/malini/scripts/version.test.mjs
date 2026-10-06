import { strict as assert } from 'node:assert';
import test from 'node:test';

import { nextVersion } from './version.mjs';

test('the first release is 0.1.0', () => {
	assert.equal(nextVersion(null, []), '0.1.0');
});

test('a fix or perf releases a patch', () => {
	assert.equal(nextVersion('0.3.1', ['fix(chat): keep the draft']), '0.3.2');
	assert.equal(nextVersion('0.3.1', ['perf: faster transcript']), '0.3.2');
});

test('a feat releases a minor and resets the patch', () => {
	assert.equal(nextVersion('0.3.1', ['fix: a', 'feat(routines): b']), '0.4.0');
});

test('a bang or a BREAKING CHANGE footer releases a major', () => {
	assert.equal(nextVersion('0.3.1', ['refactor!: drop smack data']), '1.0.0');
	assert.equal(nextVersion('0.3.1', ['feat: x\n\nBREAKING CHANGE: new schema']), '1.0.0');
});

test('only the subject line picks the type', () => {
	assert.equal(nextVersion('0.3.1', ['chore: bump\n\nfeat: not a subject']), null);
});

test('commits that do not change the app release nothing', () => {
	assert.equal(nextVersion('0.3.1', ['docs: x', 'ci: y', 'Merge pull request #4']), null);
});
