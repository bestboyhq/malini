export interface DropdownDocumentClickContext {
	targetInsideTrigger: boolean;
	targetInsideCard: boolean;
	targetInsideSubmenuPortal: boolean;
	targetInsideDialog: boolean;
	triggerInsideTargetDialog: boolean;
}

export function shouldCloseDropdownFromDocumentClick({
	targetInsideTrigger,
	targetInsideCard,
	targetInsideSubmenuPortal,
	targetInsideDialog,
	triggerInsideTargetDialog,
}: DropdownDocumentClickContext): boolean {
	if (targetInsideTrigger || targetInsideCard || targetInsideSubmenuPortal) return false;
	if (targetInsideDialog && !triggerInsideTargetDialog) return false;
	return true;
}
