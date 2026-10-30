import { BROWSER_WORKTREE_SCHEME, worktreePageUrl } from '$contract/browser';

export type OfferedVariant = Readonly<{ id: string; name: string; src: string }>;

export type OfferedVariants = Readonly<{
	data: (workstreamId: string) => readonly (readonly OfferedVariant[])[];
}>;

export type VariantPage = Readonly<{ id: string; name: string; url: string }>;

export type VariantSwitcher = Readonly<{ pages: readonly VariantPage[]; current: number }>;

export function isWorktreePage(url: string): boolean {
	return url.startsWith(`${BROWSER_WORKTREE_SCHEME}:`);
}

export function variantSwitcher(
	url: string,
	workstreamId: string,
	offered: readonly (readonly OfferedVariant[])[],
): VariantSwitcher | null {
	if (!isWorktreePage(url)) return null;
	for (let index = offered.length - 1; index >= 0; index -= 1) {
		const pages = (offered[index] ?? []).map(({ id, name, src }) => ({
			id,
			name,
			url: worktreePageUrl(workstreamId, src),
		}));
		const current = pages.findIndex((page) => showsPage(url, page.url));
		if (current !== -1) return { pages, current };
	}
	return null;
}

export function steppedVariant(switcher: VariantSwitcher, step: number): VariantPage | null {
	const count = switcher.pages.length;
	return switcher.pages[(((switcher.current + step) % count) + count) % count] ?? null;
}

function showsPage(shown: string, page: string): boolean {
	const shownUrl = new URL(shown);
	const pageUrl = new URL(page);
	return (
		shownUrl.host === pageUrl.host &&
		shownUrl.pathname === pageUrl.pathname &&
		(pageUrl.hash === '' || shownUrl.hash === pageUrl.hash)
	);
}
