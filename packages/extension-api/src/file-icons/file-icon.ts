import {
	DEFAULT_FILE_ICON,
	DEFAULT_FOLDER_ICON,
	DEFAULT_FOLDER_OPEN_ICON,
	DEFAULT_ROOT_FOLDER_ICON,
	DEFAULT_ROOT_FOLDER_OPEN_ICON,
	FILE_ICON_BY_EXTENSION,
	FILE_ICON_BY_NAME,
	FOLDER_ICON_BY_NAME,
	FOLDER_OPEN_ICON_BY_NAME,
} from './material-icon-map.generated.js';

export type FileIconId = string;

export function fileIconUrl(icon: FileIconId): string {
	const path = `file-icons/${icon}.svg`;
	if (typeof document === 'undefined') return `/${path}`;
	try {
		return new URL(path, document.baseURI).href;
	} catch {
		return `/${path}`;
	}
}

export function basename(path: string): string {
	const trimmed = path.replace(/[\\/]+$/u, '');
	const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

export function fileIconIdFor(path: string): FileIconId {
	const name = basename(path).toLowerCase();
	if (!name) return DEFAULT_FILE_ICON;

	const byName = FILE_ICON_BY_NAME[name];
	if (byName) return byName;

	let cut = name.indexOf('.');
	while (cut !== -1) {
		const byExtension = FILE_ICON_BY_EXTENSION[name.slice(cut + 1)];
		if (byExtension) return byExtension;
		cut = name.indexOf('.', cut + 1);
	}

	return DEFAULT_FILE_ICON;
}

export function folderIconIdFor(
	path: string,
	options: { expanded?: boolean; root?: boolean } = {},
): FileIconId {
	if (options.root) return options.expanded ? DEFAULT_ROOT_FOLDER_OPEN_ICON : DEFAULT_ROOT_FOLDER_ICON;
	const name = basename(path).toLowerCase();
	const named = name
		? options.expanded
			? FOLDER_OPEN_ICON_BY_NAME[name]
			: FOLDER_ICON_BY_NAME[name]
		: undefined;
	if (named) return named;
	return options.expanded ? DEFAULT_FOLDER_OPEN_ICON : DEFAULT_FOLDER_ICON;
}

export function pathIconIdFor(
	path: string,
	kind: 'file' | 'folder',
	options: { expanded?: boolean; root?: boolean } = {},
): FileIconId {
	return kind === 'folder' ? folderIconIdFor(path, options) : fileIconIdFor(path);
}
