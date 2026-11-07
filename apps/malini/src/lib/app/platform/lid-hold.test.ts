import { describe, expect, it } from 'vitest';
import { administratorScript, batteryLow, lidTools, sleepDisabled } from './lid-hold';

describe('the lid hold', () => {
	it('reads SleepDisabled from pmset -g, absent meaning off', () => {
		expect(sleepDisabled('System-wide power settings:\n SleepDisabled\t\t1\n sleep 1\n')).toBe(
			true,
		);
		expect(sleepDisabled(' SleepDisabled\t\t0\n')).toBe(false);
		expect(sleepDisabled(' SleepDisabled\t\t10\n')).toBe(false);
		expect(sleepDisabled(' sleep                1 (sleep prevented by Electron)\n')).toBe(false);
	});

	it('lets go at 5% only on battery', () => {
		const battery = (source: string, percent: number): string =>
			`Now drawing from '${source}'\n -InternalBattery-0 (id=1)\t${percent}%; discharging; 0:10 remaining present: true\n`;
		expect(batteryLow(battery('Battery Power', 5))).toBe(true);
		expect(batteryLow(battery('Battery Power', 6))).toBe(false);
		expect(batteryLow(battery('AC Power', 2))).toBe(false);
		expect(batteryLow("Now drawing from 'AC Power'\n")).toBe(false);
	});

	it('quotes the root script for AppleScript', () => {
		expect(administratorScript(`printf '%s\\n' "a"`, 'Why')).toBe(
			`do shell script "printf '%s\\\\n' \\"a\\"" with prompt "Why" with administrator privileges`,
		);
	});

	it('takes fake tools only in an unpackaged build', () => {
		const env = { MALINI_LID_TOOLS: '/tmp/tools' };
		expect(lidTools(false, env).sudo).toBe('/tmp/tools/sudo');
		expect(lidTools(true, env)).toEqual({
			sudo: '/usr/bin/sudo',
			pmset: '/usr/bin/pmset',
			osascript: '/usr/bin/osascript',
		});
	});
});
