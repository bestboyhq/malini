import stackUrl from '../../../../build/tray/trayTemplate@2x.png?url';

const ICON = 36;
const BADGE_X = 17;
const BADGE_Y = 15;
const BADGE_HEIGHT = 21;
const BADGE_GAP = 3.5;
const BADGE_PADDING = 10;
const FONT = '800 14px "Geist Mono Variable"';

let stack: Promise<HTMLImageElement> | null = null;

async function loadStack(): Promise<HTMLImageElement> {
	const image = new Image();
	image.src = stackUrl;
	await Promise.all([image.decode(), document.fonts.load(FONT)]);
	return image;
}

function capsule(
	context: OffscreenCanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	context.beginPath();
	context.roundRect(x, y, width, height, height / 2);
	context.fill();
}

export async function drawTrayBadge(count: number): Promise<Uint8Array | null> {
	if (count === 0) return null;
	stack ??= loadStack();
	const image = await stack;
	const label = count > 99 ? '99+' : String(count);
	const canvas = new OffscreenCanvas(ICON, ICON);
	const context = canvas.getContext('2d');
	if (!context) return null;
	context.font = FONT;
	const width = Math.max(BADGE_HEIGHT, context.measureText(label).width + BADGE_PADDING);
	canvas.width = 2 * Math.ceil(Math.max(ICON, BADGE_X + width + 1) / 2);
	context.drawImage(image, 0, 0, ICON, ICON);
	context.globalCompositeOperation = 'destination-out';
	capsule(
		context,
		BADGE_X - BADGE_GAP,
		BADGE_Y - BADGE_GAP,
		width + BADGE_GAP * 2,
		BADGE_HEIGHT + BADGE_GAP * 2,
	);
	context.globalCompositeOperation = 'source-over';
	capsule(context, BADGE_X, BADGE_Y, width, BADGE_HEIGHT);
	context.globalCompositeOperation = 'destination-out';
	context.font = FONT;
	context.textAlign = 'center';
	const { actualBoundingBoxAscent, actualBoundingBoxDescent } = context.measureText(label);
	const baseline =
		BADGE_Y + (BADGE_HEIGHT + actualBoundingBoxAscent - actualBoundingBoxDescent) / 2;
	context.fillText(label, BADGE_X + width / 2, baseline);
	const png = await canvas.convertToBlob({ type: 'image/png' });
	return new Uint8Array(await png.arrayBuffer());
}
