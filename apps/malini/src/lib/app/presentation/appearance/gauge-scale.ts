export type ScaleTick = Readonly<{
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	major: boolean;
}>;

export type ScaleLabel = Readonly<{
	text: string;
	x: number;
	y: number;
	anchor: 'start' | 'middle' | 'end';
}>;
