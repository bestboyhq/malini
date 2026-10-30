import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventChannel } from '$contract/events';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { all } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import type { SecretSealer } from './keychain';
import { registerSecrets, type SecretsPlatform } from './register';

const SEALER: SecretSealer = {
	isEncryptionAvailable: () => true,
	encryptString: (plainText) => Buffer.from(`sealed:${[...plainText].reverse().join('')}`),
	decryptString: (encrypted) =>
		[...encrypted.toString().slice('sealed:'.length)].reverse().join(''),
};

let context: MainContext;
let secrets: SecretsPlatform;
let emitted: Array<Readonly<{ channel: EventChannel; payload: unknown }>>;

beforeEach(() => {
	context = {
		db: openMigratedDatabase(':memory:'),
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/malini',
		resourcesRoot: '/tmp/malini',
		isDev: false,
		appVersion: '0.0.0',
	};
	context.db.exec(`
		INSERT INTO projects (id, name, repo_path, default_branch, created_at) VALUES ('p', 'shop', '/tmp/p', 'main', '2026-10-30T00:00:00Z');
		INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at) VALUES ('w', 'p', 'w', '/tmp/w', 'malini/w', 'main', 'active', '2026-10-30T00:00:00Z');
		INSERT INTO agent_sessions (id, workstream_id, status, started_at) VALUES ('chat-1', 'w', 'idle', '2026-10-30T00:00:00Z');
	`);
	emitted = [];
	context.events.observe((channel, payload) => emitted.push({ channel, payload }));
	secrets = registerSecrets(context, { sealer: SEALER });
});

afterEach(() => context.db.close());

function ask(names: unknown, why = 'To deploy the shop.'): Readonly<Record<string, unknown>> {
	return secrets.request({ sessionId: 'chat-1', repository: 'acme/shop', names, why });
}

