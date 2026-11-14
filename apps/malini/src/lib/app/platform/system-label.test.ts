import { describe, expect, it } from 'vitest';
import { systemLabel } from './system-label';

describe('systemLabel', () => {
	it('names the real system in usage data and problem reports', () => {
		expect(systemLabel('darwin', '26.1', 'arm64')).toBe('macOS 26.1 arm64');
		expect(systemLabel('win32', '10.0.26100', 'x64')).toBe('Windows 10.0.26100 x64');
		expect(
			systemLabel(
				'linux',
				'6.12.0-45-generic',
				'x64',
				'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\n',
			),
		).toBe('Linux 6.12.0 x64 (Ubuntu 24.04)');
		expect(systemLabel('linux', '6.17.4-arch1-1', 'arm64', 'NAME="Arch Linux"\nID=arch\n')).toBe(
			'Linux 6.17.4 arm64 (Arch Linux)',
		);
		expect(systemLabel('linux', '6.12.0', 'x64')).toBe('Linux 6.12.0 x64');
	});
});
