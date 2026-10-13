import { hasTurnReport, parseTurnReport, type TurnReport } from '$lib/chat/domain/turn-report';
import type { RunGroup } from './render-state';

export function finalTurnReport(run: RunGroup, itemKey: string, text: string): TurnReport | null {
	if (run.terminal !== 'completed' || lastAssistantKey(run) !== itemKey) return null;
	const report = parseTurnReport(text);
	return hasTurnReport(report) ? report : null;
}

function lastAssistantKey(run: RunGroup): string | null {
	for (let index = run.items.length - 1; index >= 0; index -= 1) {
		const item = run.items[index];
		if (item?.kind === 'assistant') return item.key;
	}
	return null;
}
