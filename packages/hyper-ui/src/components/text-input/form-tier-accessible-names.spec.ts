import { flushSync, mount, unmount, type Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Autocomplete from '../autocomplete/Autocomplete.svelte';
import Switch from '../switch/Switch.svelte';
import Textarea from '../textarea/Textarea.svelte';

const mounted: Array<{ host: HTMLElement; component: ReturnType<typeof mount> }> = [];

function render<Props extends Record<string, unknown>>(
	Component: Component<Props>,
	props: Props,
): HTMLElement {
	const host = document.createElement('div');
	document.body.append(host);
	const component = mount(Component, { target: host, props });
	mounted.push({ host, component });
	flushSync();
	return host;
}

function query<ElementType extends Element>(host: ParentNode, selector: string): ElementType {
	const element = host.querySelector<ElementType>(selector);
	if (!element) throw new Error(`Missing element for ${selector}`);
	return element;
}

afterEach(() => {
	while (mounted.length > 0) {
		const entry = mounted.pop();
		if (!entry) continue;
		void unmount(entry.component);
		entry.host.remove();
	}
});

function accessibleName(control: Element): string | null {
	const aria = control.getAttribute('aria-label');
	if (aria) return aria;

	const labelledBy = control.getAttribute('aria-labelledby');
	if (labelledBy) return document.getElementById(labelledBy)?.textContent?.trim() ?? null;

	const id = control.getAttribute('id');
	if (id) {
		const label = [...document.querySelectorAll('label[for]')].find(
			(candidate) => candidate.getAttribute('for') === id,
		);
		if (label) return label.textContent?.trim() ?? null;
	}

	return control.closest('label')?.textContent?.trim() ?? null;
}

describe('form tier accessible names', () => {
	it('names a textarea that has no visible label', () => {
		const host = render(Textarea, { ariaLabel: 'Edit message', bare: true });
		const textarea = query<Element>(host, 'textarea');

		expect(accessibleName(textarea)).toBe('Edit message');
	});

	it('leaves an unnamed switch unnamed instead of calling it "Toggle"', () => {
		const unnamed = render(Switch, { checked: false, onchange: () => {} });
		expect(accessibleName(query<Element>(unnamed, '[role="switch"]'))).toBeNull();

		const named = render(Switch, {
			checked: false,
			ariaLabel: 'Private channel',
			onchange: () => {},
		});
		expect(accessibleName(query<Element>(named, '[role="switch"]'))).toBe('Private channel');
	});

	it('gives an autocomplete a name from its visible label', () => {
		const host = render(Autocomplete, { label: 'Reviewers', options: [] });
		const input = query<Element>(host, 'input[role="combobox"]');

		expect(accessibleName(input)).toBe('Reviewers');
	});

	it('points each autocomplete on a page at its own listbox', () => {
		const options = [{ value: 'a', label: 'Ana' }];
		const first = render(Autocomplete, { label: 'Reviewers', options });
		const second = render(Autocomplete, { label: 'Watchers', options });

		const inputs = [first, second].map((host) =>
			query<HTMLInputElement>(host, 'input[role="combobox"]'),
		);

		for (const input of inputs) {
			input.dispatchEvent(new FocusEvent('focus'));
		}
		flushSync();

		const controlled = inputs.map((input) => input.getAttribute('aria-controls'));
		expect(controlled[0]).toBeTruthy();
		expect(controlled[0]).not.toBe(controlled[1]);

		expect(first.querySelector(`[id="${controlled[0]}"]`)).not.toBeNull();
		expect(second.querySelector(`[id="${controlled[1]}"]`)).not.toBeNull();
	});

	it('claims no listbox while the list is closed', () => {
		const host = render(Autocomplete, { label: 'Reviewers', options: [] });
		const input = query<HTMLInputElement>(host, 'input[role="combobox"]');

		expect(input.getAttribute('aria-controls')).toBeNull();
		expect(input.getAttribute('aria-expanded')).toBe('false');
	});
});
