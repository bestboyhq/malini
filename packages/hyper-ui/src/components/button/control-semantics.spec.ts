import { createRawSnippet, flushSync, mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Button from './Button.svelte';

const mounted: Array<{ host: HTMLElement; component: ReturnType<typeof mount> }> = [];

function render(props: ComponentProps<typeof Button>): HTMLElement {
	const host = document.createElement('div');
	document.body.append(host);
	const component = mount(Button, { target: host, props });
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

const label = createRawSnippet(() => ({ render: () => '<span>Compact</span>' }));

describe('a control whose role is not button', () => {
	it('keeps the radio semantics a segmented group is made of', () => {
		const host = render({ children: label, role: 'radio', ariaChecked: true });
		const control = query<HTMLButtonElement>(host, 'button');

		expect(control.getAttribute('role')).toBe('radio');
		expect(control.getAttribute('aria-checked')).toBe('true');
	});

	it('keeps the tab semantics a tab strip is made of', () => {
		const host = render({ children: label, role: 'tab', ariaSelected: false });
		const control = query<HTMLButtonElement>(host, 'button');

		expect(control.getAttribute('role')).toBe('tab');
		expect(control.getAttribute('aria-selected')).toBe('false');
	});

	it('reports a toggle state on the link branch, not only the button one', () => {
		const host = render({ children: label, href: '/dev/hyper-ui', ariaPressed: true });
		const control = query<HTMLAnchorElement>(host, 'a');

		expect(control.getAttribute('aria-pressed')).toBe('true');
	});
});

describe('attributes a call site drives the control by', () => {
	it('puts data-* on the control itself, where a spec looks for it', () => {
		const host = render({ children: label, 'data-testid': 'agent-process-died-reset' });
		const control = query<HTMLButtonElement>(host, 'button');

		expect(control.dataset.testid).toBe('agent-process-died-reset');
	});

	it('takes a row out of the tab order when the drawer holding it is collapsed', () => {
		const host = render({ children: label, tabindex: -1 });
		const control = query<HTMLButtonElement>(host, 'button');

		expect(control.tabIndex).toBe(-1);
	});
});

describe('pressing it', () => {
	it('is a real control with nothing inside it, for a full-row hit target', () => {
		const onclick = vi.fn();
		const host = render({ ariaLabel: 'Select message', onclick });
		const control = query<HTMLButtonElement>(host, 'button');

		expect(control.getAttribute('aria-label')).toBe('Select message');
		control.click();
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('does not fire while disabled, whether or not it is dimmed', () => {
		const onclick = vi.fn();
		const host = render({ children: label, disabled: true, dimmed: false, onclick });
		const control = query<HTMLButtonElement>(host, 'button');

		control.click();
		expect(onclick).not.toHaveBeenCalled();
		expect(control.disabled).toBe(true);
	});

	it('does not fire while disabled and bare', () => {
		const onclick = vi.fn();
		const host = render({ children: label, bare: true, disabled: true, onclick });
		const control = query<HTMLButtonElement>(host, 'button');

		control.click();
		expect(onclick).not.toHaveBeenCalled();
	});
});
