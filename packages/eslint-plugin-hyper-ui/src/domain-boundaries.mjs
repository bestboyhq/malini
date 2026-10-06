export { domainBoundaries };

import { isNonProductFile, maskComments, normalizeFilename } from './design-system-file-scope.mjs';

/** @typedef {'domain' | 'application' | 'infrastructure' | 'presentation' | 'platform' | 'api' | 'platform-api' | 'shared' | 'main' | 'contract' | 'renderer-shell' | 'package'} Placement */

/**
 * @typedef {object} Location
 * @property {Placement} kind
 * @property {string | null} domain
 * @property {string | null} [folder]
 */

/**
 * @typedef {object} Target
 * @property {Placement} kind
 * @property {string | null} domain
 * @property {string | null} folder
 * @property {string} source
 * @property {boolean} relative
 * @property {boolean} rendererPackage
 * @property {boolean} barrel
 * @property {boolean} port
 */

/**
 * @typedef {object} Options
 * @property {string} [libRoot]
 * @property {string} [mainRoot]
 * @property {string} [contractRoot]
 * @property {string} [portRoot]
 * @property {Record<string, string>} [aliases]
 * @property {string[]} [domainPackages]
 * @property {string[]} [compositionRoots]
 * @property {string[]} [consumerDomains]
 * @property {string[]} [sharedDomains]
 * @property {Record<string, boolean>} [checks]
 */

/**
 * @typedef {object} Settings
 * @property {string} libRoot
 * @property {string} mainRoot
 * @property {string} contractRoot
 * @property {string} portRoot
 * @property {string} rendererRoot
 * @property {string} preloadRoot
 * @property {string} sharedSegment
 * @property {Record<string, string>} aliases
 * @property {string[]} domainPackages
 * @property {string[]} compositionRoots
 * @property {string[]} consumerDomains
 * @property {string[]} sharedDomains
 * @property {Record<string, boolean>} checks
 */

const DEFAULT_ALIASES = {
	$lib: 'src/lib',
	$shared: 'src/lib/shared',
	$contract: 'src/contract',
	$main: 'src/main',
	'$hyper-ui': 'packages/hyper-ui/src',
};

const DEFAULT_PORT_ROOT = 'src/lib/shared/port';
const DEFAULT_COMPOSITION_ROOTS = ['src/main/modules.ts', 'src/main/index.ts'];
const DEFAULT_DOMAIN_PACKAGES = ['ts-pattern'];
const DEFAULT_CONSUMER_DOMAINS = ['app'];
const DEFAULT_SHARED_DOMAINS = ['repositories', 'providers'];

const LAYERS = new Set(['domain', 'application', 'infrastructure', 'presentation', 'platform']);
const RENDERER_SOURCES = new Set([
	'domain',
	'application',
	'infrastructure',
	'presentation',
	'api',
	'shared',
	'renderer-shell',
]);
const PLATFORM_SOURCES = new Set(['platform', 'platform-api', 'main']);
const PLATFORM_ACCESS_FORBIDDEN = new Set(['domain', 'application', 'presentation', 'api']);
const RENDERER_TARGETS = new Set([
	'application',
	'infrastructure',
	'presentation',
	'api',
	'renderer-shell',
]);

/** @type {Record<string, string>} */
const CHECK_OF = {
	crossDomainDeepImport: 'crossDomain',
	rendererImportsPlatform: 'platform',
	platformImportsRenderer: 'platform',
	presentationImportsInfrastructure: 'presentation',
	layerImportsOutward: 'layering',
	domainImportsOutward: 'domainPurity',
	barrelFile: 'barrels',
	starExport: 'barrels',
	escapesDomain: 'relativeEscape',
	platformAccessOutsideInfrastructure: 'platformAccess',
	portImportsOutward: 'portPurity',
	apiExportsInternals: 'apiSurface',
	infrastructureExportsType: 'infrastructureTypes',
	mapperOutsideService: 'mappers',
};

