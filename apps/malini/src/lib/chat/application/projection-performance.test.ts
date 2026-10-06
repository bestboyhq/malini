import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const followChatRoute = readFileSync(
	new URL('./hooks/follow-chat-route.hook.svelte.ts', import.meta.url),
	'utf8',
);

describe('chat projection performance contract', () => {
	it('opens the routed chat in a pre-paint effect ahead of the bootstrap effect', () => {
		const seedAt = followChatRoute.indexOf(
			'transcriptAggregate.seedProjection(chatRoute.workstreamId, chatRoute.readSessionParam());',
		);
		const prepaintAt = followChatRoute.indexOf('$effect.pre(() => {', seedAt);
		const openAt = followChatRoute.indexOf('openWorkstreamChatCommand(workstreamId);', prepaintAt);
		const bootstrapEffectAt = followChatRoute.indexOf('$effect(() => {', openAt);
		const bootAt = followChatRoute.indexOf('bootChatCommand(workstreamId);', bootstrapEffectAt);

		expect(seedAt).toBeGreaterThan(-1);
		expect(prepaintAt).toBeGreaterThan(seedAt);
		expect(openAt).toBeGreaterThan(prepaintAt);
		expect(followChatRoute.indexOf('$effect(() => {')).toBe(bootstrapEffectAt);
		expect(bootAt).toBeGreaterThan(bootstrapEffectAt);
	});
});
