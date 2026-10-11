export type Oklch = Readonly<{ l: number; c: number; h: number }>;

export type Rgb = readonly [number, number, number];

export function oklchToLinearSrgb({ l, c, h }: Oklch): Rgb {
	const a = c * Math.cos(radians(h));
	const b = c * Math.sin(radians(h));
	const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		clampUnit(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
		clampUnit(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
		clampUnit(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
	];
}

export function oklchToSrgbBytes(color: Oklch): Rgb {
	const [red, green, blue] = oklchToLinearSrgb(color);
	return [encode(red), encode(green), encode(blue)];
}

export function contrastRatio(first: Oklch, second: Oklch): number {
	const [lighter, darker] = [luminance(first), luminance(second)].sort((x, y) => y - x);
	return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

export function oklchCss({ l, c, h }: Oklch): string {
	return `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(4)} ${h.toFixed(0)})`;
}

function luminance(color: Oklch): number {
	const [red, green, blue] = oklchToLinearSrgb(color);
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function encode(linear: number): number {
	const gamma = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
	return Math.round(255 * gamma);
}

function radians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}
