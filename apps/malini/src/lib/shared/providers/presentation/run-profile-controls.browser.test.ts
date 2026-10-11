import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_RUN_PROFILE, type AgentRunProfile } from '../domain/run-profile';
import RunProfileControls from './RunProfileControls.svelte';

let stop: (() => void) | null = null;

afterEach(() => {
	stop?.();
	stop = null;
});

function render(profile: AgentRunProfile): AgentRunProfile[] {
	const changes: AgentRunProfile[] = [];
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(RunProfileControls, {
		target: host,
		props: { model: 'sonnet', profile, onchange: (next) => changes.push(next) },
	});
	flushSync();
	stop = () => {
		void unmount(app);
		host.remove();
	};
	return changes;
}

function button(name: string): HTMLButtonElement {
	const match = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(candidate) => candidate.getAttribute('aria-label') === name,
	);
	if (!match) throw new Error(`No button named ${name}`);
	return match;
}

function reportLevels(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[role="listbox"][aria-label="Report levels"]');
}

function option(listbox: HTMLElement, name: string): HTMLElement {
	const match = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) =>
		candidate.textContent?.trim().startsWith(name),
	);
	if (!match) throw new Error(`No option named ${name}`);
	return match;
}

describe('the report chip', () => {
	it('shows the chosen report and switches the profile to the one picked', () => {
		const changes = render({ ...DEFAULT_AGENT_RUN_PROFILE, report: 'medium' });
		const chip = button('Report');
		expect(chip.textContent?.trim()).toBe('Medium');
		expect(chip.getAttribute('aria-expanded')).toBe('false');

		chip.click();
		flushSync();
		const levels = reportLevels();
		if (!levels) throw new Error('the report levels did not open');
		expect(chip.getAttribute('aria-expanded')).toBe('true');
		expect(option(levels, 'Medium').getAttribute('aria-selected')).toBe('true');
		expect(option(levels, 'Low').textContent).toContain('A screenshot and one line');

		option(levels, 'Low').click();
		flushSync();

		expect(changes).toEqual([{ ...DEFAULT_AGENT_RUN_PROFILE, report: 'low' }]);
		expect(chip.getAttribute('aria-expanded')).toBe('false');
	});
});
