import { flushSync, mount, unmount, type Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TextInput from '../text-input/TextInput.svelte';
import SensitiveText from './SensitiveText.svelte';
import { maskSensitiveHtml, revealSensitiveTarget } from './sensitive-dom';

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

function revealControls(root: ParentNode, name: string): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('[role="button"]')].filter(
		(element) => element.getAttribute('aria-label') === name,
	);
}

async function settled(): Promise<void> {
	await Promise.resolve();
	flushSync();
}

afterEach(() => {
	while (mounted.length > 0) {
		const entry = mounted.pop();
		if (!entry) continue;
		void unmount(entry.component);
		entry.host.remove();
	}
});

describe('sensitive text', () => {
	it('hides an email behind a reveal control until it is clicked', () => {
		const host = render(SensitiveText, { text: 'Signed in as ada@example.com · Max' });
		const [control] = revealControls(host, 'Reveal email address');
		expect(control).toBeDefined();

		control?.click();
		flushSync();

		expect(revealControls(host, 'Reveal email address')).toHaveLength(0);
		expect(host.textContent).toBe('Signed in as ada@example.com · Max');
	});

	it('reveals a user name in rendered markup by click, leaving the text intact', () => {
		const host = document.createElement('div');
		host.innerHTML = maskSensitiveHtml('<p>Wrote <code>/Users/ada/notes.md</code></p>');
		document.body.append(host);
		const [control] = revealControls(host, 'Reveal user name');
		expect(control).toBeDefined();

		host.addEventListener('click', (event) => revealSensitiveTarget(event));
		control?.click();

		expect(revealControls(host, 'Reveal user name')).toHaveLength(0);
		expect(host.textContent).toBe('Wrote /Users/ada/notes.md');
		host.remove();
	});
});

describe('sensitive fields', () => {
	it('masks a typed value until the field is focused, and again after it leaves', async () => {
		const host = render(TextInput, { label: 'Clone URL', value: 'https://example.com/ada/repo' });
		const input = host.querySelector('input');
		if (!input) throw new Error('missing input');
		const mask = (): Element | null => host.querySelector('[data-testid="sensitive-field-mask"]');

		expect(mask()).not.toBeNull();

		input.focus();
		await settled();
		expect(mask()).toBeNull();

		input.blur();
		await settled();
		expect(mask()).not.toBeNull();
	});

	it('leaves an empty field and a password field without a mask', () => {
		const empty = render(TextInput, { label: 'Search', value: '' });
		const password = render(TextInput, {
			label: 'Token',
			type: 'password' as const,
			value: 'secret',
		});

		expect(empty.querySelector('[data-testid="sensitive-field-mask"]')).toBeNull();
		expect(password.querySelector('[data-testid="sensitive-field-mask"]')).toBeNull();
	});
});
