import type { Attachment } from 'svelte/attachments';
import { CAST_SHADOW, type StageLighting } from '../domain/stage-lighting';

type Rgba = readonly [number, number, number, number];

type CastShadow = {
	rect: readonly [number, number, number, number];
	radius: number;
	sigma: number;
	offset: number;
	spread: number;
};

type Scene = {
	lighting: StageLighting;
	page: Rgba;
	ink: Rgba;
	strength: number;
	shadow: Rgba;
	caster: CastShadow | null;
};

type Renderer = {
	source: HTMLCanvasElement;
	draw: (width: number, height: number, scene: Scene) => void;
};

const NO_SHADOW: CastShadow = { rect: [0, 0, 0, 0], radius: 0, sigma: 1, offset: 0, spread: 0 };

const repaints = new Set<() => void>();
let renderer: Renderer | null = null;
let unavailable = false;

export function stageLight(
	lighting: StageLighting,
	onReady: (ready: boolean) => void,
	caster?: HTMLElement,
): Attachment<HTMLCanvasElement> {
	return (canvas) => {
		let visible = false;
		const scheme = matchMedia('(prefers-color-scheme: dark)');
		const resizer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				if (entry.target === canvas) {
					[canvas.width, canvas.height] = deviceSize(entry, devicePixelRatio);
				}
			}
			paint();
		});
		const viewport = new IntersectionObserver(
			([entry]) => {
				visible = entry?.isIntersecting ?? false;
				paint();
			},
			{ rootMargin: '200px' },
		);

		function paint(): void {
			if (!visible || canvas.width === 0 || canvas.height === 0) return;
			const shared = sharedRenderer();
			const target = canvas.getContext('2d');
			if (!shared || !target) {
				onReady(false);
				return;
			}
			const style = getComputedStyle(canvas);
			shared.draw(canvas.width, canvas.height, {
				lighting,
				page: toRgba(style.getPropertyValue('--bg')),
				ink: toRgba(style.getPropertyValue('--stage-ink')),
				strength: Number.parseFloat(style.getPropertyValue('--stage-strength')) || 1,
				shadow: toRgba(style.getPropertyValue('--stage-shadow')),
				caster: caster ? castShadow(canvas, caster) : null,
			});
			target.drawImage(shared.source, 0, 0);
			onReady(true);
		}

		try {
			resizer.observe(canvas, { box: 'device-pixel-content-box' });
		} catch {
			resizer.observe(canvas);
		}
		if (caster) resizer.observe(caster);
		viewport.observe(canvas);
		scheme.addEventListener('change', paint);
		repaints.add(paint);

		return () => {
			resizer.disconnect();
			viewport.disconnect();
			scheme.removeEventListener('change', paint);
			repaints.delete(paint);
		};
	};
}

function castShadow(canvas: HTMLCanvasElement, caster: HTMLElement): CastShadow {
	const stage = canvas.getBoundingClientRect();
	const box = caster.getBoundingClientRect();
	const scale = stage.width > 0 ? canvas.width / stage.width : 1;
	return {
		rect: [
			(box.left - stage.left) * scale,
			(box.top - stage.top) * scale,
			box.width * scale,
			box.height * scale,
		],
		radius: (Number.parseFloat(getComputedStyle(caster).borderTopLeftRadius) || 0) * scale,
		sigma: (CAST_SHADOW.blur / 2) * scale,
		offset: CAST_SHADOW.offsetY * scale,
		spread: CAST_SHADOW.spread * scale,
	};
}

function deviceSize(entry: ResizeObserverEntry, ratio: number): [number, number] {
	const width = Math.round(entry.contentRect.width * ratio);
	const height = Math.round(entry.contentRect.height * ratio);
	const exact = entry.devicePixelContentBoxSize?.[0];
	return exact && Math.abs(exact.inlineSize - width) <= 2 && Math.abs(exact.blockSize - height) <= 2
		? [exact.inlineSize, exact.blockSize]
		: [width, height];
}

