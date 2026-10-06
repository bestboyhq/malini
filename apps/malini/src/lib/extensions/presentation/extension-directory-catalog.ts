import repositoryManifest from '@malini-extension/repository/manifest.json';
import repositoryReadme from '@malini-extension/repository/README.md?raw';
import { assertExtensionManifest, type ExtensionManifest } from '@malini/extension-api';
import type { ExtensionDirectoryEntry } from '../domain/extension-directory-entry';

const SOURCE_ROOT = 'https://github.com/bestboyhq/malini';
const NATIVE_ACCEPTANCE_URL = `${SOURCE_ROOT}/tree/main/apps/malini/tests/e2e`;

const packages = [
	{
		manifest: repositoryManifest,
		readme: repositoryReadme,
		directory: 'repository',
		tags: ['git', 'files', 'changes'],
		evaluation: false,
	},
] as const;

export const bundledExtensionDirectoryEntries: readonly ExtensionDirectoryEntry[] = packages.map(
	({ manifest: importedManifest, readme, directory, tags, evaluation }) => {
		const manifest = assertExtensionManifest(importedManifest);
		const sourceDirectory = `extensions/${directory}`;
		const sourceUrl = `${SOURCE_ROOT}/tree/main/${sourceDirectory}`;
		return {
			id: manifest.id,
			name: manifest.name,
			summary: manifest.description,
			publisher: manifest.publisher,
			author: { name: 'malini', url: SOURCE_ROOT },
			funding: [],
			source: { repositoryUrl: SOURCE_ROOT, directory: sourceDirectory },
			readme: { markdown: readme, sourceUrl: `${sourceUrl}/README.md` },
			review: {
				status: 'approved',
				reviewer: 'malini bundled extensions',
				reviewedAt: '2026-07-12T00:00:00.000Z',
				url: sourceUrl,
			},
			tests: {
				contract: verified(`${sourceUrl}/tests`),
				unit: verified(`${sourceUrl}/tests`),
				scenario: verified(`${sourceUrl}/tests`),
				native: verified(NATIVE_ACCEPTANCE_URL),
			},
			evaluation: evaluation
				? {
						status: 'verified',
						reportUrl: `${sourceUrl}/tests/eval.test.ts`,
						cases: 3,
						trials: 30,
						verifiedAt: '2026-07-12T00:00:00.000Z',
					}
				: { status: 'not-applicable', reason: 'This extension has deterministic behavior.' },
			tags,
			firstParty: true,
		};
	},
);

export const bundledExtensionManifests = new Map<string, ExtensionManifest>(
	packages.map(({ manifest }) => {
		const typed = assertExtensionManifest(manifest);
		return [typed.id, typed];
	}),
);

function verified(reportUrl: string) {
	return {
		status: 'passed' as const,
		reportUrl,
		verifiedAt: '2026-07-12T00:00:00.000Z',
	};
}
