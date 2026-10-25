import { describe, expect, it } from 'vitest';
import type { CustomSound } from '$contract/sounds';
import { nextRecordingLabel, playableSound } from './sounds';

function sound(id: string, label: string, kind: CustomSound['kind'] = 'recording'): CustomSound {
	return { id, label, kind, createdAt: '2026-10-25T00:00:00.000Z' };
}

describe('your own sounds', () => {
	it('names a new recording after the highest one you kept, never one already in the list', () => {
		expect(nextRecordingLabel([])).toBe('Recording 1');
		expect(nextRecordingLabel([sound('a', 'Recording 2'), sound('b', 'Doorbell', 'file')])).toBe(
			'Recording 3',
		);
		expect(nextRecordingLabel([sound('a', 'Recording 1'), sound('b', 'Recording 7')])).toBe(
			'Recording 8',
		);
	});

	it('plays the default for a moment whose sound you removed, and nothing for No sound', () => {
		const doorbell = sound('custom-1', 'Doorbell', 'file');
		expect(playableSound('custom-1', 'finished', [doorbell])).toBe('custom-1');
		expect(playableSound('custom-1', 'finished', [])).toBe('chime');
		expect(playableSound('custom-1', 'needs-you', [])).toBe('tethys');
		expect(playableSound('none', 'needs-you', [doorbell])).toBeNull();
	});
});
