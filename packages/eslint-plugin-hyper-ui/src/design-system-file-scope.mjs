/** @param {string} filename */
const normalizeFilename = (filename = '') => filename.replace(/\\/g, '/');

/** @param {string} text */
const maskComments = (text) =>
	text.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(?<!:)\/\/[^\r\n]*/g, (comment) =>
		comment.replace(/[^\r\n]/g, ' '),
	);

/** @param {string} filename */
const isSharedUiImplementation = (filename) =>
	normalizeFilename(filename).includes('/packages/hyper-ui/src/');

/** @param {string} filename */
const isNonProductFile = (filename) => {
	const normalized = normalizeFilename(filename);
	return (
		/(?:^|\/)__(?:tests|fixtures)__(?:\/|$)/.test(normalized) ||
		/(?:^|\/)(?:tests?|fixtures|vendor|generated)(?:\/|$)/.test(normalized) ||
		/\.(?:test|spec|generated|testkit|harness)\.[^/]+$/.test(normalized)
	);
};

export { isNonProductFile, isSharedUiImplementation, maskComments, normalizeFilename };
