import assert from 'node:assert/strict';
import test from 'node:test';
import {
	EXTENSION_ARCHIVE_MAX_FILE_COUNT,
	EXTENSION_ARCHIVE_MAX_UNCOMPRESSED_BYTES,
	assertExtensionArchiveFileCount,
	assertExtensionArchiveUncompressedBytes,
} from '../src/archive.js';

test('accepts archive file-count and decompressed-byte limits exactly at their boundaries', () => {
	assert.doesNotThrow(() => assertExtensionArchiveFileCount(EXTENSION_ARCHIVE_MAX_FILE_COUNT));
	assert.doesNotThrow(() =>
		assertExtensionArchiveUncompressedBytes(EXTENSION_ARCHIVE_MAX_UNCOMPRESSED_BYTES),
	);
});

test('rejects archive file-count and decompressed-byte limits one unit over their boundaries', () => {
	assert.throws(
		() => assertExtensionArchiveFileCount(EXTENSION_ARCHIVE_MAX_FILE_COUNT + 1),
		/Extension archive has too many files/u,
	);
	assert.throws(
		() => assertExtensionArchiveUncompressedBytes(EXTENSION_ARCHIVE_MAX_UNCOMPRESSED_BYTES + 1),
		/Extension archive is too large/u,
	);
});
