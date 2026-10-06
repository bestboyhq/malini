import type { ExtensionPanelRegistration } from '@malini/extension-api';
import { describe, expect, it } from 'vitest';

import { INSPECTOR_MIN_WIDTH, inspectorMinWidth } from './inspector-min-width';

function panel(id: string, minWidth?: number): ExtensionPanelRegistration {
	return {
		id,
		label: id,
		icon: 'file',
		...(minWidth === undefined ? {} : { minWidth }),
		component: { mount: () => ({ dispose: () => undefined }) },
	};
}

describe('inspectorMinWidth', () => {
	it('falls back to the inspector floor when nothing asks for more', () => {
		expect(inspectorMinWidth([panel('files'), panel('changes')], [])).toBe(INSPECTOR_MIN_WIDTH);
	});

	it('takes the widest open tab, not the selected one', () => {
		const panels = [panel('files'), panel('file:a.ts', 480), panel('file:b.ts', 520)];
		expect(inspectorMinWidth(panels, [])).toBe(520);
	});

	it('ignores a closed tab, because a panel nobody can see is not a claim on width', () => {
		const panels = [panel('files'), panel('file:a.ts', 520)];
		expect(inspectorMinWidth(panels, ['file:a.ts'])).toBe(INSPECTOR_MIN_WIDTH);
	});

	it('never goes below the floor, however narrow a panel declares itself', () => {
		expect(inspectorMinWidth([panel('tiny', 120)], [])).toBe(INSPECTOR_MIN_WIDTH);
	});

	it('honors a caller-supplied floor', () => {
		expect(inspectorMinWidth([panel('files')], [], 400)).toBe(400);
		expect(inspectorMinWidth([panel('files', 640)], [], 400)).toBe(640);
	});
});
