import { describe, expect, it } from 'vitest';
import { shouldCloseDropdownFromDocumentClick } from './dropdown-click';

describe('shouldCloseDropdownFromDocumentClick', () => {
	it('keeps the dropdown open for its trigger, card, and submenu portal', () => {
		for (const location of [
			'targetInsideTrigger',
			'targetInsideCard',
			'targetInsideSubmenuPortal',
		] as const) {
			expect(
				shouldCloseDropdownFromDocumentClick({
					targetInsideTrigger: location === 'targetInsideTrigger',
					targetInsideCard: location === 'targetInsideCard',
					targetInsideSubmenuPortal: location === 'targetInsideSubmenuPortal',
					targetInsideDialog: false,
					triggerInsideTargetDialog: false,
				}),
			).toBe(false);
		}
	});

	it('keeps the dropdown open when an outside click lands in another dialog', () => {
		expect(
			shouldCloseDropdownFromDocumentClick({
				targetInsideTrigger: false,
				targetInsideCard: false,
				targetInsideSubmenuPortal: false,
				targetInsideDialog: true,
				triggerInsideTargetDialog: false,
			}),
		).toBe(false);
	});

	it('closes for the same dialog or content outside dialogs', () => {
		expect(
			shouldCloseDropdownFromDocumentClick({
				targetInsideTrigger: false,
				targetInsideCard: false,
				targetInsideSubmenuPortal: false,
				targetInsideDialog: true,
				triggerInsideTargetDialog: true,
			}),
		).toBe(true);
		expect(
			shouldCloseDropdownFromDocumentClick({
				targetInsideTrigger: false,
				targetInsideCard: false,
				targetInsideSubmenuPortal: false,
				targetInsideDialog: false,
				triggerInsideTargetDialog: false,
			}),
		).toBe(true);
	});
});
