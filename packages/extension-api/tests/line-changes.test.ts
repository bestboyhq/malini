import assert from 'node:assert/strict';
import test from 'node:test';
import { highlightDiffLines, type CodeToken } from '../src/code-highlight.js';
import { changedSpans } from '../src/line-changes.js';

function changedText(tokens: readonly CodeToken[] | undefined): string[] {
	return (tokens ?? []).filter((token) => token.changed).map((token) => token.text);
}

test('a replaced line marks only the words that changed, on both sides', () => {
	const tokens = highlightDiffLines(
		[
			{ text: 'export const answer = 41;', side: 'old' },
			{ text: 'export const answer = 42;', side: 'new' },
		],
		'typescript',
	);
	assert.deepEqual(tokens.map(changedText), [['41'], ['42']]);
	assert.equal(tokens[1]?.map((token) => token.text).join(''), 'export const answer = 42;');
});

test('changed words a space apart read as one change', () => {
	assert.deepEqual(changedSpans('open the old file now', 'open a new file now'), {
		before: [[5, 12]],
		after: [[5, 10]],
	});
});

test('a line rewritten from scratch is left for the line highlight alone', () => {
	const tokens = highlightDiffLines(
		[
			{ text: 'const total = items.length;', side: 'old' },
			{ text: 'return render(view);', side: 'new' },
		],
		'typescript',
	);
	assert.deepEqual(tokens.map(changedText), [[], []]);
});

test('lines pair up only inside one block of changes, never across unchanged lines', () => {
	const tokens = highlightDiffLines(
		[
			{ text: 'let mode = "light";', side: 'old' },
			{ text: 'keep();', side: 'both' },
			{ text: 'let mode = "dark";', side: 'new' },
		],
		'typescript',
	);
	assert.deepEqual(tokens.map(changedText), [[], [], []]);
});
