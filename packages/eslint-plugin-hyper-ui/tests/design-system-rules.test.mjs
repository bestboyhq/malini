import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { textParser } from '../src/text-parser.mjs';
import { preferHyperUiEntrypoint } from '../src/prefer-hyper-ui-entrypoint.mjs';
import { noNativeTitleAttributes } from '../src/no-native-title-attributes.mjs';
import { noBespokeOverlays } from '../src/no-bespoke-overlays.mjs';
import { noLiteralProductColors } from '../src/no-literal-product-colors.mjs';
import { noLegacyColorTokens } from '../src/no-legacy-color-tokens.mjs';
import { noMismatchedSurfaceBorder } from '../src/no-mismatched-surface-border.mjs';
import { noMisusedStateFgTokens } from '../src/no-misused-state-fg-tokens.mjs';
import { noRawButton } from '../src/no-raw-button.mjs';
import { noRawFormControl } from '../src/no-raw-form-control.mjs';
import { noExternalIconPackages } from '../src/no-external-icon-packages.mjs';
import { noDirectComponentFileImport } from '../src/no-direct-component-file-import.mjs';
import { noBackgroundTransition } from '../src/no-background-transition.mjs';

RuleTester.describe = (_text, fn) => fn();
RuleTester.it = (_text, fn) => fn();
RuleTester.itOnly = (_text, fn) => fn();

const agenticFilename = '/apps/malini/src/lib/agentic/presentation/Example.svelte';
const desktopFilename = '/apps/malini/src/lib/shared/shell/Example.svelte';
const hyperUiFilename = '/packages/hyper-ui/src/components/dropdown-layer/DropdownLayer.svelte';
const testFilename = '/apps/malini/src/lib/agentic/presentation/Example.test.svelte';
const generatedFilename = '/apps/malini/src/lib/agentic/application/protocol.generated.ts';

