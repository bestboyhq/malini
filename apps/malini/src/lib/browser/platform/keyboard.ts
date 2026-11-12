export interface KeyEvent {
	readonly type: 'keyDown' | 'rawKeyDown' | 'keyUp';
	readonly key: string;
	readonly code: string;
	readonly windowsVirtualKeyCode: number;
	readonly modifiers: number;
	readonly text?: string;
	readonly unmodifiedText?: string;
	readonly commands?: readonly string[];
}

interface KeyDefinition {
	readonly key: string;
	readonly code: string;
	readonly keyCode: number;
	readonly text?: string;
}

const MODIFIERS = {
	Alt: { bit: 1, code: 'AltLeft', keyCode: 18 },
	Control: { bit: 2, code: 'ControlLeft', keyCode: 17 },
	Meta: { bit: 4, code: 'MetaLeft', keyCode: 91 },
	Shift: { bit: 8, code: 'ShiftLeft', keyCode: 16 },
} as const;

type Modifier = keyof typeof MODIFIERS;

const ALIASES: Readonly<Record<string, string>> = {
	ctrl: 'Control',
	control: 'Control',
	cmd: 'Meta',
	command: 'Meta',
	meta: 'Meta',
	alt: 'Alt',
	option: 'Alt',
	shift: 'Shift',
	esc: 'Escape',
	return: 'Enter',
	up: 'ArrowUp',
	down: 'ArrowDown',
	left: 'ArrowLeft',
	right: 'ArrowRight',
	space: ' ',
	del: 'Delete',
};

const NAMED: Readonly<Record<string, KeyDefinition>> = {
	Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
	Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
	Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
	Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
	Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
	Insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
	Home: { key: 'Home', code: 'Home', keyCode: 36 },
	End: { key: 'End', code: 'End', keyCode: 35 },
	PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
	PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
	ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
	ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
	ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
	ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
	' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
	...Object.fromEntries(
		Array.from({ length: 12 }, (_, index) => {
			const name = `F${index + 1}`;
			return [name, { key: name, code: name, keyCode: 112 + index }];
		}),
	),
};

const MAC_COMMANDS: Readonly<Record<string, string>> = {
	Backspace: 'deleteBackward',
	Delete: 'deleteForward',
	Escape: 'cancelOperation',
	ArrowUp: 'moveUp',
	ArrowDown: 'moveDown',
	ArrowLeft: 'moveLeft',
	ArrowRight: 'moveRight',
	Home: 'scrollToBeginningOfDocument',
	End: 'scrollToEndOfDocument',
	PageUp: 'scrollPageUp',
	PageDown: 'scrollPageDown',
	'Shift+Backspace': 'deleteBackward',
	'Shift+Delete': 'deleteForward',
	'Shift+ArrowUp': 'moveUpAndModifySelection',
	'Shift+ArrowDown': 'moveDownAndModifySelection',
	'Shift+ArrowLeft': 'moveLeftAndModifySelection',
	'Shift+ArrowRight': 'moveRightAndModifySelection',
	'Shift+Home': 'moveToBeginningOfDocumentAndModifySelection',
	'Shift+End': 'moveToEndOfDocumentAndModifySelection',
	'Alt+Backspace': 'deleteWordBackward',
	'Alt+Delete': 'deleteWordForward',
	'Alt+ArrowLeft': 'moveWordLeft',
	'Alt+ArrowRight': 'moveWordRight',
	'Shift+Alt+ArrowLeft': 'moveWordLeftAndModifySelection',
	'Shift+Alt+ArrowRight': 'moveWordRightAndModifySelection',
	'Meta+Backspace': 'deleteToBeginningOfLine',
	'Meta+ArrowUp': 'moveToBeginningOfDocument',
	'Meta+ArrowDown': 'moveToEndOfDocument',
	'Meta+ArrowLeft': 'moveToLeftEndOfLine',
	'Meta+ArrowRight': 'moveToRightEndOfLine',
	'Shift+Meta+ArrowLeft': 'moveToLeftEndOfLineAndModifySelection',
	'Shift+Meta+ArrowRight': 'moveToRightEndOfLineAndModifySelection',
	'Meta+KeyA': 'selectAll',
	'Meta+KeyZ': 'undo',
	'Shift+Meta+KeyZ': 'redo',
};

