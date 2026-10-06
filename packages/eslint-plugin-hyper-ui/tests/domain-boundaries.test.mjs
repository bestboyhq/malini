import assert from 'node:assert/strict';
import test from 'node:test';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { domainBoundaries, textParser } from '../src/index.mjs';

test('an application layer reaches another domain through its api file', () => {
	assert.deepEqual(
		runCase(
			'src/lib/chat/application/x.ts',
			"import { openPullRequest } from '$lib/pull-requests/pull-requests.api.ts';",
		),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/application/x.ts',
			"import { store } from '$lib/pull-requests/infrastructure/y';",
		),
		['crossDomainDeepImport'],
	);
});

test('a platform layer reaches another domain through its platform api file', () => {
	assert.deepEqual(
		runCase(
			'src/lib/chat/platform/register.ts',
			"import { repositories } from '$shared/repositories/repositories.platform.ts';",
		),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/platform/register.ts',
			"import { watcher } from '$shared/repositories/platform/watcher';",
		),
		['crossDomainDeepImport'],
	);
});

test('the domain layer stays pure', () => {
	assert.deepEqual(
		runCase(
			'src/lib/chat/domain/a.ts',
			"import type { Workstream } from '$shared/repositories/domain/workstream';",
		),
		[],
	);
	assert.deepEqual(runCase('src/lib/chat/domain/a.ts', "import { match } from 'ts-pattern';"), []);
	assert.deepEqual(
		runCase('src/lib/chat/domain/a.ts', "import type { ContractEvents } from '$contract/events';"),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/domain/a.ts',
			"import { runRoutine } from '$lib/routines/routines.api.ts';",
		),
		['domainImportsOutward'],
	);
	assert.deepEqual(runCase('src/lib/chat/domain/a.ts', "import { readFile } from 'node:fs';"), [
		'domainImportsOutward',
	]);
	assert.deepEqual(
		runCase('src/lib/chat/domain/a.ts', "import { goto } from '$shared/router/navigation';"),
		['domainImportsOutward'],
	);
});

test('presentation never touches infrastructure', () => {
	assert.deepEqual(
		runCase(
			'src/lib/chat/presentation/X.svelte',
			"<script lang='ts'>\n\timport { sessions } from '../infrastructure/s.store.svelte';\n</script>",
		),
		['presentationImportsInfrastructure'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/presentation/X.svelte',
			"<script lang='ts'>\n\timport { query } from '../application/queries/q.query.svelte';\n</script>",
		),
		[],
	);
});

test('a renderer layer never imports main process code', () => {
	assert.deepEqual(
		runCase('src/lib/chat/application/x.ts', "import { register } from '../platform/register';"),
		['rendererImportsPlatform'],
	);
	assert.deepEqual(
		runCase('src/lib/chat/application/x.ts', "import type { Row } from '$main/db/rows';"),
		['rendererImportsPlatform'],
	);
});

test('a platform layer never imports renderer code', () => {
	assert.deepEqual(
		runCase('src/lib/chat/platform/agent/runtime.ts', "import type { Row } from '$main/db/rows';"),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/platform/agent/runtime.ts',
			"import { transition } from '../../domain/agent-state-machine';",
		),
		[],
	);
	assert.deepEqual(
		runCase('src/lib/chat/platform/agent/runtime.ts', "import { app } from 'electron';"),
		[],
	);
	assert.deepEqual(
		runCase('src/lib/chat/platform/agent/runtime.ts', "import { x } from '../../application/x';"),
		['platformImportsRenderer'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/platform/agent/runtime.ts',
			"import { invoke } from '$shared/port/invoke';",
		),
		['platformImportsRenderer'],
	);
	assert.deepEqual(
		runCase('src/lib/chat/platform/agent/runtime.ts', "import { Icon } from '$hyper-ui/icons';"),
		['platformImportsRenderer'],
	);
});

test('a composition root wires every platform register', () => {
	assert.deepEqual(
		runCase('src/main/modules.ts', "import { registerChat } from '$lib/chat/platform/register';"),
		[],
	);
});

test('the consumer domain reads every application layer', () => {
	assert.deepEqual(
		runCase(
			'src/lib/app/presentation/Sidebar.svelte',
			"<script lang='ts'>\n\timport { Q } from '$lib/chat/application/queries/x.query.svelte';\n</script>",
		),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/app/presentation/Sidebar.svelte',
			"<script lang='ts'>\n\timport { store } from '$lib/chat/infrastructure/stores/x';\n</script>",
		),
		['crossDomainDeepImport'],
	);
});

test('a relative specifier never leaves the domain folder', () => {
	assert.deepEqual(
		runCase('src/lib/chat/application/x.ts', "import type { B } from '../../routines/domain/b';"),
		['crossDomainDeepImport', 'escapesDomain'],
	);
	assert.deepEqual(
		runCase('src/lib/chat/application/x.ts', "import type { B } from '../domain/b';"),
		[],
	);
});

