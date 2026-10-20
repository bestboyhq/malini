export const EXTENSION_ARCHIVE_MAX_FILE_COUNT = 10_000;
export const EXTENSION_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

export function assertExtensionArchiveFileCount(fileCount: number): void {
	if (!Number.isSafeInteger(fileCount) || fileCount < 0) {
		throw new Error('Extension archive file count is invalid');
	}
	if (fileCount > EXTENSION_ARCHIVE_MAX_FILE_COUNT) {
		throw new Error('Extension archive has too many files');
	}
}

export function assertExtensionArchiveUncompressedBytes(uncompressedBytes: number): void {
	if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes < 0) {
		throw new Error('Extension archive uncompressed size is invalid');
	}
	if (uncompressedBytes > EXTENSION_ARCHIVE_MAX_UNCOMPRESSED_BYTES) {
		throw new Error('Extension archive is too large');
	}
}
