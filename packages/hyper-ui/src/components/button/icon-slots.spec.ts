import { createRawSnippet, flushSync, mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Button from './Button.svelte';

const mounted: Array<{ host: HTMLElement; component: ReturnType<typeof mount> }> = [];

function render(props: ComponentProps<typeof Button>): HTMLButtonElement {
	const host = document.createElement('div');
	document.body.append(host);
	const component = mount(Button, { target: host, props });
	mounted.push({ host, component });
	flushSync();
	const control = host.querySelector('button');
	if (!control) throw new Error('Button did not render a button');
	return control;
}

afterEach(() => {
	while (mounted.length > 0) {
		const entry = mounted.pop();
		if (!entry) continue;
		void unmount(entry.component);
		entry.host.remove();
	}
});

const label = createRawSnippet(() => ({
	render: () => '<span data-part="label">Clone URL</span>',
}));
const leading = createRawSnippet(() => ({ render: () => '<span data-part="leading"></span>' }));
const trailing = createRawSnippet(() => ({ render: () => '<span data-part="trailing"></span>' }));

function parts(control: HTMLButtonElement): Array<string | undefined> {
	return Array.from(control.children, (child) =>
		child instanceof HTMLElement ? child.dataset.part : child.tagName.toLowerCase(),
	);
}

describe('icon slots', () => {
	it('puts the leading icon before the label and the trailing icon after it', () => {
		const control = render({ children: label, leading, trailing });

		expect(parts(control)).toEqual(['leading', 'label', 'trailing']);
	});

	it('shows the spinner in place of the leading icon while loading', () => {
		const control = render({ children: label, leading, loading: true });

		expect(parts(control)).toEqual(['svg', 'label']);
		expect(control.getAttribute('aria-busy')).toBe('true');
	});

	it('keeps the trailing icon while loading', () => {
		const control = render({ children: label, trailing, loading: true });

		expect(parts(control)).toEqual(['svg', 'label', 'trailing']);
	});
});
