import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import TopBar from './TopBar.svelte';
import {
	globalTopBarGithubStatus,
	type GlobalTopBarGithubStatus,
} from '$shared/shell/global-topbar-actions.svelte';

const OWNER = 'branch-headline-spec';
const BRANCH = 'malini/01J86E335E2FABB4969AA5C88A → main';

function statusWithoutPullRequest(): GlobalTopBarGithubStatus {
	return {
		reference: null,
		title: null,
		branch: BRANCH,
		checks: [],
		checksSummary: 'No checks yet',
		review: null,
		todos: null,
		action: null,
	};
}

function statusWithPullRequest(): GlobalTopBarGithubStatus {
	return { ...statusWithoutPullRequest(), reference: '#42', title: 'Land the branch headline' };
}

let stop: (() => void) | null = null;

function openDetail(status: GlobalTopBarGithubStatus): HTMLElement {
	globalTopBarGithubStatus.publish(OWNER, status);
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(TopBar, { target: host, props: {} });
	flushSync();
	stop = () => {
		void unmount(app);
		host.remove();
		globalTopBarGithubStatus.clear(OWNER);
	};
	const disclosure = host.querySelector<HTMLButtonElement>(
		'[data-testid="global-topbar-github-status"]',
	);
	if (!disclosure) throw new Error('the detail disclosure is not in the bar');
	disclosure.click();
	flushSync();
	const panel = document.querySelector<HTMLElement>('[role="dialog"]');
	if (!panel) throw new Error('the detail panel did not open');
	return panel;
}

function occurrencesOfBranch(panel: HTMLElement): number {
	return (panel.textContent ?? '').split(BRANCH).length - 1;
}

afterEach(() => {
	stop?.();
	stop = null;
});

describe('the top bar detail headline', () => {
	it('names the branch once when the workstream has no pull request yet', () => {
		expect(occurrencesOfBranch(openDetail(statusWithoutPullRequest()))).toBe(1);
	});

	it('still names the branch under the pull request title once one exists', () => {
		const panel = openDetail(statusWithPullRequest());
		expect(panel.textContent).toContain('Land the branch headline');
		expect(occurrencesOfBranch(panel)).toBe(1);
	});
});
