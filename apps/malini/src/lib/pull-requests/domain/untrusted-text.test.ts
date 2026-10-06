import { describe, expect, it } from 'vitest';
import { sanitizePullRequestContextValue } from '@malini-extension/repository';
import { codePointLength, untrustedSingleLine } from './untrusted-text';

const SAMPLES: readonly string[] = [
	'',
	'   ',
	'plain text',
	'first line\nsecond line\r\nthird\tline',
	'\u001b[31mred\u001b[0m and \u001b]0;title\u0007 and \u001b]8;;link\u001b\\',
	'nul\u0000 bell\u0007 del\u007f c1\u0085 end',
	'zero\u200bwidth \u202eright-to-left\u202c \u2066isolate\u2069 bom\ufeff',
	'Authorization: Bearer abc.def.ghi and bearer lower-case-token',
	'token ghp_abcdefgh12345678 gho_ABCDEFGH_1234 ghs_short',
	'api_key=one api-key: two apikey=three access_token=four auth-token: five',
	'password=hunter2, secret: s3cr3t; PASSWORD = shouted',
	'https://user:pass@example.com/path and http://a:b@host',
	'emoji 👩‍💻 and accents café, 漢字',
	`long ${'x'.repeat(2_000)}`,
	`${'🙂'.repeat(50)}`,
];

const LIMITS: readonly number[] = [0, 1, 7, 40, 400, 1_200, 10_000, 3.7, -5];

describe('untrusted single-line text', () => {
	it('sanitizes exactly like the repository extension it quotes', () => {
		for (const sample of SAMPLES) {
			for (const limit of LIMITS) {
				expect(untrustedSingleLine(sample, limit)).toBe(
					sanitizePullRequestContextValue(sample, limit),
				);
			}
		}
	});

	it('never leaves a control character, a line break or a known secret shape', () => {
		const line = untrustedSingleLine(
			'a\nb\u001b[1m c\u202e Bearer t0k3n ghp_abcdefgh12345678 password=hunter2',
			400,
		);
		expect(line).toBe('a b c Bearer [redacted] [redacted] password=[redacted]');
	});

	it('bounds by code points, not UTF-16 units', () => {
		expect(codePointLength(untrustedSingleLine('🙂'.repeat(10), 4))).toBe(4);
	});
});
