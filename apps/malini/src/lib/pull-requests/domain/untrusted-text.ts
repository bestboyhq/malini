export function untrustedSingleLine(value: string, limit: number): string {
	return bounded(sanitizedLine(value), Math.max(0, Math.floor(limit)));
}

export function untrustedTail(value: string, limit: number): string {
	const lines = value.split(/\r?\n/u).map(sanitizedLine).filter(Boolean);
	return Array.from(lines.join('\n'))
		.slice(-Math.max(1, Math.floor(limit)))
		.join('');
}

export function codePointLength(value: string): number {
	return Array.from(value).length;
}

function sanitizedLine(value: string): string {
	return redactSecrets(stripUnsafeCharacters(value)).replace(/\s+/gu, ' ').trim();
}

function stripUnsafeCharacters(value: string): string {
	return value
		.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/gu, '')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, ' ')
		.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, ' ');
}

function redactSecrets(value: string): string {
	return value
		.replace(/\b(Bearer)\s+[^\s]+/giu, '$1 [redacted]')
		.replace(/\b(gh[opusr]_[A-Za-z0-9_]{8,})\b/gu, '[redacted]')
		.replace(
			/\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*([^\s,;]+)/giu,
			'$1=[redacted]',
		)
		.replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/giu, '$1[redacted]@');
}

function bounded(value: string, limit: number): string {
	return Array.from(value).slice(0, limit).join('');
}