function sharedRenderer(): Renderer | null {
	if (renderer || unavailable) return renderer;
	const source = document.createElement('canvas');
	source.addEventListener('webglcontextlost', (event) => {
		event.preventDefault();
		renderer = null;
	});
	source.addEventListener('webglcontextrestored', () => {
		renderer = createRenderer(source);
		unavailable = renderer === null;
		repaints.forEach((repaint) => repaint());
	});
	renderer = createRenderer(source);
	unavailable = renderer === null;
	return renderer;
}

let colorProbe: CanvasRenderingContext2D | null = null;

function toRgba(color: string): Rgba {
	colorProbe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	if (!colorProbe) return [0, 0, 0, 0];
	colorProbe.clearRect(0, 0, 1, 1);
	colorProbe.fillStyle = 'transparent';
	colorProbe.fillStyle = color.trim();
	colorProbe.fillRect(0, 0, 1, 1);
	const [red = 0, green = 0, blue = 0, alpha = 0] = colorProbe.getImageData(0, 0, 1, 1).data;
	return [red / 255, green / 255, blue / 255, alpha / 255];
}

const VERTEX_SOURCE = `
attribute vec2 position;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SOURCE = `
precision highp float;

uniform vec2 size;
uniform vec3 page;
uniform vec3 ink;
uniform vec2 spot;
uniform vec2 spread;
uniform vec2 floorFrom;
uniform vec2 floorTo;
uniform float fadeTop;
uniform float strength;
uniform vec4 caster;
uniform float casterRadius;
uniform float shadowSigma;
uniform float shadowOffset;
uniform float shadowSpread;
uniform vec4 shadow;

float softClamp(float x, float knee) {
  float halfKnee = knee * 0.5;
  if (x <= -halfKnee) return 0.0;
  if (x < halfKnee) return (x + halfKnee) * (x + halfKnee) / (2.0 * knee);
  if (x <= 1.0 - halfKnee) return x;
  if (x < 1.0 + halfKnee) return 1.0 - (1.0 + halfKnee - x) * (1.0 + halfKnee - x) / (2.0 * knee);
  return 1.0;
}