const IMPORT_SOURCES = [
	/(?:^|[\s;}()])(?:import|export)\s[\s\S]{0,400}?\bfrom\s*['"](?<source>[^'"\n]+)['"]/g,
	/(?:^|[\s;}()])import\s*['"](?<source>[^'"\n]+)['"]/g,
	/\b(?:import|require)\s*\(\s*['"](?<source>[^'"\n]+)['"]/g,
];
const STAR_EXPORT = /\bexport\s+\*/g;
const TYPE_EXPORTS = [
	/\bexport\s+(?:declare\s+)?(?:type|interface)\s+[\w$]/g,
	/\bexport\s+type\s*\{/g,
	/\bexport\s*\{[^}]*\btype\s+[\w$]/g,
];
const SOURCE_EXTENSION = /\.(?:ts|mts|cts|js|mjs|cjs|svelte|svelte\.ts)$/;
const BARREL_FILE = /(?:^|\/)index(?:\.(?:ts|mts|cts|js|mjs|cjs|svelte\.ts))?$/;

/** @type {import('eslint').Rule.RuleMetaData} */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Enforce the domain, layer, and process boundaries of the desktop source tree: api files across domains, no renderer and main process mixing, and no barrels.',
		recommended: false,
	},
	schema: [
		{
			type: 'object',
			properties: {
				libRoot: { type: 'string' },
				mainRoot: { type: 'string' },
				contractRoot: { type: 'string' },
				portRoot: { type: 'string' },
				aliases: {
					type: 'object',
					additionalProperties: { type: 'string' },
				},
				domainPackages: { type: 'array', items: { type: 'string' }, uniqueItems: true },
				compositionRoots: { type: 'array', items: { type: 'string' }, uniqueItems: true },
				consumerDomains: { type: 'array', items: { type: 'string' }, uniqueItems: true },
				sharedDomains: { type: 'array', items: { type: 'string' }, uniqueItems: true },
				checks: {
					type: 'object',
					properties: {
						crossDomain: { type: 'boolean' },
						platform: { type: 'boolean' },
						presentation: { type: 'boolean' },
						layering: { type: 'boolean' },
						domainPurity: { type: 'boolean' },
						barrels: { type: 'boolean' },
						relativeEscape: { type: 'boolean' },
						platformAccess: { type: 'boolean' },
						portPurity: { type: 'boolean' },
						apiSurface: { type: 'boolean' },
						infrastructureTypes: { type: 'boolean' },
						mappers: { type: 'boolean' },
					},
					additionalProperties: false,
				},
			},
			additionalProperties: false,
		},
	],
	messages: {
		crossDomainDeepImport:
			'`{{source}}` reaches inside the `{{domain}}` domain. Other domains see `{{domain}}.api.ts` from the renderer and `{{domain}}.platform.ts` from the main process, nothing else.',
		rendererImportsPlatform:
			'`{{source}}` is main process code. A renderer layer reaches the main process through a command, never through an import.',
		platformImportsRenderer:
			'`{{source}}` is renderer code. A `platform/` file may import its own domain, another domain `*.platform.ts`, `$main`, `$contract`, node, and electron.',
		presentationImportsInfrastructure:
			'`{{source}}` is infrastructure. Presentation reads state through `application/queries` and acts through `application/commands`.',
		layerImportsOutward:
			'`{{source}}` is an outer layer. Imports point inward: presentation may import application, application may import infrastructure, and nothing imports presentation back.',
		domainImportsOutward:
			'`{{source}}` is outside the domain layer. `domain/` may import other `domain/` folders, `$contract`, and these packages: {{packages}}.',
		barrelFile:
			'Barrel files are banned. Import the file that owns the symbol, or the domain api file across domains.',
		starExport: 'A star export is banned. Name every re-exported symbol.',
		escapesDomain:
			'`{{source}}` leaves the domain folder. Reach another domain through the `$lib` or `$shared` alias and its api file.',
		platformAccessOutsideInfrastructure:
			'`{{source}}` is the platform port. Only an infrastructure service calls the platform; presentation, application, and domain go through a service, a command, or a query.',
		portImportsOutward:
			'`{{source}}` is outside the port. The port and its fakes import `$contract`, their own folder, and packages, never a domain.',
		infrastructureExportsType:
			'An infrastructure file never exports a type. A type that crosses outward lives in `domain/`; an internal one stays unexported.',
		mapperOutsideService:
			'`{{source}}` is a mapper. Only an infrastructure service calls a mapper; commands, queries, hooks, and aggregates receive the domain types the service returns.',
		apiExportsInternals:
			'`{{source}}` is not part of this api surface. A domain api exports presentation; a shared domain api may add domain, application, and presentation. Infrastructure and platform never cross an api.',
	},
};

/** @param {string} value */
const trimSlashes = (value) => value.replace(/^\/+|\/+$/g, '');

/** @param {string} path */
const parentOf = (path) => {
	const cut = path.lastIndexOf('/');
	return cut === -1 ? '' : path.slice(0, cut);
};

/**
 * @param {string} path
 * @param {string} root
 * @returns {string | null}
 */
