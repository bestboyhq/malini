import { describe, expect, it } from 'vitest';
import {
	isSensitiveKey,
	redactSensitiveText,
	sanitizeDiagnosticText,
	sanitizeRoute,
} from './redaction';

describe('sanitizeRoute', () => {
	it('keeps the path, redacts query values, sorts keys and drops fragments', () => {
		expect(sanitizeRoute('/a/b?zeta=1&alpha=2#frag')).toBe(
			'/a/b?alpha=%5Bredacted%5D&zeta=%5Bredacted%5D',
		);
		expect(sanitizeRoute('https://app.example.com/x/y?k=v')).toBe('/x/y?k=%5Bredacted%5D');
		expect(sanitizeRoute('https://app.example.com')).toBe('/');
	});

	it('names an unparseable route rather than echoing it', () => {
		expect(sanitizeRoute('workstreams/ws-1')).toBe('/unparseable-renderer-route');
	});

	it('redacts token-shaped and oversized path segments and sanitizes query keys', () => {
		const token = `ghp_${'a'.repeat(36)}`;
		expect(sanitizeRoute(`/auth/${token}/done`)).toBe('/auth/%5Bredacted%5D/done');
		expect(sanitizeRoute(`/${'s'.repeat(129)}`)).toBe('/%5Bredacted%5D');
		expect(sanitizeRoute('/p?we ird=1&=2')).toBe('/p?query=%5Bredacted%5D&we_ird=%5Bredacted%5D');
	});
});

describe('redactSensitiveText', () => {
	it('redacts the home directory and user directory segments', () => {
		expect(redactSensitiveText('at /Users/alice/x and /home/bob/y', '')).toBe(
			'at /Users/[user]/x and /home/[user]/y',
		);
		expect(redactSensitiveText('/Users/alice/app crashed', '/Users/alice')).toBe(
			'[home]/app crashed',
		);
	});

	it('redacts url credentials, auth schemes and key=value assignments', () => {
		expect(redactSensitiveText('https://user:pw@host/path', '')).toBe(
			'https://[redacted]@host/path',
		);
		expect(redactSensitiveText('https://host/path', '')).toBe('https://host/path');
		expect(redactSensitiveText('Bearer abc.def', '')).toBe('Bearer [redacted]');
		expect(redactSensitiveText('password: "p w"; api_key=k1, session=\'s\'', '')).toBe(
			'password: "[redacted]"; api_key=[redacted], session=\'[redacted]\'',
		);
		expect(redactSensitiveText('max_tokens=4096 token_count=3 key=value', '')).toBe(
			'max_tokens=4096 token_count=3 key=value',
		);
	});

	it('redacts github tokens, jwts and emails by shape', () => {
		const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig';
		expect(
			redactSensitiveText(`ghp_${'x'.repeat(30)} github_pat_${'y'.repeat(40)} ${jwt} a@b.co`, ''),
		).toBe('[redacted-token] [redacted-token] [redacted-token] [redacted-email]');
		expect(redactSensitiveText('ghp_short not@dot a@b.', '')).toBe('ghp_short not@dot a@b.');
	});
});

describe('sanitizeDiagnosticText', () => {
	it('flattens control characters, redacts, bounds and falls back when nothing is left', () => {
		expect(sanitizeDiagnosticText('a\u0000b\nc token=secret', 80, false, 'fallback', '')).toBe(
			'a b c token=[redacted]',
		);
		expect(sanitizeDiagnosticText('line one\nline two', 80, true, 'fallback', '')).toBe(
			'line one\nline two',
		);
		expect(sanitizeDiagnosticText('abcdef', 3, false, 'fallback', '')).toBe('abc');
		expect(sanitizeDiagnosticText('   ', 80, false, 'fallback', '')).toBe('fallback');
		expect(sanitizeDiagnosticText('/home/me/app failed', 80, false, 'f', '/home/me')).toBe(
			'[home]/app failed',
		);
	});
});

const ANTHROPIC_KEY = `sk-ant-api03-${'A1b2C3d4'.repeat(10)}`;
const OPENAI_KEY = `sk-proj-${'Zy9Xw8Vu'.repeat(6)}`;

describe('provider secrets', () => {
	it('redacts environment assignments whose name ends in a secret word', () => {
		const environment = [
			`ANTHROPIC_API_KEY=${ANTHROPIC_KEY}`,
			`OPENAI_API_KEY=${OPENAI_KEY}`,
			'GITHUB_TOKEN=abc123',
			'CLIENT_SECRET=hunter2',
			'DB_PASSWORD="p w"',
			'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI',
		].join(' ');

		expect(redactSensitiveText(environment, '')).toBe(
			'ANTHROPIC_API_KEY=[redacted] OPENAI_API_KEY=[redacted] GITHUB_TOKEN=[redacted] CLIENT_SECRET=[redacted] DB_PASSWORD="[redacted]" AWS_SECRET_ACCESS_KEY=[redacted]',
		);
	});

	it('redacts an x-api-key header however it is quoted', () => {
		expect(redactSensitiveText(`{ 'x-api-key': '${ANTHROPIC_KEY}' }`, '')).toBe(
			"{ 'x-api-key': '[redacted]' }",
		);
		expect(redactSensitiveText(`headers: {"X-Api-Key":"${OPENAI_KEY}"}`, '')).toBe(
			'headers: {"X-Api-Key":"[redacted]"}',
		);
		expect(redactSensitiveText('x-api-key: plain-value', '')).toBe('x-api-key: [redacted]');
	});

	it('redacts provider key shapes wherever they appear, and leaves ordinary words alone', () => {
		const organization = `org-${'Q7r8S9t0'.repeat(3)}`;
		const moonshot = `ak-${'m0o0n1s2'.repeat(3)}`;

		expect(
			redactSensitiveText(
				`401 for ${ANTHROPIC_KEY} (${OPENAI_KEY}) in ${organization} via ${moonshot}`,
				'',
			),
		).toBe('401 for [redacted-token] ([redacted-token]) in [redacted-token] via [redacted-token]');
		expect(redactSensitiveText('task-runner sk-short org-chart malini-org-tools', '')).toBe(
			'task-runner sk-short org-chart malini-org-tools',
		);
	});

	it('names which keys count as secrets', () => {
		for (const key of [
			'ANTHROPIC_API_KEY',
			'x-api-key',
			'apiKey',
			'refresh_token',
			'PRIVATE_KEY',
		]) {
			expect(isSensitiveKey(key), key).toBe(true);
		}
		for (const key of ['max_tokens', 'token_count', 'key', 'monkey', 'keyboard']) {
			expect(isSensitiveKey(key), key).toBe(false);
		}
	});
});

describe('redaction cost', () => {
	it('sanitizes a 64K stack within one frame', () => {
		const frame =
			'    at Object.handler (/Users/alice/dev/malini/out/main/index.js:1234:56) token=abc\n';
		const stack = `Error: boom\n${frame.repeat(Math.ceil(65_536 / frame.length))}`.slice(0, 65_536);
		const run = (): string => sanitizeDiagnosticText(stack, 8_192, true, '', '/Users/alice');
		for (let warmup = 0; warmup < 3; warmup += 1) run();
		const durations = Array.from({ length: 10 }, () => {
			const started = performance.now();
			run();
			return performance.now() - started;
		});

		expect(run()).toContain(
			'    at Object.handler ([home]/dev/malini/out/main/index.js:1234:56) token=[redacted]',
		);
		expect(Math.min(...durations)).toBeLessThan(16);
	});
});
