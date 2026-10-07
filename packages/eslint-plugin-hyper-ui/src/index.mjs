import { domainBoundaries } from './domain-boundaries.mjs';
import { noAsCasts } from './no-as-casts.mjs';
import { noBackgroundTransition } from './no-background-transition.mjs';
import { noBespokeOverlays } from './no-bespoke-overlays.mjs';
import { noBorderTokenBackground } from './no-border-token-background.mjs';
import { noComments } from './no-comments.mjs';
import { noDirectComponentFileImport } from './no-direct-component-file-import.mjs';
import { noExternalIconPackages } from './no-external-icon-packages.mjs';
import { noFgNonTextUsage } from './no-fg-non-text-usage.mjs';
import { noLegacyColorTokens } from './no-legacy-color-tokens.mjs';
import { noLiteralProductColors } from './no-literal-product-colors.mjs';
import { noMismatchedSurfaceBorder } from './no-mismatched-surface-border.mjs';
import { noMisusedStateFgTokens } from './no-misused-state-fg-tokens.mjs';
import { noNativeTitleAttributes } from './no-native-title-attributes.mjs';
import { noRawButton } from './no-raw-button.mjs';
import { noRawFormControl } from './no-raw-form-control.mjs';
import { noStaticHoverToken } from './no-static-hover-token.mjs';
import { noSurfaceTokenBorderUsage } from './no-surface-token-border-usage.mjs';
import { noThenChains } from './no-then-chains.mjs';
import { preferHyperUiEntrypoint } from './prefer-hyper-ui-entrypoint.mjs';
import { textParser } from './text-parser.mjs';

/** @type {Record<string, import('eslint').Linter.Config>} */
const configs = {};

/** @satisfies {import('eslint').ESLint.Plugin} */
const plugin = {
	meta: {
		name: '@malini/eslint-plugin-hyper-ui',
		version: '0.1.0',
	},
	rules: {
		'domain-boundaries': domainBoundaries,
		'no-as-casts': noAsCasts,
		'no-background-transition': noBackgroundTransition,
		'no-bespoke-overlays': noBespokeOverlays,
		'no-border-token-background': noBorderTokenBackground,
		'no-comments': noComments,
		'no-direct-component-file-import': noDirectComponentFileImport,
		'no-external-icon-packages': noExternalIconPackages,
		'no-fg-non-text-usage': noFgNonTextUsage,
		'no-legacy-color-tokens': noLegacyColorTokens,
		'no-literal-product-colors': noLiteralProductColors,
		'no-mismatched-surface-border': noMismatchedSurfaceBorder,
		'no-misused-state-fg-tokens': noMisusedStateFgTokens,
		'no-native-title-attributes': noNativeTitleAttributes,
		'no-raw-button': noRawButton,
		'no-raw-form-control': noRawFormControl,
		'no-static-hover-token': noStaticHoverToken,
		'no-surface-token-border-usage': noSurfaceTokenBorderUsage,
		'no-then-chains': noThenChains,
		'prefer-hyper-ui-entrypoint': preferHyperUiEntrypoint,
	},
	configs,
};

configs.recommended = {
	plugins: {
		'@malini/desktop': plugin,
	},
	rules: {
		'@malini/desktop/domain-boundaries': 'error',
		'@malini/desktop/no-as-casts': 'error',
		'@malini/desktop/no-background-transition': 'error',
		'@malini/desktop/no-comments': 'error',
		'@malini/desktop/no-then-chains': 'error',
	},
};

export default plugin;
export {
	domainBoundaries,
	noAsCasts,
	noBackgroundTransition,
	noBespokeOverlays,
	noBorderTokenBackground,
	noComments,
	noDirectComponentFileImport,
	noExternalIconPackages,
	noFgNonTextUsage,
	noLegacyColorTokens,
	noLiteralProductColors,
	noMismatchedSurfaceBorder,
	noMisusedStateFgTokens,
	noNativeTitleAttributes,
	noRawButton,
	noRawFormControl,
	noStaticHoverToken,
	noSurfaceTokenBorderUsage,
	noThenChains,
	preferHyperUiEntrypoint,
	textParser,
};
