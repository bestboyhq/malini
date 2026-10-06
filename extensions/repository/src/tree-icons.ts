import {
	DEFAULT_FILE_ICON,
	DEFAULT_FOLDER_ICON,
	DEFAULT_FOLDER_OPEN_ICON,
	fileIconIdFor,
	fileIconUrl,
	folderIconIdFor,
} from '@malini/extension-api';

export const COMMON_TREE_ICON_IDS: readonly string[] = [
	DEFAULT_FILE_ICON,
	DEFAULT_FOLDER_ICON,
	DEFAULT_FOLDER_OPEN_ICON,
	...[
		'README.md',
		'package.json',
		'index.md',
		'config.json',
		'config.yaml',
		'index.ts',
		'index.js',
	].map((name) => fileIconIdFor(name)),
];

const decodedIcons = new Map<string, HTMLImageElement>();
const decodingIcons = new Map<string, Promise<void>>();

export function repositoryTreeIconIds(paths: readonly string[]): string[] {
	const ids = new Set<string>();
	for (const path of paths) {
		const segments = path.split('/');
		const [top, next] = segments;
		if (!top) continue;
		if (segments.length === 1) {
			ids.add(fileIconIdFor(top));
			continue;
		}
		ids.add(folderIconIdFor(top, { expanded: false }));
		ids.add(folderIconIdFor(top, { expanded: true }));
		if (!next) continue;
		ids.add(
			segments.length === 2
				? fileIconIdFor(path)
				: folderIconIdFor(`${top}/${next}`, { expanded: false }),
		);
	}
	return [...ids];
}

export function treeIconsDecoded(iconIds: readonly string[]): boolean {
	if (typeof Image !== 'function') return true;
	return iconIds.every((iconId) => decodedIcons.has(fileIconUrl(iconId)));
}

export async function decodeTreeIcons(iconIds: readonly string[]): Promise<void> {
	if (typeof Image !== 'function') return;
	await Promise.all([...new Set(iconIds)].map((iconId) => decodeIcon(fileIconUrl(iconId))));
}

function decodeIcon(url: string): Promise<void> {
	const pending = decodingIcons.get(url);
	if (pending) return pending;
	const image = new Image();
	image.src = url;
	const decoding = (async (): Promise<void> => {
		try {
			await image.decode();
			decodedIcons.set(url, image);
		} catch {
			decodingIcons.delete(url);
		}
	})();
	decodingIcons.set(url, decoding);
	return decoding;
}
