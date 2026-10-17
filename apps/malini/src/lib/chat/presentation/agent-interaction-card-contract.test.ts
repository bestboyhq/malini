import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readChatMessageListSource } from './chat-message-list-source.testkit';

const card = readFileSync(new URL('./AgentInteractionCard.svelte', import.meta.url), 'utf8');
const panel = readFileSync(new URL('./AgentQuestionPanel.svelte', import.meta.url), 'utf8');
const surface = readFileSync(new URL('./ChatSurface.svelte', import.meta.url), 'utf8');
const messageList = readChatMessageListSource(new URL('./', import.meta.url));
const commands = readFileSync(
	new URL('../infrastructure/aggregates/agent-interactions.aggregate.svelte.ts', import.meta.url),
	'utf8',
);

describe('agent interaction card contract', () => {
	it('wires each permission decision to the approval command, broader scopes only when persistable', () => {
		expect(card).toContain('aria-labelledby={headingId}');
		expect(card).toContain("onclick={() => decideApproval(item, 'deny', 'once')}");
		expect(card).toContain("onclick={() => decideApproval(item, 'allow', 'once')}");
		expect(card).toContain("onSelect={() => decideApproval(item, 'allow', 'session')}");
		expect(card).toContain("onSelect={() => decideApproval(item, 'allow', 'workstream')}");
		expect(card).toContain('{#if canOfferPersistentScope}');
		expect(card).toContain('decideApprovalCommand({');
		expect(commands).toContain("'Allowed for this workstream'");
		expect(card).toContain('role="alert"');
	});

	it('answers questions from the composer slot, never from the transcript', () => {
		expect(panel).toContain('answerQuestionCommand({');
		expect(panel).toContain('onclick={cancelRunCommand}');
		expect(surface).toContain('<AgentQuestionPanel request={questionRequest} />');
		expect(surface).toContain("class={[questionRequest && 'hidden']}");
		expect(messageList).toContain('<AgentQuestionRow {item} />');
		expect(messageList).not.toContain('answerQuestionCommand');
		expect(messageList).toContain('const currentLength = currentEnvelopes.length;');
		expect(messageList).toContain('syncInteractionsCommand(currentSessionId, currentEnvelopes);');
	});
});
