import { describe, expect, it } from 'vitest';
import { holdsSecretName, secretsIn, withSecretNames, withSecretValues } from './pasted-secrets';

const GITHUB = `ghp_${'R8vX2mQ7tLk4Nw9Yc3Hj6Pz1Ab5Ds0EfGu2K'}`;
const OTHER_GITHUB = `ghp_${'a'.repeat(36)}`;

describe('pasted secrets', () => {
	it('finds a token by its shape in prose and names it for its service', () => {
		expect(secretsIn(`Here is the deploy token: ${GITHUB}. Commit and deploy.`)).toEqual([
			{ value: GITHUB, label: 'GitHub token', name: 'PASTED_GITHUB_TOKEN' },
		]);
	});

	it('names a pasted env line after its own name, once per value', () => {
		expect(
			secretsIn(
				`export GITHUB_DISPATCH_TOKEN="${GITHUB}"\nlogdash_api_key: ld_8f3a91c2e7\nTOKEN_AGAIN=${GITHUB}`,
			),
		).toEqual([
			{ value: GITHUB, label: 'secret', name: 'PASTED_GITHUB_DISPATCH_TOKEN' },
			{ value: 'ld_8f3a91c2e7', label: 'secret', name: 'PASTED_LOGDASH_API_KEY' },
		]);
	});

	it('never names a paste after a variable a tool reads', () => {
		expect(
			secretsIn(`GITHUB_TOKEN=${OTHER_GITHUB}\nCLAUDE_API_KEY=abcdefgh123`).map(({ name }) => name),
		).toEqual(['PASTED_GITHUB_TOKEN', 'PASTED_CLAUDE_API_KEY']);
	});

	it('leaves placeholders, public keys, short values, prose and longer look-alikes alone', () => {
		expect(
			secretsIn(
				[
					'API_KEY=<your key here>',
					'STRIPE_PUBLISHABLE_KEY=pk_live_abcdefghijklmnop',
					'PASSWORD=short',
					'Key: use the left one',
					'MONKEY_BUSINESS_TOKEN=$GITHUB_TOKEN',
					`${GITHUB}xyz and x${OTHER_GITHUB}`,
					'PORT=8080808080',
				].join('\n'),
			),
		).toEqual([]);
	});

	it('swaps every value for its name and puts each back, without touching a longer name', () => {
		const named = [
			{ value: GITHUB, name: 'GITHUB_TOKEN' },
			{ value: OTHER_GITHUB, name: 'GITHUB_TOKEN_2' },
		];
		const text = `use ${GITHUB}, then ${OTHER_GITHUB}, and ${GITHUB} again`;
		const swapped = withSecretNames(text, named);

		expect(swapped).toBe('use $GITHUB_TOKEN, then $GITHUB_TOKEN_2, and $GITHUB_TOKEN again');
		expect(withSecretValues(swapped, named.slice(0, 1))).toBe(
			`use ${GITHUB}, then $GITHUB_TOKEN_2, and ${GITHUB} again`,
		);
		expect(withSecretValues(swapped, named)).toBe(text);
		expect(holdsSecretName('only $GITHUB_TOKEN_2 here', 'GITHUB_TOKEN')).toBe(false);
		expect(holdsSecretName('only $GITHUB_TOKEN_2 here', 'GITHUB_TOKEN_2')).toBe(true);
	});
});
