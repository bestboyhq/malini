import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./TopBar.svelte', import.meta.url), 'utf8');

const markup = source.slice(source.indexOf('</script>'), source.indexOf('<style>'));

const restingState = (() => {
	const start = markup.indexOf('<Popover');
	const end = markup.indexOf('</Popover>');
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	return `${markup.slice(0, start)}${markup.slice(end)}`;
})();

function occurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

describe('the resting global top bar', () => {
	it('draws the git actions, one status and one way to open the detail', () => {
		expect(occurrences(restingState, "'global-topbar-github-action'")).toBe(1);
		expect(occurrences(restingState, "'global-topbar-github-secondary-action'")).toBe(1);
		expect(occurrences(restingState, 'data-testid="global-topbar-github-headline"')).toBe(1);
		expect(occurrences(restingState, 'data-testid="global-topbar-github-status"')).toBe(1);
		expect(restingState).toContain('aria-haspopup="dialog"');
	});

	it('runs a confirming action only on its second click', () => {
		expect(source).toContain('if (action.confirmLabel && armedDetailId !== armId)');
	});

	it.each([
		'github-pill',
		'githubStatus.summary',
		'githubStatus.tone',
		'blockingCount',
		'githubPillLabel',
	])('never renders %s anywhere', (banned) => {
		expect(source).not.toContain(banned);
	});

	it('names the pull request in the resting bar and opens it on GitHub', () => {
		expect(restingState).toContain('data-testid="global-topbar-github-reference"');
		expect(restingState).toContain('onclick={() => openPullRequestUrl(url)}');
	});

	it.each([
		'githubPanelHeadline',
		'githubStatus.branch',
		'githubStatus.checks',
		'githubStatus.checksSummary',
		'githubStatus.review',
		'githubStatus.todos',
		'githubStatus.changes',
		'tone-dot',
	])('keeps %s behind the disclosure', (detail) => {
		expect(markup).toContain(detail);
		expect(restingState).not.toContain(detail);
	});

	it('offers the pull request on GitHub from the disclosure', () => {
		expect(markup).toContain('data-testid="global-topbar-github-open"');
		expect(restingState).not.toContain('data-testid="global-topbar-github-open"');
		expect(source).toContain('openExternalUrlCommand(url)');
	});

	it('lists non-next actions in the disclosure only', () => {
		expect(markup).toContain('githubDetailActions');
		expect(restingState).not.toContain('githubDetailActions');
	});

	it.each(['Refreshing', 'githubStatus.refreshing', 'github-panel__refreshing'])(
		'never announces a background read with %s',
		(banned) => {
			expect(source).not.toContain(banned);
		},
	);
});

describe('the published GitHub status', () => {
	const contract = readFileSync(
		new URL('../../shared/shell/global-topbar-actions.svelte.ts', import.meta.url),
		'utf8',
	);

	it('carries no in-flight flag for the shell to render', () => {
		expect(contract).not.toContain('refreshing: boolean');
	});
});
