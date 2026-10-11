import type { Attachment } from 'svelte/attachments';
import { oklchToSrgbBytes, type Oklch } from '$lib/app/domain/oklab';
import type { GaugePoint } from '$lib/app/domain/tint-gauges';

export function paintGauge(colorAt: (point: GaugePoint) => Oklch): Attachment<HTMLCanvasElement> {
	return (canvas) => {
		const observer = new ResizeObserver(() => paint(canvas, colorAt));
		observer.observe(canvas);
		return () => observer.disconnect();
	};
}

function paint(canvas: HTMLCanvasElement, colorAt: (point: GaugePoint) => Oklch): void {
	const ratio = window.devicePixelRatio || 1;
	const width = Math.round(canvas.clientWidth * ratio);
	const height = Math.round(canvas.clientHeight * ratio);
	const context = canvas.getContext('2d');
	if (!context || width === 0 || height === 0) return;
	canvas.width = width;
	canvas.height = height;
	const image = context.createImageData(width, height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const [red, green, blue] = oklchToSrgbBytes(colorAt([(x + 0.5) / width, (y + 0.5) / height]));
			const offset = (y * width + x) * 4;
			image.data[offset] = red;
			image.data[offset + 1] = green;
			image.data[offset + 2] = blue;
			image.data[offset + 3] = 255;
		}
	}
	context.putImageData(image, 0, 0);
}
