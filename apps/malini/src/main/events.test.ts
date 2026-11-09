import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

import { diagnosticsRecordedDuring } from './diagnostics/test-support';
import { createEventBus } from './events';

describe('EventBus', () => {
	it('runs every listener when one throws, and records the throw as an error', () => {
		const bus = createEventBus({ forwardToWindows: false });
		const heard: string[] = [];
		bus.observe(() => {
			throw new Error('a broken observer');
		});
		bus.observe((channel) => heard.push(`observer ${channel}`));
		bus.subscribe('app:close-requested', () => {
			throw new Error('a broken listener');
		});
		bus.subscribe('app:close-requested', () => heard.push('listener'));

		const recorded = diagnosticsRecordedDuring(() => bus.emit('app:close-requested', {}));

		expect(heard).toEqual(['observer app:close-requested', 'listener']);
		expect(recorded).toEqual([
			expect.objectContaining({
				level: 'error',
				message: expect.stringContaining('a broken observer'),
			}),
			expect.objectContaining({
				level: 'error',
				message: expect.stringContaining('a broken listener'),
			}),
		]);
	});
});