const MODIFIER_ORDER: readonly Modifier[] = ['Shift', 'Control', 'Alt', 'Meta'];

const NAMED_BY_LOWER = new Map(
	[...Object.keys(NAMED), ...Object.keys(MODIFIERS)].map((name) => [name.toLowerCase(), name]),
);

export function keyPresses(chord: string, mac: boolean): KeyEvent[] {
	const names = chordParts(chord)
		.map((part) => (part === ' ' ? part : part.trim()))
		.map(canonical);
	const main = names.at(-1);
	const held = names.slice(0, -1);
	if (main === undefined || main.length === 0 || held.some((name) => !isModifier(name))) {
		throw new Error(unknownKey(chord));
	}
	const modifiers = held.filter(isModifier);
	const definition = isModifier(main) ? modifierKey(main) : keyDefinition(main, modifiers);
	if (!definition) throw new Error(unknownKey(chord));
	const events: KeyEvent[] = [];
	let mask = 0;
	for (const name of modifiers) {
		mask |= MODIFIERS[name].bit;
		events.push(press('rawKeyDown', modifierKey(name), mask));
	}
	const all = isModifier(main) ? mask | MODIFIERS[main].bit : mask;
	const typed =
		definition.text !== undefined && !(all & (MODIFIERS.Control.bit | MODIFIERS.Meta.bit));
	const down = typed
		? {
				...press('keyDown', definition, all),
				text: definition.text,
				unmodifiedText: definition.text,
			}
		: press('rawKeyDown', definition, all);
	const command = mac ? macCommand(modifiers, definition) : undefined;
	events.push(command === undefined ? down : { ...down, commands: [command] });
	events.push(press('keyUp', definition, all));
	for (const name of [...modifiers].reverse()) {
		mask &= ~MODIFIERS[name].bit;
		events.push(press('keyUp', modifierKey(name), mask));
	}
	return events;
}

function macCommand(
	modifiers: readonly Modifier[],
	{ code, key }: KeyDefinition,
): string | undefined {
	const held = MODIFIER_ORDER.filter((name) => modifiers.includes(name));
	return MAC_COMMANDS[[...held, code || key].join('+')];
}

function chordParts(chord: string): string[] {
	if (chord === '+') return ['+'];
	if (chord.endsWith('++')) return [...chord.slice(0, -2).split('+'), '+'];
	return chord.split('+');
}

function canonical(name: string): string {
	if ([...name].length === 1) return name;
	return ALIASES[name.toLowerCase()] ?? NAMED_BY_LOWER.get(name.toLowerCase()) ?? name;
}

function isModifier(name: string): name is Modifier {
	return Object.hasOwn(MODIFIERS, name);
}

function modifierKey(name: Modifier): KeyDefinition {
	const { code, keyCode } = MODIFIERS[name];
	return { key: name, code, keyCode };
}

function keyDefinition(name: string, modifiers: readonly Modifier[]): KeyDefinition | null {
	const named = NAMED[name];
	if (named) return named;
	if ([...name].length !== 1) return null;
	const shifted = modifiers.includes('Shift');
	const upper = name.toUpperCase();
	const key = shifted && /^[a-z]$/u.test(name) ? upper : name;
	if (/^[a-z]$/iu.test(name)) {
		return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: key };
	}
	if (/^[0-9]$/u.test(name)) {
		return { key, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: key };
	}
	return { key, code: '', keyCode: 0, text: key };
}

function press(
	type: KeyEvent['type'],
	{ key, code, keyCode }: KeyDefinition,
	modifiers: number,
): KeyEvent {
	return { type, key, code, windowsVirtualKeyCode: keyCode, modifiers };
}

function unknownKey(chord: string): string {
	const names = Object.keys(NAMED)
		.filter((name) => name !== ' ')
		.join(', ');
	return `\`${chord}\` is not a key Malini knows. Use a single character or one of ${names}, Space, with Shift, Control, Alt or Meta joined by +, for example Shift+Tab.`;
}