const relativeTo = (path, root) => {
	if (root === '') return null;
	if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
	const marker = `/${root}/`;
	const at = path.indexOf(marker);
	return at === -1 ? null : path.slice(at + marker.length);
};

/**
 * @param {string} directory
 * @param {string} specifier
 * @returns {string}
 */
const resolveRelative = (directory, specifier) => {
	const segments = directory === '' ? [] : directory.split('/');
	for (const part of specifier.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') segments.pop();
		else segments.push(part);
	}
	return segments.join('/');
};

/** @param {string} specifier */
const packageRootOf = (specifier) => {
	if (specifier.startsWith('node:')) return specifier;
	const segments = specifier.split('/');
	if (specifier.startsWith('@')) return segments.slice(0, 2).join('/');
	return segments[0] ?? specifier;
};

/**
 * @param {Options | undefined} options
 * @returns {Settings}
 */
const settingsFrom = (options) => {
	const libRoot = trimSlashes(options?.libRoot ?? DEFAULT_ALIASES.$lib);
	const aliases = { ...DEFAULT_ALIASES, ...(options?.aliases ?? {}) };
	const sourceRoot = parentOf(libRoot);
	return {
		libRoot,
		mainRoot: trimSlashes(options?.mainRoot ?? DEFAULT_ALIASES.$main),
		contractRoot: trimSlashes(options?.contractRoot ?? DEFAULT_ALIASES.$contract),
		portRoot: trimSlashes(options?.portRoot ?? DEFAULT_PORT_ROOT),
		rendererRoot: sourceRoot === '' ? 'renderer' : `${sourceRoot}/renderer`,
		preloadRoot: sourceRoot === '' ? 'preload' : `${sourceRoot}/preload`,
		sharedSegment: relativeTo(trimSlashes(aliases.$shared ?? ''), libRoot) ?? 'shared',
		aliases,
		domainPackages: options?.domainPackages ?? DEFAULT_DOMAIN_PACKAGES,
		compositionRoots: options?.compositionRoots ?? DEFAULT_COMPOSITION_ROOTS,
		consumerDomains: options?.consumerDomains ?? DEFAULT_CONSUMER_DOMAINS,
		sharedDomains: options?.sharedDomains ?? DEFAULT_SHARED_DOMAINS,
		checks: options?.checks ?? {},
	};
};

/**
 * @param {string} rest
 * @param {Settings} settings
 * @returns {Location}
 */
const classifyLib = (rest, settings) => {
	const segments = rest.split('/');
	const first = segments[0];
	if (first === undefined || segments.length < 2) return { kind: 'shared', domain: null };

	let domain = first;
	let tail = segments.slice(1);
	if (first === settings.sharedSegment) {
		const second = tail[0];
		if (second === undefined || !settings.sharedDomains.includes(second)) {
			return { kind: 'shared', domain: null };
		}
		domain = `${first}/${second}`;
		tail = tail.slice(1);
	}

	const name = domain.split('/').pop() ?? domain;
	const head = tail[0];
	if (head === undefined) return { kind: 'shared', domain };
	if (tail.length === 1) {
		const base = head.replace(SOURCE_EXTENSION, '');
		if (base === `${name}.api`) return { kind: 'api', domain };
		if (base === `${name}.platform`) return { kind: 'platform-api', domain };
	}
	if (LAYERS.has(head)) {
		const folder = tail.length > 2 ? (tail[1] ?? null) : null;
		return { kind: /** @type {Placement} */ (head), domain, folder };
	}
	return { kind: 'shared', domain };
};

/**
 * @param {string} path
 * @param {Settings} settings
 * @returns {Location}
 */
const classify = (path, settings) => {
	const lib = relativeTo(path, settings.libRoot);
	if (lib !== null) return classifyLib(lib, settings);
	if (relativeTo(path, settings.contractRoot) !== null) return { kind: 'contract', domain: null };
	if (relativeTo(path, settings.mainRoot) !== null) return { kind: 'main', domain: null };
	if (relativeTo(path, settings.preloadRoot) !== null) return { kind: 'main', domain: null };
	if (relativeTo(path, settings.rendererRoot) !== null) {
		return { kind: 'renderer-shell', domain: null };
	}
	return { kind: 'shared', domain: null };
};

/**
 * @param {string} path
 * @param {string} root
 */
const isInside = (path, root) =>
	path === root || relativeTo(path, root) !== null || path.endsWith(`/${root}`);

/**
 * @param {string} path
 * @param {Settings} settings
 */
const inProductTree = (path, settings) =>
	relativeTo(path, settings.libRoot) !== null || relativeTo(path, settings.contractRoot) !== null;