float whiteNoise(vec2 point) {
  vec3 p = fract(vec3(point.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec2 erf(vec2 x) {
  vec2 s = sign(x);
  vec2 a = abs(x);
  x = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  x *= x;
  return s - s / (x * x);
}

float gaussian(float x, float sigma) {
  return exp(-(x * x) / (2.0 * sigma * sigma)) / (2.5066282746 * sigma);
}

float shadowRow(float x, float y, float sigma, float corner, vec2 halfSize) {
  float delta = min(halfSize.y - corner - abs(y), 0.0);
  float curved = halfSize.x - corner + sqrt(max(0.0, corner * corner - delta * delta));
  vec2 integral = 0.5 + 0.5 * erf((x + vec2(-curved, curved)) * (0.7071067812 / sigma));
  return integral.y - integral.x;
}

float roundedBoxShadow(vec2 lower, vec2 upper, vec2 point, float sigma, float corner) {
  vec2 halfSize = max((upper - lower) * 0.5, 0.0);
  point -= (lower + upper) * 0.5;
  corner = min(corner, min(halfSize.x, halfSize.y));
  float start = clamp(-3.0 * sigma, point.y - halfSize.y, point.y + halfSize.y);
  float end = clamp(3.0 * sigma, point.y - halfSize.y, point.y + halfSize.y);
  float stride = (end - start) / 8.0;
  float y = start + stride * 0.5;
  float value = 0.0;
  for (int i = 0; i < 8; i++) {
    value += shadowRow(point.x, point.y - y, sigma, corner, halfSize) * gaussian(y, sigma) * stride;
    y += stride;
  }
  return value;
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / size.x, 1.0 - gl_FragCoord.y / size.y);

  vec2 axis = floorTo - floorFrom;
  float floorPosition = dot(uv - floorFrom, axis) / dot(axis, axis);

  vec3 floorTone = mix(page, ink, 0.1125 * strength);
  vec3 color = mix(page, floorTone, softClamp(floorPosition, 0.2));

  float spotDistance = length((uv - spot) / spread);
  color = mix(color, ink, 0.1875 * strength * softClamp(1.0 - spotDistance, 0.3));
  color += (ink - page) * 0.0186 * strength;

  color = mix(color, mix(page, color, softClamp(uv.y / 0.4, 0.3)), fadeTop);

  if (shadow.a > 0.0) {
    vec2 point = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
    vec2 lower = caster.xy - shadowSpread + vec2(0.0, shadowOffset);
    vec2 upper = caster.xy + caster.zw + shadowSpread + vec2(0.0, shadowOffset);
    float corner = max(casterRadius + shadowSpread, 0.0);
    color = mix(color, shadow.rgb, shadow.a * roundedBoxShadow(lower, upper, point, shadowSigma, corner));
  }

  float dither = whiteNoise(gl_FragCoord.xy) + whiteNoise(gl_FragCoord.xy + 71.37) - 1.0;
  gl_FragColor = vec4(color + dither / 255.0, 1.0);
}
`;

function createRenderer(source: HTMLCanvasElement): Renderer | null {
	const gl = source.getContext('webgl', {
		alpha: false,
		antialias: false,
		depth: false,
		stencil: false,
		preserveDrawingBuffer: true,
		powerPreference: 'low-power',
	});
	if (!gl) return null;
	const program = linkProgram(gl);
	if (!program) return null;

	gl.useProgram(program);
	gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	const position = gl.getAttribLocation(program, 'position');
	gl.enableVertexAttribArray(position);
	gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

	const uniform = (name: string) => gl.getUniformLocation(program, name);
	const size = uniform('size');
	const page = uniform('page');
	const ink = uniform('ink');
	const spot = uniform('spot');
	const spread = uniform('spread');
	const floorFrom = uniform('floorFrom');
	const floorTo = uniform('floorTo');
	const fadeTop = uniform('fadeTop');
	const strengthLevel = uniform('strength');
	const caster = uniform('caster');
	const casterRadius = uniform('casterRadius');
	const shadowSigma = uniform('shadowSigma');
	const shadowOffset = uniform('shadowOffset');
	const shadowSpread = uniform('shadowSpread');
	const shadow = uniform('shadow');

	return {
		source,
		draw(width, height, scene) {
			if (source.width !== width) source.width = width;
			if (source.height !== height) source.height = height;
			gl.viewport(0, 0, width, height);
			gl.uniform2f(size, width, height);
			gl.uniform3fv(page, scene.page.slice(0, 3));
			gl.uniform3fv(ink, scene.ink.slice(0, 3));
			gl.uniform2f(spot, ...scene.lighting.spot);
			gl.uniform2f(spread, ...scene.lighting.spread);
			gl.uniform2f(floorFrom, ...scene.lighting.floorFrom);
			gl.uniform2f(floorTo, ...scene.lighting.floorTo);
			gl.uniform1f(fadeTop, scene.lighting.fadeTop ? 1 : 0);
			gl.uniform1f(strengthLevel, scene.strength);
			const cast = scene.caster ?? NO_SHADOW;
			const [red, green, blue, opacity] = scene.shadow;
			gl.uniform4f(caster, ...cast.rect);
			gl.uniform1f(casterRadius, cast.radius);
			gl.uniform1f(shadowSigma, cast.sigma);
			gl.uniform1f(shadowOffset, cast.offset);
			gl.uniform1f(shadowSpread, cast.spread);
			gl.uniform4f(shadow, red, green, blue, scene.caster ? opacity : 0);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		},
	};
}

function linkProgram(gl: WebGLRenderingContext): WebGLProgram | null {
	const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
	const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
	if (!vertex || !fragment) return null;
	const program = gl.createProgram();
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function compileShader(
	gl: WebGLRenderingContext,
	type: number,
	source: string,
): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}
