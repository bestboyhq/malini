import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentDiagnosticRoute } from './diagnostic-route';
import { createRendererErrorPayload } from './renderer-error-sink';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the route a renderer diagnostic names', () => {
	it('is the hash route the app is on, so a workstream failure names its workstream', () => {
		vi.stubGlobal('location', {
			href: 'http://localhost:5173/#/workstreams/ws-1?agent=chat-1',
			hash: '#/workstreams/ws-1?agent=chat-1',
		});

		expect(currentDiagnosticRoute()).toBe('/workstreams/ws-1?agent=chat-1');
		expect(createRendererErrorPayload({ source: 'caught', error: new Error('boom') }).route).toBe(
			'/workstreams/ws-1?agent=%5Bredacted%5D',
		);
	});

	it('falls back to the page address without a hash route, and to the root without a page', () => {
		vi.stubGlobal('location', { href: 'file:///app/index.html', hash: '' });
		expect(currentDiagnosticRoute()).toBe('file:///app/index.html');

		vi.stubGlobal('location', undefined);
		expect(currentDiagnosticRoute()).toBe('/');
	});
});
