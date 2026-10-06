export type ExtensionDirectoryVerification =
	| { status: 'passed'; reportUrl: string; verifiedAt: string }
	| { status: 'failed'; reportUrl: string; verifiedAt: string }
	| { status: 'pending'; reportUrl?: string };

export type ExtensionDirectoryReview =
	| { status: 'approved'; reviewer: string; reviewedAt: string; url: string }
	| { status: 'changes-requested'; reviewer: string; reviewedAt: string; url: string }
	| { status: 'pending'; url?: string };

export type ExtensionDirectoryTestCoverage = {
	contract: ExtensionDirectoryVerification;
	unit: ExtensionDirectoryVerification | { status: 'not-provided' };
	scenario: ExtensionDirectoryVerification | { status: 'not-provided' };
	native: ExtensionDirectoryVerification | { status: 'not-provided' };
};

export type ExtensionDirectoryEntry = {
	id: string;
	name: string;
	summary: string;
	publisher: string;
	author: { name: string; url?: string };
	funding: readonly { label: string; url: string }[];
	source: { repositoryUrl: string; directory?: string; license?: string };
	readme: { markdown: string; sourceUrl: string };
	review: ExtensionDirectoryReview;
	tests: ExtensionDirectoryTestCoverage;
	tags: readonly string[];
	firstParty?: boolean;
};
