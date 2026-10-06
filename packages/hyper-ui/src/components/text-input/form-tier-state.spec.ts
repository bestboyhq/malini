import { createRawSnippet, flushSync, mount, unmount, type Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Checkbox from '../checkbox/Checkbox.svelte';
import ColorPicker from '../color-picker/ColorPicker.svelte';
import ComposerShell from '../composer-shell/ComposerShell.svelte';
import Select from '../select/Select.svelte';

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

function firstElement(host: HTMLElement): HTMLElement {
	const element = host.firstElementChild;
	if (!(element instanceof HTMLElement)) throw new Error('Missing first element');
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

describe('checkbox third state', () => {
	it('reports indeterminate rather than a plain unchecked box', () => {
		const host = render(Checkbox, { label: 'Select all', indeterminate: true });
		const input = query<HTMLInputElement>(host, 'input[type="checkbox"]');

		expect(input.indeterminate).toBe(true);
		expect(input.checked).toBe(false);
	});

	it('leaves a normal checkbox determinate', () => {
		const host = render(Checkbox, { label: 'Notify me', checked: true });
		const input = query<HTMLInputElement>(host, 'input[type="checkbox"]');

		expect(input.indeterminate).toBe(false);
		expect(input.checked).toBe(true);
	});
});

describe('select grouped options', () => {
	const grouped = [
		{ value: '', label: 'No preference' },
		{
			label: 'Anthropic',
			options: [
				{ value: 'anthropic:opus', label: 'Opus' },
				{ value: 'anthropic:sonnet', label: 'Sonnet' },
			],
		},
		{ label: 'OpenAI', options: [{ value: 'openai:gpt-5', label: 'GPT-5', disabled: true }] },
	];

	it('makes every grouped option selectable and starts on the given value', () => {
		const host = render(Select, {
			label: 'Planning model',
			options: grouped,
			value: 'anthropic:sonnet',
		});
		const select = query<HTMLSelectElement>(host, 'select');

		expect([...select.options].map((option) => option.value)).toEqual([
			'',
			'anthropic:opus',
			'anthropic:sonnet',
			'openai:gpt-5',
		]);
		expect(select.value).toBe('anthropic:sonnet');
	});

	it('keeps an option marked disabled unselectable', () => {
		const host = render(Select, { label: 'Planning model', options: grouped, value: '' });
		const select = query<HTMLSelectElement>(host, 'select');

		expect([...select.options].find((option) => option.value === 'openai:gpt-5')?.disabled).toBe(
			true,
		);
	});

	it('still accepts a flat option list', () => {
		const host = render(Select, {
			label: 'Visibility',
			options: [
				{ value: 'private', label: 'Private' },
				{ value: 'team', label: 'Team' },
			],
			value: 'team',
		});
		const select = query<HTMLSelectElement>(host, 'select');

		expect(select.value).toBe('team');
	});
});

describe('color picker hex field', () => {
	it('reports a color only once the hex is complete', () => {
		const onchange = vi.fn();
		const host = render(ColorPicker, { value: '#3B82F6', onchange });
		const field = query<HTMLInputElement>(host, 'input[type="text"]');

		field.value = '#12';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onchange).not.toHaveBeenCalled();

		field.value = '#8B5CF6';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onchange).toHaveBeenCalledWith('#8B5CF6');
	});

	it('is controlled, so characters that are not hex never survive a keystroke', () => {
		const host = render(ColorPicker, { value: '#3B82F6' });
		const field = query<HTMLInputElement>(host, 'input[type="text"]');

		field.value = 'zz8b5c';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		expect(field.value).toBe('#8B5C');
	});

	it('snaps a half-typed hex back to the live color on blur', () => {
		const host = render(ColorPicker, { value: '#3B82F6' });
		const field = query<HTMLInputElement>(host, 'input[type="text"]');

		field.value = '#12';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		field.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		flushSync();

		expect(field.value).toBe('#3B82F6');
	});
});

describe('composer shell disabled', () => {
	const editor = createRawSnippet(() => ({
		render: () => '<textarea aria-label="Message"></textarea>',
	}));

	it('takes the whole composer out of service, not just the editor', () => {
		const host = render(ComposerShell, { disabled: true, children: editor });
		const shell = firstElement(host);

		expect(shell.inert).toBe(true);
		expect(shell.getAttribute('aria-disabled')).toBe('true');
	});

	it('leaves an enabled composer fully interactive', () => {
		const host = render(ComposerShell, { disabled: false, children: editor });
		const shell = firstElement(host);

		expect(shell.inert).toBe(false);
		expect(shell.getAttribute('aria-disabled')).toBeNull();
	});
});