describe('secrets', () => {
	it('keeps a value sealed, gives commands every value that reaches a repository and the renderer only names', async () => {
		await context.commands.call('secrets.save', {
			values: { STRIPE_KEY: ' sk-everywhere-1 ', SENTRY_DSN: 'https://dsn.example' },
			repository: null,
		});
		await context.commands.call('secrets.save', {
			values: { STRIPE_KEY: 'sk-shop-2' },
			repository: 'Acme/Shop',
		});

		expect(secrets.valuesReaching('acme/shop')).toEqual({
			STRIPE_KEY: 'sk-shop-2',
			SENTRY_DSN: 'https://dsn.example',
		});
		expect(secrets.valuesReaching('acme/blog')).toEqual({
			STRIPE_KEY: 'sk-everywhere-1',
			SENTRY_DSN: 'https://dsn.example',
		});
		expect(secrets.valuesReaching(null)).toEqual({
			STRIPE_KEY: 'sk-everywhere-1',
			SENTRY_DSN: 'https://dsn.example',
		});
		expect(await context.commands.call('secrets.list', undefined)).toEqual([
			{ name: 'SENTRY_DSN', repository: null, savedAt: expect.any(String) },
			{ name: 'STRIPE_KEY', repository: null, savedAt: expect.any(String) },
			{ name: 'STRIPE_KEY', repository: 'Acme/Shop', savedAt: expect.any(String) },
		]);
		const stored = all<{ sealed: Uint8Array }>(context.db, 'SELECT sealed FROM secrets');
		expect(stored.map(({ sealed }) => Buffer.from(sealed).toString())).not.toContain('sk-shop-2');
		expect(JSON.stringify(emitted)).not.toContain('sk-');
	});

	it('asks on a card in the chat and answers the agent at once, taking over a request still open', async () => {
		await context.commands.call('secrets.save', {
			values: { STRIPE_KEY: 'sk-1' },
			repository: null,
		});

		expect(ask(['STRIPE_KEY'])).toEqual({
			id: expect.any(String),
			names: ['STRIPE_KEY'],
			alreadySaved: ['STRIPE_KEY'],
			status: expect.stringContaining('Malini tells you in a message once they save them'),
		});
		const second = ask(['SENDGRID_KEY', 'STRIPE_KEY'], 'To send the receipt too.');

		expect(await context.commands.call('secrets.list-requests', { sessionId: 'chat-1' })).toEqual([
			{
				id: second['id'],
				sessionId: 'chat-1',
				names: ['STRIPE_KEY', 'SENDGRID_KEY'],
				why: 'To send the receipt too.',
				repository: 'acme/shop',
				saved: ['STRIPE_KEY'],
				askedAt: expect.any(String),
			},
		]);
		expect(emitted.filter(({ channel }) => channel === 'secrets:requested')).toHaveLength(2);
	});

	it('refuses a name a command cannot read or one that steers how commands run', () => {
		expect(() => ask(['not-a-name'])).toThrow('is not a name a command reads');
		expect(() => ask(['PATH'])).toThrow('steers how commands run');
		expect(() => ask(['DYLD_INSERT_LIBRARIES'])).toThrow('steers how commands run');
		expect(() => ask(['MALINI_THEME'])).toThrow('steers how commands run');
		expect(() => ask([])).toThrow('one to 10 names');
		expect(() => ask(['A_TOKEN'], '   ')).toThrow('`why` must be one to 300 characters');
	});

	it('saves what the card filled for the chat, then tells the chat which names were left', async () => {
		const request = ask(['STRIPE_KEY', 'SENDGRID_KEY']);

		await context.commands.call('secrets.save', {
			requestId: String(request['id']),
			values: { STRIPE_KEY: 'sk-live-1' },
		});

		expect(emitted.at(-1)).toEqual({
			channel: 'secrets:saved',
			payload: {
				names: ['STRIPE_KEY'],
				unsaved: ['SENDGRID_KEY'],
				repository: 'acme/shop',
				requestId: request['id'],
				sessionId: 'chat-1',
			},
		});
		expect(await context.commands.call('secrets.list-requests', { sessionId: 'chat-1' })).toEqual(
			[],
		);
		await expect(
			context.commands.call('secrets.save', {
				requestId: String(request['id']),
				values: { SENDGRID_KEY: 'sg-1' },
			}),
		).rejects.toThrow('That request is no longer waiting');
	});

	it('keeps a card to the names it asked for', async () => {
		const requestId = String(ask(['STRIPE_KEY'])['id']);

		await expect(
			context.commands.call('secrets.save', { requestId, values: { GITHUB_TOKEN: 'ghp-1' } }),
		).rejects.toThrow('GITHUB_TOKEN is not a name this chat asked for');
		await expect(
			context.commands.call('secrets.save', { requestId, values: { STRIPE_KEY: '  ' } }),
		).rejects.toThrow('Paste a value for STRIPE_KEY');
		expect(secrets.valuesReaching('acme/shop')).toEqual({});
	});

	it("saves a card for its chat's repository, and for every repository from a chat without one", async () => {
		await context.commands.call('secrets.save', {
			requestId: String(ask(['STRIPE_KEY'])['id']),
			values: { STRIPE_KEY: 'sk-shop-1' },
		});
		const lead = secrets.request({
			sessionId: 'chat-1',
			repository: null,
			names: ['GITHUB_TOKEN'],
			why: 'To open the pull request.',
		});
		await context.commands.call('secrets.save', {
			requestId: String(lead['id']),
			values: { GITHUB_TOKEN: 'ghp-1' },
		});

		expect(secrets.valuesReaching('acme/shop')).toEqual({
			STRIPE_KEY: 'sk-shop-1',
			GITHUB_TOKEN: 'ghp-1',
		});
		expect(secrets.valuesReaching('acme/blog')).toEqual({ GITHUB_TOKEN: 'ghp-1' });
	});

	it('dismisses a card, and deletes a saved secret by name and scope', async () => {
		const request = ask(['STRIPE_KEY']);
		await context.commands.call('secrets.dismiss-request', { requestId: String(request['id']) });
		await context.commands.call('secrets.save', {
			values: { STRIPE_KEY: 'sk-1' },
			repository: null,
		});

		await context.commands.call('secrets.delete', { name: 'STRIPE_KEY', repository: null });

		expect(secrets.valuesReaching(null)).toEqual({});
		expect(emitted.map(({ channel }) => channel)).toEqual([
			'secrets:requested',
			'secrets:request-dismissed',
			'secrets:saved',
			'secrets:deleted',
		]);
		await expect(
			context.commands.call('secrets.delete', { name: 'STRIPE_KEY', repository: null }),
		).rejects.toThrow('STRIPE_KEY is not saved for everywhere');
	});

	it('refuses to save while the keychain cannot seal, and gives commands nothing it cannot open', async () => {
		const locked = registerSecrets(
			{ ...context, commands: new CommandRegistry() },
			{ sealer: { ...SEALER, isEncryptionAvailable: () => false } },
		);
		await context.commands.call('secrets.save', {
			values: { STRIPE_KEY: 'sk-1' },
			repository: null,
		});

		expect(locked.valuesReaching(null)).toEqual({});
		const broken = registerSecrets(
			{ ...context, commands: new CommandRegistry() },
			{
				sealer: {
					...SEALER,
					decryptString: () => {
						throw new Error('wrong key');
					},
				},
			},
		);
		expect(broken.valuesReaching(null)).toEqual({});
	});
});