const javascriptTester = new RuleTester({
	languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

javascriptTester.run('prefer-hyper-ui-entrypoint', preferHyperUiEntrypoint, {
	valid: [
		{
			code: [
				"import { Tooltip } from '$hyper-ui/components/tooltip';",
				"import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';",
				"import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';",
			].join('\n'),
			filename: agenticFilename,
		},
		{
			code: "import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';",
			filename: agenticFilename,
		},
		{
			code: "import { Tooltip } from '@malini/hyper-ui/components/tooltip';",
			filename: agenticFilename,
		},
		{
			code: [
				"import { TextInput } from '$hyper-ui/components/text-input';",
				"import { Textarea } from '$hyper-ui/components/textarea';",
				"import { Select } from '$hyper-ui/components/select';",
				"import { Checkbox } from '$hyper-ui/components/checkbox';",
				"import { Button } from '$hyper-ui/components/button';",
				"import { IconButton } from '$hyper-ui/components/icon-button';",
			].join('\n'),
			filename: desktopFilename,
		},
		{
			code: "import { Toast, ToastHost } from '$hyper-ui/components/toast';",
			filename: desktopFilename,
		},
		{
			code: "import Tooltip from '../tooltip/Tooltip.svelte';",
			filename: hyperUiFilename,
		},
		{
			code: "import { Tooltip } from 'third-party-ui';",
			filename: testFilename,
		},
		{
			code: "import { ScrollableDiv } from './generated-ui';",
			filename: generatedFilename,
		},
		{
			code: "// import { Tooltip } from 'third-party-ui';",
			filename: agenticFilename,
		},
	],
	invalid: [
		{
			code: "import { Tooltip, DropdownLayer, ScrollableDiv } from '$lib/shared/ui/ui.api';",
			filename: agenticFilename,
			errors: [
				{ messageId: 'directPrimitive', data: { primitive: 'Tooltip', module: 'tooltip' } },
				{
					messageId: 'directPrimitive',
					data: { primitive: 'DropdownLayer', module: 'dropdown-layer' },
				},
				{
					messageId: 'directPrimitive',
					data: { primitive: 'ScrollableDiv', module: 'scrollable-div' },
				},
			],
		},
		{
			code: "import Tooltip from '$hyper-ui/components/tooltip/Tooltip.svelte';",
			filename: agenticFilename,
			errors: [{ messageId: 'directPrimitive', data: { primitive: 'Tooltip', module: 'tooltip' } }],
		},
		{
			code: "import { ScrollableDiv } from '$hyper-ui/components/scrollable-view';",
			filename: agenticFilename,
			errors: [
				{
					messageId: 'directPrimitive',
					data: { primitive: 'ScrollableDiv', module: 'scrollable-div' },
				},
			],
		},
		{
			code: "import Sheet from '$hyper-ui/components/sheet/Sheet.svelte';",
			filename: agenticFilename,
			errors: [{ messageId: 'directPrimitive', data: { primitive: 'Sheet', module: 'sheet' } }],
		},
		{
			code: "import { Tooltip as Help } from 'third-party-ui';",
			filename: agenticFilename,
			errors: [{ messageId: 'directPrimitive', data: { primitive: 'Tooltip', module: 'tooltip' } }],
		},
		{
			code: "export { ScrollableDiv } from './feature-scroller';",
			filename: agenticFilename,
			errors: [
				{
					messageId: 'directPrimitive',
					data: { primitive: 'ScrollableDiv', module: 'scrollable-div' },
				},
			],
		},
		{
			code: 'const local = true;',
			filename: '/apps/malini/src/lib/agentic/presentation/HoverCard.svelte',
			errors: [{ messageId: 'shadowPrimitive', data: { primitive: 'HoverCard' } }],
		},
		{
			code: 'const local = true;',
			filename: '/apps/malini/src/lib/agentic/presentation/Button.svelte',
			errors: [{ messageId: 'shadowPrimitive', data: { primitive: 'Button' } }],
		},
		{
			code: 'const local = true;',
			filename: '/apps/malini/src/lib/settings/ui/Select.svelte',
			errors: [{ messageId: 'shadowPrimitive', data: { primitive: 'Select' } }],
		},
		{
			code: "import { TextInput, Textarea } from '$lib/shared/forms/controls';",
			filename: desktopFilename,
			errors: [
				{ messageId: 'directPrimitive', data: { primitive: 'TextInput', module: 'text-input' } },
				{ messageId: 'directPrimitive', data: { primitive: 'Textarea', module: 'textarea' } },
			],
		},
		{
			code: "import { IconButton } from '$hyper-ui/components/button';",
			filename: desktopFilename,
			errors: [
				{ messageId: 'directPrimitive', data: { primitive: 'IconButton', module: 'icon-button' } },
			],
		},
	],
});

const typescriptTester = new RuleTester({
	languageOptions: {
		parser: tseslint.parser,
		parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
	},
});

typescriptTester.run('prefer-hyper-ui-entrypoint type-only imports', preferHyperUiEntrypoint, {
	valid: [
		{
			code: "import type { Tooltip } from './domain-types';",
			filename: agenticFilename,
		},
		{
			code: "import { type HoverCard } from './domain-types';",
			filename: agenticFilename,
		},
	],
	invalid: [],
});

const svelteTester = new RuleTester({
	languageOptions: { parser: textParser },
});

svelteTester.run('no-native-title-attributes', noNativeTitleAttributes, {
	valid: [
		{
			code: '<Tooltip content="Archive"><button aria-label="Archive">x</button></Tooltip>',
			filename: agenticFilename,
		},
		{
			code: '<Sheet title="Import repository">content</Sheet>',
			filename: agenticFilename,
		},
		{
			code: '<iframe title="Workspace preview" src="http://127.0.0.1" />',
			filename: agenticFilename,
		},
		{
			code: '<input bind:value={title} aria-label={title} />',
			filename: desktopFilename,
		},
		{
			code: '<svelte:head><title>Core desktop</title></svelte:head><script>document.title = pageTitle; const record = { title: pageTitle };</script>',
			filename: desktopFilename,
		},
		{
			code: '<button title="Fixture help">x</button>',
			filename: testFilename,
		},
		{
			code: '<!-- <button title="Old example">x</button> -->',
			filename: agenticFilename,
		},
	],
	invalid: [
		{
			code: '<button aria-label="Archive" title="Archive">x</button>',
			filename: agenticFilename,
			errors: [{ messageId: 'nativeTitle' }],
		},
		{
			code: '<div\n  title={helpText}\n  role="status"\n>Busy</div>',
			filename: desktopFilename,
			errors: [{ messageId: 'nativeTitle' }],
		},
		{
			code: '<button {title} aria-label={title}>Archive</button>',
			filename: desktopFilename,
			errors: [{ messageId: 'nativeTitle' }],
		},
		{
			code: '<script>node.setAttribute("title", helpText);</script>',
			filename: agenticFilename,
			errors: [{ messageId: 'programmaticTitle' }],
		},
		{
			code: "<script>node.setAttributeNS(null, 'title', helpText);</script>",
			filename: agenticFilename,
			errors: [{ messageId: 'programmaticTitle' }],
		},
	],
});

svelteTester.run('no-bespoke-overlays', noBespokeOverlays, {
	valid: [
		{
			code: '<Sheet open={open} onclose={close}><div role="dialog">content</div></Sheet>',
			filename: agenticFilename,
		},
		{
			code: '<DropdownLayer open={open} anchor={trigger} onclose={close}><div role="listbox">content</div></DropdownLayer>',
			filename: agenticFilename,
		},
		{
			code: '<Dropdown bind:open>{#snippet trigger()}trigger{/snippet}{#snippet content()}<div role="listbox">content</div>{/snippet}</Dropdown>',
			filename: agenticFilename,
		},
		{
			code: '<div role="dialog" data-testid="checkpoint-restore-dialog">migration seam</div>',
			filename: agenticFilename,
			options: [{ allowSurfaceTestIds: ['checkpoint-restore-dialog'] }],
		},
		{
			code: '<div class="fixed bottom-2 right-2" role="status">Saved</div>',
			filename: agenticFilename,
		},
		{
			code: '<div use:bodyPortal role="tooltip">internal</div>',
			filename: '/packages/hyper-ui/src/components/tooltip/Tooltip.svelte',
		},
		{
			code: '<div use:bodyPortal role="tooltip">fixture</div>',
			filename: testFilename,
		},
		{
			code: '<!-- <div use:bodyPortal role="tooltip">example</div> -->',
			filename: agenticFilename,
		},
	],
	invalid: [
		{
			code: '<div role="presentation" class="fixed inset-0 bg-black/30">backdrop</div>',
			filename: agenticFilename,
			errors: [{ messageId: 'bespokeOverlay' }],
		},
		{
			code: '<section class="fixed inset-0" aria-modal="true">dialog</section>',
			filename: agenticFilename,
			errors: [{ messageId: 'bespokeOverlay' }],
		},
		{
			code: '<section class="inset-0 fixed" aria-modal="true">dialog</section>',
			filename: agenticFilename,
			errors: [{ messageId: 'bespokeOverlay' }],
		},
		{
			code: '<div role="tooltip">help</div>',
			filename: agenticFilename,
			errors: [{ messageId: 'bespokeTooltip' }],
		},
		{
			code: '<div use:bodyPortal>menu</div>',
			filename: agenticFilename,
			errors: [{ messageId: 'bespokePortal' }],
		},
		{
			code: '<style>.list::-webkit-scrollbar { width: 4px; }</style>',
			filename: agenticFilename,
			errors: [{ messageId: 'bespokeScroller' }],
		},
		{
			code: '<div class="absolute top-full" role="listbox">options</div>',
			filename: agenticFilename,
			errors: [{ messageId: 'unmanagedInteractiveSurface' }],
		},
		{
			code: '<button popovertarget="quick-menu">Open</button><div id="quick-menu" popover>menu</div>',
			filename: agenticFilename,
			errors: [{ messageId: 'nativePopover' }, { messageId: 'nativePopover' }],
		},
	],
});

svelteTester.run('no-literal-product-colors', noLiteralProductColors, {
	valid: [
		{
			code: '<div class="border-border-subtle bg-surface-100 text-fg-default">Tokenized</div>',
			filename: agenticFilename,
		},
		{
			code: '<!-- background: rgb(0 0 0 / 0.1) --><div>Comment fixture</div>',
			filename: agenticFilename,
		},
	],
	invalid: [
		{
			code: '<div style="color: #ff00aa">Literal</div>',
			filename: agenticFilename,
			errors: [{ messageId: 'literalColor' }],
		},
		{
			code: '<style>.card { box-shadow: 0 1px rgb(0 0 0 / 0.1); }</style>',
			filename: agenticFilename,
			errors: [{ messageId: 'literalColor' }],
		},
	],
});

svelteTester.run('no-misused-state-fg-tokens', noMisusedStateFgTokens, {
	valid: [
		{
			code: '<textarea class="placeholder:text-fg-placeholder"></textarea>',
			filename: agenticFilename,
		},
		{
			code: '<textarea class="placeholder:text-fg-placeholder focus:placeholder:text-fg-composer-placeholder-focus"></textarea>',
			filename: agenticFilename,
		},
		{
			code: '<button class="disabled:text-fg-disabled">Send</button>',
			filename: agenticFilename,
		},
	],
	invalid: [
		{
			code: '<textarea class="placeholder:text-fg-tertiary"></textarea>',
			filename: agenticFilename,
			errors: [{ messageId: 'placeholderText' }],
		},
		{
			code: '<span class="text-fg-disabled">Off</span>',
			filename: agenticFilename,
			errors: [{ messageId: 'missingPrefix' }],
		},
	],
});

svelteTester.run('no-legacy-color-tokens', noLegacyColorTokens, {
	valid: [
		{
			code: '<div class="bg-surface-100 text-fg-default">Tokenized</div>',
			filename: agenticFilename,
		},
		{
			code: '<!-- This used to be `bg-base-100 text-base-content`. --><div class="bg-surface-100"></div>',
			filename: agenticFilename,
		},
		{
			code: '// single btn btn-primary submit button, replaced by <Button variant="primary" />',
			filename: agenticFilename,
		},
		{
			code: '<div class="bg-primary text-primary-content ring-primary/30"></div>',
			filename: agenticFilename,
		},
	],
	invalid: [
		{
			code: '<button class="btn btn-primary"></button>',
			filename: agenticFilename,
			errors: [{ messageId: 'legacyColor' }, { messageId: 'legacyColor' }],
		},
		{
			code: '<div class="bg-base-100 text-base-content"></div>',
			filename: agenticFilename,
			errors: [{ messageId: 'legacyColor' }, { messageId: 'legacyColor' }],
		},
		{
			code: '<a href="https://example.com" class="text-gray-500"></a>',
			filename: agenticFilename,
			errors: [{ messageId: 'legacyColor' }],
		},
	],
});

svelteTester.run('no-mismatched-surface-border', noMismatchedSurfaceBorder, {
	valid: [
		{
			code: '<div class="border border-surface-150-border bg-surface-150"></div>',
			filename: agenticFilename,
		},
		{
			code: '<div class="border border-brand bg-surface-150"></div>',
			filename: agenticFilename,
		},
		{
			code: '<div class="border border-error/40 bg-surface-150"></div>',
			filename: agenticFilename,
		},
	],
	invalid: [
		{
			code: '<div class="border border-surface-50-border bg-surface-150"></div>',
			filename: agenticFilename,
			errors: [{ messageId: 'mismatch' }],
			output: '<div class="border border-surface-150-border bg-surface-150"></div>',
		},
		{
			code: '<div class="border border-border-subtle bg-surface-150"></div>',
			filename: agenticFilename,
			errors: [{ messageId: 'mismatch' }],
			output: '<div class="border border-surface-150-border bg-surface-150"></div>',
		},
	],
});

svelteTester.run('no-raw-button', noRawButton, {
	valid: [
		{
			code: [
				"<script>import { Button } from '$hyper-ui/components/button';</script>",
				'<Button variant="primary" onclick={save}>Save</Button>',
			].join('\n'),
			filename: desktopFilename,
		},
		{
			code: '<button type="button" class="hyper-button">{@render children?.()}</button>',
			filename: '/packages/hyper-ui/src/components/button/Button.svelte',
		},
		{
			code: '<button type="button">Fixture</button>',
			filename: testFilename,
		},
		{
			code: '<!-- <button type="button">Old example</button> -->',
			filename: desktopFilename,
		},
		{
			code: '<ButtonRow>controls</ButtonRow><style>button { cursor: pointer; }</style>',
			filename: desktopFilename,
		},
		{
			code: 'const markup = `<button type="button">generated</button>`;',
			filename: '/apps/malini/src/lib/shared/shell/markup.ts',
		},
		{
			code: [
				'<!-- eslint-disable-next-line rule-to-test/no-raw-button -- drag handle, not a control -->',
				'<button type="button" onpointerdown={startDrag}></button>',
			].join('\n'),
			filename: desktopFilename,
		},
	],
	invalid: [
		{
			code: '<button type="button" onclick={save}>Save</button>',
			filename: desktopFilename,
			errors: [{ messageId: 'rawButton' }],
		},
		{
			code: '<div><button>One</button><button /></div>',
			filename: agenticFilename,
			errors: [{ messageId: 'rawButton' }, { messageId: 'rawButton' }],
		},
	],
});

svelteTester.run('no-raw-form-control', noRawFormControl, {
	valid: [
		{
			code: [
				"<script>import { TextInput } from '$hyper-ui/components/text-input';</script>",
				'<TextInput bind:value={query} label="Search" />',
			].join('\n'),
			filename: desktopFilename,
		},
		{
			code: '<input type="text" bind:value />',
			filename: '/packages/hyper-ui/src/components/text-input/TextInput.svelte',
		},
		{
			code: '<textarea bind:value={draft}></textarea>',
			filename: testFilename,
		},
		{
			code: '<!-- <select bind:value={mode}></select> -->',
			filename: desktopFilename,
		},
		{
			code: '<Select bind:value={mode} options={modes} /><style>input { color: red; }</style>',
			filename: desktopFilename,
		},
		{
			code: [
				'<!-- eslint-disable-next-line rule-to-test/no-raw-form-control -- hidden file picker, TextInput has no file type -->',
				'<input type="file" hidden onchange={pick} />',
			].join('\n'),
			filename: desktopFilename,
		},
	],
	invalid: [
		{
			code: '<input type="text" bind:value={query} />',
			filename: desktopFilename,
			errors: [{ messageId: 'rawFormControl' }],
		},
		{
			code: '<textarea bind:value={draft}></textarea>',
			filename: desktopFilename,
			errors: [{ messageId: 'rawFormControl' }],
		},
		{
			code: '<select bind:value={mode}><option>a</option></select>',
			filename: agenticFilename,
			errors: [{ messageId: 'rawFormControl' }],
		},
	],
});

javascriptTester.run('no-external-icon-packages', noExternalIconPackages, {
	valid: [
		{
			code: "import { Icon } from '$hyper-ui/icons';",
			filename: desktopFilename,
		},
		{
			code: "import CloseIcon from '$hyper-ui/icons/CloseIcon.svelte';",
			filename: desktopFilename,
		},
		{
			code: "import manifest from 'material-icon-theme/dist/material-icons.json';",
			filename: '/apps/malini/src/lib/shared/files/manifest.ts',
		},
		{
			code: "import { X } from '@lucide/svelte';",
			filename: testFilename,
		},
		{
			code: "// import { X } from '@lucide/svelte';",
			filename: desktopFilename,
		},
	],
	invalid: [
		{
			code: "import { X, ChevronDown } from '@lucide/svelte';",
			filename: desktopFilename,
			errors: [{ messageId: 'externalIconPackage', data: { source: '@lucide/svelte' } }],
		},
		{
			code: "import Home from '@tabler/icons-svelte';",
			filename: agenticFilename,
			errors: [{ messageId: 'externalIconPackage', data: { source: '@tabler/icons-svelte' } }],
		},
		{
			code: "import { Glyph } from 'svelte-awesome-icons';",
			filename: desktopFilename,
			errors: [{ messageId: 'externalIconPackage', data: { source: 'svelte-awesome-icons' } }],
		},
	],
});

javascriptTester.run('no-direct-component-file-import', noDirectComponentFileImport, {
	valid: [
		{
			code: "import { Button } from '$hyper-ui/components/button';",
			filename: desktopFilename,
		},
		{
			code: "import { Modal } from '@malini/hyper-ui/components/modal';",
			filename: agenticFilename,
		},
		{
			code: "import CloseIcon from '$hyper-ui/icons/CloseIcon.svelte';",
			filename: desktopFilename,
		},
		{
			code: "import Tooltip from '../tooltip/Tooltip.svelte';",
			filename: hyperUiFilename,
		},
		{
			code: "import Button from '$hyper-ui/components/button/Button.svelte';",
			filename: testFilename,
		},
	],
	invalid: [
		{
			code: "import Button from '$hyper-ui/components/button/Button.svelte';",
			filename: desktopFilename,
			errors: [{ messageId: 'directComponentFile', data: { folder: 'button', module: 'Button' } }],
		},
		{
			code: "import DropdownItem from '@malini/hyper-ui/components/dropdown/DropdownItem.svelte';",
			filename: agenticFilename,
			errors: [
				{ messageId: 'directComponentFile', data: { folder: 'dropdown', module: 'DropdownItem' } },
			],
		},
		{
			code: "const Sheet = await import('../../../packages/hyper-ui/src/components/sheet/Sheet.svelte');",
			filename: desktopFilename,
			errors: [{ messageId: 'directComponentFile', data: { folder: 'sheet', module: 'Sheet' } }],
		},
	],
});

const cssFilename = '/packages/hyper-ui/src/styles/components/buttons.css';
const backgroundTransition = { messageId: 'backgroundTransition' };

svelteTester.run('no-background-transition', noBackgroundTransition, {
	valid: [
		{
			code: '<button class="hover:bg-surface-100-hover hover:text-fg-default transition-[color,border-color] duration-150">Go</button>',
			filename: desktopFilename,
		},
		{
			code: '<div class="opacity-0 transition-opacity transition-transform transition-shadow"></div>',
			filename: desktopFilename,
		},
		{
			code: '<div class="transition-[opacity,transform] transition-none"></div>',
			filename: desktopFilename,
		},
		{
			code: '<style>.row { transition: color 120ms ease, opacity var(--default-transition-duration) ease-out; }</style>',
			filename: desktopFilename,
		},
		{
			code: '.drawer { transition:\n\theight 240ms cubic-bezier(0.16, 1, 0.3, 1),\n\topacity 160ms ease-out;\n}',
			filename: cssFilename,
		},
		{
			code: '.row { transition: none; transition-property: color, border-color; transition-duration: 0ms; }',
			filename: cssFilename,
		},
		{
			code: "<script>import { fade } from 'svelte/transition';</script><div transition:fade={{ duration: 150 }}></div>",
			filename: desktopFilename,
		},
		{
			code: "<p>{'Smooth transition between states.'}</p><p>The transition-free flow</p>",
			filename: desktopFilename,
		},
		{
			code: '<div class="transition-colors"></div>',
			filename: testFilename,
		},
	],
	invalid: [
		{
			code: '<button class="hover:bg-surface-100-hover transition-colors">Go</button>',
			filename: desktopFilename,
			errors: [{ ...backgroundTransition, data: { source: 'transition-colors' } }],
		},
		{
			code: '<div class="hover:scale-105 transition-all duration-150"></div>',
			filename: desktopFilename,
			errors: [{ ...backgroundTransition, data: { source: 'transition-all' } }],
		},
		{
			code: '<div class="flex items-center transition duration-150"></div>',
			filename: desktopFilename,
			errors: [{ ...backgroundTransition, data: { source: 'transition' } }],
		},
		{
			code: "<div class={['rounded-md px-2 transition-[opacity,background-color,color]', active && 'bg-chip']}></div>",
			filename: desktopFilename,
			errors: [
				{
					...backgroundTransition,
					data: { source: 'transition-[opacity,background-color,color]' },
				},
			],
		},
		{
			code: '<style>.row { transition: background-color 50ms ease-in-out; }</style>',
			filename: desktopFilename,
			errors: [backgroundTransition],
		},
		{
			code: '<style>.pill { transition:\n\tcolor 120ms ease,\n\tbackground 120ms ease; }</style>',
			filename: desktopFilename,
			errors: [backgroundTransition],
		},
		{
			code: '.button { transition-property: color, background-color, border-color, scale; }',
			filename: cssFilename,
			errors: [backgroundTransition],
		},
		{
			code: '.button { transition: all 150ms ease; }',
			filename: cssFilename,
			errors: [backgroundTransition],
		},
		{
			code: '.button { transition: 150ms ease-out; }',
			filename: cssFilename,
			errors: [backgroundTransition],
		},
		{
			code: '.button { @apply flex h-7 rounded-md transition-colors ease-in-out; }',
			filename: cssFilename,
			errors: [{ ...backgroundTransition, data: { source: 'transition-colors' } }],
		},
		{
			code: '.button { @apply flex h-7 rounded-md transition ease-in-out; }',
			filename: cssFilename,
			errors: [{ ...backgroundTransition, data: { source: 'transition' } }],
		},
	],
});

console.log('desktop design-system ESLint rules: all RuleTester cases passed');