/**
 * @param {string} specifier
 * @param {Settings} settings
 * @returns {{ path: string, alias: string } | null}
 */
const expandAlias = (specifier, settings) => {
	const aliases = Object.entries(settings.aliases).sort(([a], [b]) => b.length - a.length);
	for (const [alias, target] of aliases) {
		if (specifier === alias) return { path: trimSlashes(target), alias };
		if (specifier.startsWith(`${alias}/`)) {
			return { path: `${trimSlashes(target)}/${specifier.slice(alias.length + 1)}`, alias };
		}
	}
	return null;
};

/**
 * @param {string} specifier
 * @param {string} directory
 * @param {Settings} settings
 * @returns {Target}
 */
const resolveTarget = (specifier, directory, settings) => {
	const relative = specifier.startsWith('.');
	const alias = relative ? null : expandAlias(specifier, settings);
	if (!relative && alias === null) {
		return {
			kind: 'package',
			domain: null,
			folder: null,
			source: specifier,
			relative: false,
			rendererPackage: packageRootOf(specifier) === '@malini/hyper-ui',
			barrel: false,
			port: false,
		};
	}

	const path = relative ? resolveRelative(directory, specifier) : (alias?.path ?? specifier);
	const rendererPackage = alias?.alias === '$hyper-ui' || path.includes('packages/hyper-ui/');
	if (!inProductTree(path, settings) && relativeTo(path, settings.mainRoot) === null) {
		const outside = classify(path, settings);
		return {
			kind: outside.kind === 'shared' && outside.domain === null ? 'package' : outside.kind,
			domain: outside.domain,
			folder: outside.folder ?? null,
			source: specifier,
			relative,
			rendererPackage,
			barrel: false,
			port: false,
		};
	}

	const placement = classify(path, settings);
	return {
		kind: placement.kind,
		domain: placement.domain,
		folder: placement.folder ?? null,
		source: specifier,
		relative,
		rendererPackage,
		barrel: BARREL_FILE.test(path) && inProductTree(path, settings),
		port: isInside(path, settings.portRoot),
	};
};

/**
 * @param {Location} from
 * @param {Target} to
 * @param {Settings} settings
 * @param {boolean} compositionRoot
 */
const crossesDomain = (from, to, settings, compositionRoot) => {
	if (to.domain === null || to.domain === from.domain) return false;
	if (from.kind === 'renderer-shell') return false;
	if (to.kind === 'api' || to.kind === 'platform-api') return false;
	if (to.kind === 'domain' && (from.kind === 'domain' || from.kind === 'contract')) return false;
	if (to.kind === 'domain' && from.kind === 'main') return false;
	if (to.kind === 'application' && from.domain !== null) {
		if (settings.consumerDomains.includes(from.domain)) return false;
	}
	if (to.kind === 'platform' && from.kind === 'main' && compositionRoot) return false;
	return true;
};

const LAYER_DEPTH = new Map([
	['infrastructure', 1],
	['application', 2],
	['presentation', 3],
]);

/**
 * @param {Location} from
 * @param {Target} to
 */
const importsOutwardLayer = (from, to) => {
	if (to.domain !== from.domain) return false;
	const fromDepth = LAYER_DEPTH.get(from.kind);
	const toDepth = LAYER_DEPTH.get(to.kind);
	return fromDepth !== undefined && toDepth !== undefined && toDepth > fromDepth;
};

/** @param {Target} to */
const isRendererTarget = (to) => {
	if (RENDERER_TARGETS.has(to.kind)) return true;
	if (to.kind === 'shared' && to.domain === null) return true;
	return to.kind === 'package' && to.rendererPackage;
};

/**
 * @param {Target} to
 * @param {Settings} settings
 */
const domainMayImport = (to, settings) => {
	if (to.kind === 'domain' || to.kind === 'contract') return true;
	if (to.kind !== 'package') return false;
	return settings.domainPackages.includes(packageRootOf(to.source));
};

/**
 * @param {Target} to
 */
const portMayImport = (to) =>
	to.port || to.kind === 'contract' || (to.kind === 'package' && !to.rendererPackage);

/**
 * @param {Location} from
 * @param {Target} to
 * @param {Settings} settings
 */
const apiMayExport = (from, to, settings) => {
	if (to.domain !== from.domain) return true;
	if (to.kind === 'presentation') return true;
	const shared = settings.sharedDomains.some(
		(name) => from.domain === `${settings.sharedSegment}/${name}`,
	);
	return shared && (to.kind === 'domain' || to.kind === 'application');
};

/**
 * @param {Location} from
 * @param {Target} to
 */