test('barrels and star exports are banned', () => {
	assert.deepEqual(runCase('src/lib/chat/index.ts', "export { a } from './domain/a';"), [
		'barrelFile',
	]);
	assert.deepEqual(
		runCase('src/lib/chat/chat.api.ts', "export * from './presentation/X.svelte';"),
		['starExport'],
	);
	assert.deepEqual(
		runCase('src/lib/chat/chat.api.ts', "export { X } from './presentation/X.svelte';"),
		[],
	);
});

test('a test file is exempt', () => {
	assert.deepEqual(
		runCase(
			'src/lib/chat/presentation/X.test.ts',
			"import { sessions } from '../infrastructure/s.store.svelte';",
		),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/application/chat-route.testkit.svelte.ts',
			"import { createFakePlatform } from '$shared/port/fake/create-fake-platform';",
		),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/application/hooks/follow-chat-route.harness.svelte.ts',
			"import { setPlatformForTest } from '$shared/port/platform';",
		),
		[],
	);
});

test('a dynamic import counts, the same text in a comment does not', () => {
	assert.deepEqual(
		runCase(
			'src/lib/chat/application/x.ts',
			"const load = async () => await import('$lib/chat/platform/x');",
		),
		['rendererImportsPlatform'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/application/x.ts',
			"// const load = async () => await import('$lib/chat/platform/x');",
		),
		[],
	);
});

test('a string literal ending in the word from is not an import', () => {
	assert.deepEqual(
		runCase(
			'src/lib/shared/repositories/domain/x.ts',
			"throw new Error('give the repository a url to clone from');",
		),
		[],
	);
	assert.deepEqual(
		runCase('src/lib/chat/domain/a.ts', "const help = 'pick the branch to fork from';"),
		[],
	);
	assert.deepEqual(
		runCase('src/lib/chat/domain/a.ts', "import { goto } from '$shared/router/navigation';"),
		['domainImportsOutward'],
	);
});

test('the checks option turns an individual check off', () => {
	assert.deepEqual(
		runCase(
			'src/lib/chat/application/x.ts',
			"import { store } from '$lib/pull-requests/infrastructure/y';",
			{ checks: { crossDomain: false } },
		),
		[],
	);
});

test('an unknown option is rejected by the schema', () => {
	assert.throws(() =>
		runCase('src/lib/chat/application/x.ts', "import { a } from './a';", {
			unknownOption: true,
		}),
	);
});

const linter = new Linter();

/**
 * @param {string} filename
 * @returns {import('eslint').Linter.Parser}
 */
function parserFor(filename) {
	return filename.endsWith('.svelte') ? textParser : tseslint.parser;
}

/**
 * @param {string} filename
 * @param {string} source
 * @param {Record<string, unknown>} [options]
 * @returns {string[]}
 */
function runCase(filename, source, options) {
	return runRule(domainBoundaries, source, filename, options);
}

/**
 * @param {import('eslint').Rule.RuleModule} rule
 * @param {string} source
 * @param {string} filename
 * @param {Record<string, unknown>} [options]
 * @returns {string[]}
 */
function runRule(rule, source, filename, options) {
	const messages = linter.verify(
		source,
		{
			files: ['**/*.ts', '**/*.svelte'],
			languageOptions: { parser: parserFor(filename) },
			plugins: { local: { rules: { rule } } },
			rules: { 'local/rule': options === undefined ? 'error' : ['error', options] },
		},
		filename,
	);
	return messages
		.filter((message) => message.ruleId !== null)
		.map((message) => message.messageId ?? '');
}

test('imports point inward through the layers', () => {
	assert.deepEqual(
		runCase(
			'src/lib/chat/application/commands/c.command.ts',
			"import { store } from '$lib/chat/presentation/list/pending.svelte';",
		),
		['layerImportsOutward'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/infrastructure/services/s.service.ts',
			"import { command } from '../../application/commands/c.command';",
		),
		['layerImportsOutward'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/infrastructure/stores/s.store.svelte.ts',
			"import { View } from '$lib/chat/presentation/View.svelte';",
		),
		['layerImportsOutward'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/application/commands/c.command.ts',
			"import { store } from '$lib/chat/infrastructure/stores/s.store.svelte';",
		),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/app/application/hooks/h.hook.ts',
			"import { command } from '$lib/chat/application/commands/c.command';",
		),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/application/commands/c.command.ts',
			"import { store } from '$lib/chat/presentation/list/pending.svelte';",
			{ checks: { layering: false } },
		),
		[],
	);
});

test('only infrastructure reaches the platform port', () => {
	assert.deepEqual(
		runCase(
			'src/lib/chat/infrastructure/services/s.service.ts',
			"import { invoke } from '$shared/port/invoke';",
		),
		[],
	);
	assert.deepEqual(
		runCase('src/lib/shared/errors/sink.ts', "import { invoke } from '$shared/port/invoke';"),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/presentation/X.svelte',
			"<script lang='ts'>\n\timport { invoke } from '$shared/port/invoke';\n</script>",
		),
		['platformAccessOutsideInfrastructure'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/application/commands/c.command.ts',
			"import { onPlatformEvent } from '$shared/port/events';",
		),
		['platformAccessOutsideInfrastructure'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/domain/a.ts',
			"import type { PlatformBridge } from '$shared/port/bridge';",
		),
		['domainImportsOutward', 'platformAccessOutsideInfrastructure'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/presentation/X.svelte',
			"<script lang='ts'>\n\timport { invoke } from '$shared/port/invoke';\n</script>",
			{ checks: { platformAccess: false } },
		),
		[],
	);
});

