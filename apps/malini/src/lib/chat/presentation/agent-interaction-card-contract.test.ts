import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readChatMessageListSource } from './chat-message-list-source.testkit';

const card = readFileSync(new URL('./AgentInteractionCard.svelte', import.meta.url), 'utf8');
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

	it('renders structured question controls through the application command boundary', () => {
		expect(card).toContain('<fieldset disabled={submitting}');
		expect(card).toContain("type={question.multiSelect ? 'checkbox' : 'radio'}");
		expect(card).toContain('Other answer');
		expect(card).toContain('answerQuestionCommand({');
		expect(messageList).toContain('<AgentInteractionCard {item} />');
		expect(messageList).toContain('const currentLength = currentEnvelopes.length;');
		expect(messageList).toContain('syncInteractionsCommand(currentSessionId, currentEnvelopes);');
	});
});
