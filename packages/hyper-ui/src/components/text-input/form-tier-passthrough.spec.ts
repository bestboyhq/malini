import { flushSync, mount, unmount, type Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Select from '../select/Select.svelte';
import Textarea from '../textarea/Textarea.svelte';
import TextInput from './TextInput.svelte';

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

afterEach(() => {
	while (mounted.length > 0) {
		const entry = mounted.pop();
		if (!entry) continue;
		void unmount(entry.component);
		entry.host.remove();
	}
});

describe('data-* lands on the control, not the wrapper', () => {
	it('puts it on the input a spec fills', () => {
		const host = render(TextInput, {
			label: 'Provider token',
			'data-testid': 'provider-auth-token',
		});

		expect(host.querySelector('label')?.dataset.testid).toBeUndefined();
		expect(host.querySelector('input')?.dataset.testid).toBe('provider-auth-token');
	});

	it('puts it on the textarea a spec types into', () => {
		const host = render(Textarea, {
			ariaLabel: 'Message',
			'data-testid': 'message-composer-input',
		});

		expect(host.querySelector('textarea')?.dataset.testid).toBe('message-composer-input');
	});

	it('puts it on the select a spec calls selectOption on', () => {
		const host = render(Select, {
			label: 'Planning model',
			options: [{ value: 'opus', label: 'Opus' }],
			'data-testid': 'planning-model',
		});

		expect(host.querySelector('label')?.dataset.testid).toBeUndefined();
		expect(host.querySelector('select')?.dataset.testid).toBe('planning-model');
	});
});

describe('a bare field joining a row that is already a label', () => {
	it('wraps nothing of its own when it has neither label nor hint', () => {
		const input = render(TextInput, { bare: true, ariaLabel: 'Filter workstreams' });
		const textarea = render(Textarea, { bare: true, ariaLabel: 'Message' });

		expect(input.querySelector('label')).toBeNull();
		expect(textarea.querySelector('label')).toBeNull();
	});

	it('still wraps when it has something to wrap', () => {
		const host = render(TextInput, { bare: true, label: 'Filter', ariaLabel: 'Filter' });

		expect(host.querySelector('label')).not.toBeNull();
	});
});
