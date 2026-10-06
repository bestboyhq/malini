import { describe, expect, it } from 'vitest';
import { DEFAULT_PUBLIC_ERROR_LIMIT, sanitizePublicError } from './error-sanitizer.js';

describe('sanitizePublicError', () => {
	it('redacts credential identifiers and bearer values before bounding output', () => {
		const sanitized = sanitizePublicError(
			`Request for org-production using <ak-live:secret/opaque>, ak-second-secret, sk-private-secret, Authorization: Bearer opaque-token, "authorization":"Bearer json-token", and "Authorization":["Bearer array-token"] failed. ${'x'.repeat(1_500)}`,
		);

		expect(sanitized).toHaveLength(DEFAULT_PUBLIC_ERROR_LIMIT);
		expect(sanitized).not.toMatch(
			/org-production|ak-live:secret|ak-second-secret|sk-private-secret|opaque-token|json-token|array-token/u,
		);
		expect(sanitized).toContain('Authorization: Bearer [redacted]');
		expect(sanitized).toContain('"authorization":"Bearer [redacted]"');
		expect(sanitized).toContain('"Authorization":["Bearer [redacted]"]');
		expect(sanitized).toMatch(/…$/u);
	});

	it('drops labeled and standalone raw provider response bodies', () => {
		expect(
			sanitizePublicError(
				'Provider rejected the request.\nResponse body: {"error":"org-secret sk-secret"}',
			),
		).toBe('Provider rejected the request.');
		expect(sanitizePublicError('{"error":{"message":"request for org-secret failed"}}')).toBe(
			'request for [redacted] failed',
		);
	});

	it('keeps ordinary body validation and bracketed build diagnostics intact', () => {
		expect(sanitizePublicError('Invalid request body: field x is required')).toBe(
			'Invalid request body: field x is required',
		);
		expect(sanitizePublicError('Build failed\n[vite] import is missing')).toBe(
			'Build failed\n[vite] import is missing',
		);
	});

	it('extracts nested provider messages before generic wrapper text', () => {
		expect(
			sanitizePublicError(
				'{"message":"API call failed","error":{"data":{"message":"Insufficient balance"}}}',
			),
		).toBe('Insufficient balance');
	});
});
