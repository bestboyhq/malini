import type { CommandFailure } from '../../contract/ipc';
import { stringProperty, thrownDetail } from '../diagnostics/thrown';

export function toCommandFailure(error: unknown, command: string): CommandFailure {
	const detail = thrownDetail(error);
	return {
		name: detail.name,
		message:
			detail.reason || `${command} failed and gave no reason: the handler threw ${detail.shape}`,
		code: detail.code,
		kind: detail.kind,
		command,
	};
}

export function workstreamIdOf(args: unknown): string | null {
	return stringProperty(args, 'workstreamId');
}
