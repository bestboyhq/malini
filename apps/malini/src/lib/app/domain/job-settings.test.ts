import { describe, expect, it } from 'vitest';
import { JOBS_MAX_CONCURRENT_SETTING, JOBS_RECONCILER_SETTING } from '$contract/jobs';
import {
	MERGE_QUEUE_FIX_ATTEMPTS_SETTING,
	UPDATE_FROM_MAIN_TRIGGER_SETTING,
} from '$contract/pull-requests';
import { clampJobSetting, jobSettingFromInput, jobSettingsFromStored } from './job-settings';

describe('the job settings', () => {
	it('default when nothing is stored, and read what is', () => {
		expect(jobSettingsFromStored({})).toEqual({
			[JOBS_MAX_CONCURRENT_SETTING]: 3,
			[MERGE_QUEUE_FIX_ATTEMPTS_SETTING]: 3,
			[UPDATE_FROM_MAIN_TRIGGER_SETTING]: 'main-moves',
			[JOBS_RECONCILER_SETTING]: 'on',
		});
		expect(
			jobSettingsFromStored({
				[JOBS_MAX_CONCURRENT_SETTING]: '5',
				[MERGE_QUEUE_FIX_ATTEMPTS_SETTING]: '12',
				[UPDATE_FROM_MAIN_TRIGGER_SETTING]: 'merging',
				[JOBS_RECONCILER_SETTING]: 'off',
			}),
		).toEqual({
			[JOBS_MAX_CONCURRENT_SETTING]: 5,
			[MERGE_QUEUE_FIX_ATTEMPTS_SETTING]: 12,
			[UPDATE_FROM_MAIN_TRIGGER_SETTING]: 'merging',
			[JOBS_RECONCILER_SETTING]: 'off',
		});
	});

	it('clamp a stored value into its range and fall back on garbage', () => {
		expect(
			jobSettingsFromStored({
				[JOBS_MAX_CONCURRENT_SETTING]: '99',
				[MERGE_QUEUE_FIX_ATTEMPTS_SETTING]: 'lots',
				[UPDATE_FROM_MAIN_TRIGGER_SETTING]: 'hourly',
			}),
		).toEqual({
			[JOBS_MAX_CONCURRENT_SETTING]: 10,
			[MERGE_QUEUE_FIX_ATTEMPTS_SETTING]: 3,
			[UPDATE_FROM_MAIN_TRIGGER_SETTING]: 'main-moves',
			[JOBS_RECONCILER_SETTING]: 'on',
		});
	});

	it('clamp to whole numbers inside each range', () => {
		expect(clampJobSetting(JOBS_MAX_CONCURRENT_SETTING, 0)).toBe(1);
		expect(clampJobSetting(JOBS_MAX_CONCURRENT_SETTING, 2.6)).toBe(3);
		expect(clampJobSetting(MERGE_QUEUE_FIX_ATTEMPTS_SETTING, 21)).toBe(20);
	});

	it('keep the current value when the field is cleared or unreadable', () => {
		expect(jobSettingFromInput(JOBS_MAX_CONCURRENT_SETTING, '', 4)).toBe(4);
		expect(jobSettingFromInput(JOBS_MAX_CONCURRENT_SETTING, 'abc', 4)).toBe(4);
		expect(jobSettingFromInput(JOBS_MAX_CONCURRENT_SETTING, '50', 4)).toBe(10);
	});
});