const callsMapperOutsideService = (from, to) => {
	if (to.kind !== 'infrastructure' || to.folder !== 'mappers') return false;
	if (from.kind !== 'infrastructure') return true;
	return from.folder !== 'services' && from.folder !== 'mappers';
};

/**
 * @param {Location} from
 * @param {Target} to
 * @param {Settings} settings
 * @param {boolean} compositionRoot
 * @param {boolean} fromPort
 * @returns {string[]}
 */
const violationsFor = (from, to, settings, compositionRoot, fromPort) => {
	/** @type {string[]} */
	const found = [];
	if (crossesDomain(from, to, settings, compositionRoot)) found.push('crossDomainDeepImport');
	if (RENDERER_SOURCES.has(from.kind) && PLATFORM_SOURCES.has(to.kind)) {
		found.push('rendererImportsPlatform');
	}
	if (PLATFORM_SOURCES.has(from.kind) && isRendererTarget(to)) {
		found.push('platformImportsRenderer');
	}
	if (from.kind === 'presentation' && to.kind === 'infrastructure' && to.domain === from.domain) {
		found.push('presentationImportsInfrastructure');
	}
	if (importsOutwardLayer(from, to)) found.push('layerImportsOutward');
	if (from.kind === 'domain' && !domainMayImport(to, settings)) found.push('domainImportsOutward');
	if (to.relative && from.domain !== null && to.domain !== from.domain) found.push('escapesDomain');
	if (to.barrel) found.push('barrelFile');
	if (PLATFORM_ACCESS_FORBIDDEN.has(from.kind) && to.port) {
		found.push('platformAccessOutsideInfrastructure');
	}
	if (fromPort && !portMayImport(to)) found.push('portImportsOutward');
	if (from.kind === 'api' && !apiMayExport(from, to, settings)) found.push('apiExportsInternals');
	if (callsMapperOutsideService(from, to)) found.push('mapperOutsideService');
	return found;
};

/**
 * @param {string} filename
 * @param {Settings} settings
 */
const isCompositionRoot = (filename, settings) =>
	settings.compositionRoots.some(
		(root) => filename === trimSlashes(root) || filename.endsWith(`/${trimSlashes(root)}`),
	);

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	const filename = normalizeFilename(context.filename);
	if (isNonProductFile(filename)) return {};

	const settings = settingsFrom(context.options[0]);
	const from = classify(filename, settings);
	const directory = parentOf(filename);
	const compositionRoot = isCompositionRoot(filename, settings);
	const fromPort = isInside(directory, settings.portRoot);
	const packages = settings.domainPackages.join(', ');

	/** @param {string} messageId */
	const enabled = (messageId) => settings.checks[CHECK_OF[messageId] ?? ''] !== false;

	return {
		Program(node) {
			const sourceCode = context.sourceCode;
			const text = maskComments(sourceCode.getText());

			/**
			 * @param {number} index
			 * @param {string} messageId
			 * @param {Record<string, string>} data
			 */
			const report = (index, messageId, data) => {
				if (!enabled(messageId)) return;
				context.report({
					node,
					loc: sourceCode.getLocFromIndex(index),
					messageId,
					data,
				});
			};

			if (!compositionRoot && inProductTree(filename, settings) && BARREL_FILE.test(filename)) {
				report(0, 'barrelFile', { source: filename, domain: from.domain ?? '', packages });
			}

			if (from.kind === 'infrastructure') {
				const reported = new Set();
				for (const pattern of TYPE_EXPORTS) {
					for (const match of text.matchAll(pattern)) {
						const index = match.index ?? 0;
						if (reported.has(index)) continue;
						reported.add(index);
						report(index, 'infrastructureExportsType', { source: filename, domain: '', packages });
					}
				}
			}

			if (inProductTree(filename, settings)) {
				for (const match of text.matchAll(STAR_EXPORT)) {
					report(match.index ?? 0, 'starExport', { source: filename, domain: '', packages });
				}
			}

			const seen = new Set();
			for (const pattern of IMPORT_SOURCES) {
				for (const match of text.matchAll(pattern)) {
					const source = match.groups?.source ?? '';
					const index = (match.index ?? 0) + match[0].lastIndexOf(source);
					if (source === '' || seen.has(index)) continue;
					seen.add(index);
					const to = resolveTarget(source, directory, settings);
					for (const messageId of violationsFor(from, to, settings, compositionRoot, fromPort)) {
						report(index, messageId, { source, domain: to.domain ?? '', packages });
					}
				}
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const domainBoundaries = { meta, create };