test('the port imports the contract and its own folder only', () => {
	assert.deepEqual(
		runCase(
			'src/lib/shared/port/fake/chat.fake.ts',
			"import type { StagedAgentAttachment } from '$contract/agent';\nimport { FakeBridge } from './fake-bridge';\nimport type { PlatformBridge } from '../bridge';",
		),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/shared/port/fake/chat.fake.ts',
			"import { branchDisplayName } from '$lib/chat/domain/branch-name';",
		),
		['crossDomainDeepImport', 'portImportsOutward'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/shared/port/platform.ts',
			"import { optionalPublicEnv } from '$shared/env/public-env';",
		),
		['portImportsOutward'],
	);
	assert.deepEqual(
		runCase('src/lib/shared/env/public-env.ts', "import { x } from '$shared/storage/keys';"),
		[],
	);
});

test('an api file exports only its public layers', () => {
	assert.deepEqual(
		runCase(
			'src/lib/chat/chat.api.ts',
			"export { default as ChatSurface } from './presentation/ChatSurface.svelte';",
		),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/chat.api.ts',
			"export { submitPromptCommand } from './application/commands/submit-prompt.command';",
		),
		['apiExportsInternals'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/chat.api.ts',
			"export { sessions } from './infrastructure/aggregates/sessions.aggregate.svelte';",
		),
		['apiExportsInternals'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/shared/repositories/repositories.api.ts',
			"export { workstreamByIdQuery } from './application/queries/workstream-by-id.query.svelte';\nexport { type Workstream } from './domain/workstream';\nexport { default as RepositoryAvatar } from './presentation/RepositoryAvatar.svelte';",
		),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/shared/repositories/repositories.api.ts',
			"export { repositoryAvatars } from './infrastructure/services/repository-avatars.service.svelte';",
		),
		['apiExportsInternals'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/shared/repositories/repositories.api.ts',
			"export { registerRepositories } from './platform/register';",
		),
		['rendererImportsPlatform', 'apiExportsInternals'],
	);
});

test('an infrastructure file never exports a type', () => {
	assert.deepEqual(
		runCase(
			'src/lib/chat/infrastructure/services/s.service.ts',
			'type Raw = { id: string };\nexport class S {}\nexport const s = new S();',
		),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/infrastructure/services/s.service.ts',
			'export type Raw = { id: string };',
		),
		['infrastructureExportsType'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/infrastructure/services/s.service.ts',
			'export interface Raw { id: string }',
		),
		['infrastructureExportsType'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/chat/infrastructure/services/s.service.ts',
			'type Raw = { id: string };\nconst s = 1;\nexport { s, type Raw };',
		),
		['infrastructureExportsType'],
	);
	assert.deepEqual(runCase('src/lib/chat/domain/raw.ts', 'export type Raw = { id: string };'), []);
});

test('only an infrastructure service calls a mapper', () => {
	const mapper =
		"import { TopBarMapper } from '$lib/pull-requests/infrastructure/mappers/top-bar.mapper';";
	assert.deepEqual(
		runCase('src/lib/pull-requests/infrastructure/services/repository.service.ts', mapper),
		[],
	);
	assert.deepEqual(
		runCase(
			'src/lib/pull-requests/infrastructure/services/repository.service.ts',
			"import { TopBarMapper } from '../mappers/top-bar.mapper';",
		),
		[],
	);
	assert.deepEqual(
		runCase('src/lib/pull-requests/infrastructure/mappers/outcome.mapper.ts', mapper),
		[],
	);
	assert.deepEqual(
		runCase('src/lib/pull-requests/application/commands/run-action.command.ts', mapper),
		['mapperOutsideService'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/pull-requests/application/queries/top-bar.query.svelte.ts',
			"import { TopBarMapper } from '../../infrastructure/mappers/top-bar.mapper';",
		),
		['mapperOutsideService'],
	);
	assert.deepEqual(runCase('src/lib/pull-requests/application/hooks/watch.hook.ts', mapper), [
		'mapperOutsideService',
	]);
	assert.deepEqual(
		runCase('src/lib/pull-requests/infrastructure/aggregates/surface.aggregate.svelte.ts', mapper),
		['mapperOutsideService'],
	);
	assert.deepEqual(
		runCase(
			'src/lib/pull-requests/application/commands/run-action.command.ts',
			"import { store } from '$lib/pull-requests/infrastructure/stores/action.store.svelte';",
		),
		[],
	);
	assert.deepEqual(
		runCase('src/lib/pull-requests/application/commands/run-action.command.test.ts', mapper),
		[],
	);
	assert.deepEqual(
		runCase('src/lib/pull-requests/application/commands/run-action.command.ts', mapper, {
			checks: { mappers: false },
		}),
		[],
	);
});
