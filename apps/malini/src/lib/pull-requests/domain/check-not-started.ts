import { untrustedSingleLine } from './untrusted-text';

const NOT_STARTED = /^The job was not started because (.+?)(?:\.(?:\s|$)|$)/u;
const REASON_LIMIT = 200;

export function checkNotStartedReason(
	annotations: readonly Readonly<{ level: string; message: string }>[],
): string | null {
	for (const { level, message } of annotations) {
		const reason = level === 'failure' ? NOT_STARTED.exec(message.trim())?.[1] : undefined;
		if (reason) return untrustedSingleLine(reason, REASON_LIMIT);
	}
	return null;
}
