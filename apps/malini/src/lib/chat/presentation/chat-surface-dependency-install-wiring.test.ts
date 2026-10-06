import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatSurface = readFileSync(new URL('./ChatSurface.svelte', import.meta.url), 'utf8');

describe('dependency install wiring on the chat surface', () => {
	it('renders the install over a live transcript instead of over another wall', () => {
		const bannerAt = chatSurface.indexOf('<DependencyInstallBanner {workstreamId} />');
		expect(bannerAt).toBeGreaterThan(-1);
		expect(bannerAt).toBeLessThan(chatSurface.indexOf('data-testid="workstream-runtime-surface"'));
		expect(chatSurface).not.toContain('inert={dependencyInstall');
	});
});
