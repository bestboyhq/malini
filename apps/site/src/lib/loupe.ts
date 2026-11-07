export type Use = Readonly<{ col: number; color: string; at: number; lines: readonly string[] }>;

export type LoupeParts = Readonly<{
	stage: HTMLElement;
	glass: HTMLElement;
	lens: HTMLElement;
	canvas: HTMLCanvasElement;
	cols: readonly HTMLElement[];
	pools: readonly (readonly string[])[];
	uses: readonly Use[];
	resting: number;
}>;

type Point = { x: number; y: number };

type Col = {
	box: HTMLElement;
	feed: HTMLElement;
	pool: readonly string[];
	speed: number;
	at: number;
	queue: Queued[];
	y: number;
	boost: number;
	wait: number;
	owed: number;
	mark: number;
};

type Queued = readonly [text: string, hot: string | null, shift: number];

type Box = Readonly<{ x: number; w: number; pad: number; fade: boolean; rule: boolean }>;

type Focus = Readonly<{ col: Col; line: Element; count: number; to: number }>;

type Look = Readonly<{ color: string; spacing: string }>;

const ROW = 16;
const SOFT = 14;
const EVERY = 4_800;
const SEEK = 1_200;
const SPEED = [9, 7, 11];
const STIFF = 40;
const DAMP = 2 * Math.sqrt(STIFF);
const LEAD = (DAMP / STIFF) * 1_000;
const WALL = 0.6;

const TOKEN =
	/(?<c>(?:^|\s)[;#]\s.*$|^##?\s.*$)|(?<s>"[^"]*"|~\/[^\s)"]*)|(?<o>\btrue\b|✓)|(?<w>\b(?:Bash|Read|Edit|Write|Grep)\b)|(?<f>(?<=\s)--?[a-z][\w-]*)/gu;

const VERT = `#version 300 es
void main() {
	vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uLens;
uniform vec4 uBox;
uniform vec3 uView;
uniform float uPop;
out vec4 color;

const float BEVEL = 0.15;
const float FOLD = 0.6;
const float DISPERSION = 0.06;
const float DEFOCUS = 0.008;
const float FROST = 0.7;
const float FROST_R = 0.1;
const int FROST_TAPS = 8;
const vec3 KEY = vec3(0.0, -0.9, 0.43);
const float DIM = 0.08;
const float SHADOW = 0.11;
const float SHADOW_SHIFT = 0.1;
const float SHADOW_BLUR = 0.15;

vec2 hermite(float s, float p0, float m0, float p1, float m1) {
	float s2 = s * s;
	float s3 = s2 * s;
	return vec2(
		(2.0 * s3 - 3.0 * s2 + 1.0) * p0 + (s3 - 2.0 * s2 + s) * m0 + (3.0 * s2 - 2.0 * s3) * p1 + (s3 - s2) * m1,
		(6.0 * s2 - 6.0 * s) * p0 + (3.0 * s2 - 4.0 * s + 1.0) * m0 + (6.0 * s - 6.0 * s2) * p1 + (3.0 * s2 - 2.0 * s) * m1);
}

vec2 lensMap(float rho, float mag) {
	float e = 1.0 - BEVEL;
	if (rho <= e) return vec2(rho / mag, 1.0 / mag);
	float s = min((rho - e) / BEVEL, 1.0);
	float p0 = e / mag;
	float m0 = BEVEL / mag;
	vec2 fold = vec2(p0 + m0 * (s - 0.5 * s * s / FOLD), m0 * (1.0 - s / FOLD));
	vec2 meet = hermite(s, p0, m0, 1.0, (1.0 - p0) * (1.0 + 1.8 * clamp(mag - 1.0, 0.0, 1.0)));
	vec2 h = mix(meet, fold, clamp(2.0 * (mag - 1.0), 0.0, 1.0));
	return vec2(h.x, h.y / BEVEL);
}

vec3 under(vec2 p, float foot) {
	return textureLod(uTex, (p - uBox.xy) / uBox.zw, log2(max(foot * uView.z, 1.0))).rgb;
}

float erfApprox(float x) {
	float a = abs(x);
	float r = 1.0 + (0.278393 + (0.230389 + 0.078108 * a * a) * a) * a;
	r *= r;
	return sign(x) * (1.0 - 1.0 / (r * r));
}

void main() {
	vec2 u = vec2(gl_FragCoord.x, uView.x - gl_FragCoord.y) / uView.y;
	float aa = 1.0 / uView.y;
	vec2 c = uLens.xy;
	float R = uLens.z;
	float mag = uLens.w;
	float op = uPop;
	vec2 q = u - c;
	float d = length(q);
	vec2 light = normalize(KEY.xy);

	float x = length(q + light * SHADOW_SHIFT * R) - R;
	float sh = SHADOW * op * (0.5 - 0.5 * erfApprox(x * 0.70710678 / (SHADOW_BLUR * R)));
	vec4 frame = vec4(0.0, 0.0, 0.0, 1.0 - (1.0 - DIM * op) * (1.0 - sh));

	float cv = clamp(0.5 - (d - R) / (4.0 * aa), 0.0, 1.0);
	if (cv <= 0.0) {
		color = frame;
		return;
	}
	float rho = min(d / R, 1.0);
	vec2 dir = q / max(d, 1e-6);
	vec2 m = lensMap(rho, mag);
	float shown = m.x / max(rho, 1e-4);
	float s = clamp((rho - (1.0 - BEVEL)) / BEVEL, 0.0, 1.0);
	float glass = clamp(mag - 1.0, 0.0, 1.0);
	float foot = max(aa * max(abs(m.y), shown), DEFOCUS * R * s * s * glass);
	vec2 at = c + q * shown;
	vec3 col = under(at, foot);
	if (s > 0.0) {
		float sp = DISPERSION * (rho / mag - m.x) * glass;
		float r = (m.x + sp) / max(rho, 1e-4);
		float b = (m.x - sp) / max(rho, 1e-4);
		col = vec3(under(c + q * r, foot).r, col.g, under(c + q * b, foot).b);
	}
	float frosted = FROST * pow(smoothstep(0.3, 1.0, s), 1.3) * glass;
	if (frosted > 0.0) {
		float r = FROST_R * R / mag;
		vec3 e = vec3(0.0);
		for (int k = 0; k < FROST_TAPS; k++) {
			float a = float(k) * 2.39996323;
			e += under(at + vec2(cos(a), sin(a)) * sqrt((float(k) + 0.5) / float(FROST_TAPS)) * r, 0.6 * r);
		}
		col = mix(col, e / float(FROST_TAPS), frosted);
	}

	float tilt = 1.5 * pow(s, 2.4);
	vec3 n = vec3(dir * sin(tilt), cos(tilt));
	float fres = 0.04 + 0.96 * pow(1.0 - n.z, 5.0);
	vec3 env = mix(vec3(1.0), vec3(0.55, 0.58, 0.64), smoothstep(-0.7, 0.9, dir.y));
	float toward = dot(dir, light);
	float rim = smoothstep(1.0 - 1.2 * BEVEL, 1.0, rho);
	float px = (R - d) / aa;
	vec3 g = col * (1.0 - rim * mix(0.06, 0.02, 0.5 + 0.5 * toward));
	g = mix(g, env, fres * 0.15);
	g += vec3(0.22 * max(toward, 0.0)) * (1.0 - smoothstep(0.0, 1.5, px));
	col = mix(col, g, op);
	float k = cv * (1.0 - 0.25 * smoothstep(0.985 * R, R, d) * glass * op);
	color = vec4(col * k, k) + frame * (1.0 - k);
}`;

const heat = new WeakMap<Element, { color: string; born: number; shift: number }>();

function line(text: string, hot: string | null, shift: number): HTMLElement {
	const element = document.createElement('div');
	element.className = 'line';
	let at = 0;
	for (const match of text.matchAll(TOKEN)) {
		if (match.index > at) element.append(text.slice(at, match.index));
		const span = document.createElement('span');
		span.className = Object.keys(match.groups ?? {}).find((name) => match.groups?.[name]) ?? '';
		span.textContent = match[0];
		element.append(span);
		at = match.index + match[0].length;
	}
	element.append(text.slice(at));
	if (hot) {
		element.classList.add('hot');
		element.style.setProperty('--hot', hot);
		element.style.marginLeft = `${shift}px`;
		heat.set(element, { color: hot, born: performance.now(), shift });
	}
	return element;
}

function program(gl: WebGL2RenderingContext): WebGLProgram | null {
	const linked = gl.createProgram();
	for (const [type, source] of [
		[gl.VERTEX_SHADER, VERT],
		[gl.FRAGMENT_SHADER, FRAG],
	] as const) {
		const shader = gl.createShader(type);
		if (!shader) return null;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		gl.attachShader(linked, shader);
	}
	gl.linkProgram(linked);
	return gl.getProgramParameter(linked, gl.LINK_STATUS) ? linked : null;
}

const smooth = (t: number): number => {
	const k = Math.min(Math.max(t, 0), 1);
	return k * k * (3 - 2 * k);
};

const pop = (t: number): number => 1 - (1 + 30 * t) * Math.exp(-30 * t);

const hole = (x: number, y: number, r: number): string =>
	`radial-gradient(circle at ${x.toFixed(1)}px ${y.toFixed(1)}px, transparent ${Math.max(0, r - SOFT).toFixed(1)}px, #000 ${r.toFixed(1)}px)`;

export function playLoupe(parts: LoupeParts): () => void {
	const { stage, glass, lens, canvas, uses } = parts;
	const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
	const cleanup: (() => void)[] = [];
	const listen = <K extends keyof HTMLElementEventMap>(
		type: K,
		handler: (event: HTMLElementEventMap[K]) => void,
	): void => {
		stage.addEventListener(type, handler);
		cleanup.push(() => stage.removeEventListener(type, handler));
	};

	const cols: Col[] = parts.cols.map((box, index) => {
		const feed = box.firstElementChild;
		if (!(feed instanceof HTMLElement)) throw new Error('a loupe column needs its feed');
		return {
			box,
			feed,
			pool: parts.pools[index] ?? [],
			speed: SPEED[index % SPEED.length] ?? 9,
			at: index * 3,
			queue: [],
			y: 0,
			boost: 0,
			wait: -1,
			owed: 0,
			mark: 0,
		};
	});
	const next = (col: Col): Queued =>
		col.queue.shift() ?? [col.pool[col.at++ % col.pool.length] ?? '', null, 0];
	for (const col of cols) col.feed.replaceChildren();

	let R = 160;
	let MAG = 1.6;
	let w = 0;
	let h = 0;
	let dpr = 1;
	let boxes: Box[] = [];
	let current = -1;
	let focus: Focus | null = null;
	let held: Point | null = null;

	const tex = document.createElement('canvas');
	const ctx = tex.getContext('2d');
	let gl = canvas.getContext('webgl2', {
		antialias: false,
		depth: false,
		stencil: false,
		premultipliedAlpha: true,
	});
	const linked = gl ? program(gl) : null;
	const slot: Partial<Record<'uLens' | 'uBox' | 'uView' | 'uPop', WebGLUniformLocation | null>> =
		{};
	if (gl && linked && ctx) {
		gl.useProgram(linked);
		for (const name of ['uLens', 'uBox', 'uView', 'uPop'] as const) {
			slot[name] = gl.getUniformLocation(linked, name);
		}
		gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		stage.dataset.webgl = '';
		const lost = (): void => {
			gl = null;
			delete stage.dataset.webgl;
		};
		canvas.addEventListener('webglcontextlost', lost);
		cleanup.push(() => canvas.removeEventListener('webglcontextlost', lost));
	} else gl = null;

	const fit = (): void => {
		w = stage.clientWidth;
		h = stage.clientHeight;
		R = Math.round(Math.min(160, Math.max(128, w * 0.14)));
		MAG = 1.4 + (0.2 * (R - 128)) / 32;
		stage.style.setProperty('--loupe', `${R * 2}px`);
		dpr = Math.min(devicePixelRatio || 1, 2);
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		tex.width = tex.height = Math.ceil(2.5 * R * dpr * MAG);
		const rows = Math.ceil(h / ROW) + 2;
		for (const col of cols) {
			while (col.feed.children.length < rows) col.feed.append(line(...next(col)));
			while (col.feed.children.length > rows) col.feed.lastElementChild?.remove();
		}
		const left = stage.getBoundingClientRect().left;
		boxes = cols.map(({ box }) => {
			const rect = box.getBoundingClientRect();
			const style = getComputedStyle(box);
			return {
				x: rect.left - left,
				w: rect.width,
				pad: parseFloat(style.paddingLeft),
				fade: style.maskImage !== 'none',
				rule: style.boxShadow !== 'none',
			};
		});
	};

	const looks = new Map<string, Look>();
	const look = (element: Element): Look => {
		let style = looks.get(element.className);
		if (!style) {
			const computed = getComputedStyle(element);
			style = {
				color: computed.color,
				spacing: computed.letterSpacing === 'normal' ? '0px' : computed.letterSpacing,
			};
			looks.set(element.className, style);
		}
		return style;
	};

	const paintMess = (ox: number, oy: number, size: number, scale: number): void => {
		if (!ctx) return;
		const now = performance.now();
		const font = `400 11px ${getComputedStyle(cols[0]?.box ?? stage).fontFamily}`;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, tex.width, tex.height);
		ctx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
		ctx.font = font;
		const metrics = ctx.measureText('M');
		const base =
			(ROW - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 +
			metrics.fontBoundingBoxAscent;
		cols.forEach((col, index) => {
			const box = boxes[index];
			if (!box || box.w === 0 || box.x > ox + size || box.x + box.w < ox) return;
			ctx.save();
			ctx.beginPath();
			ctx.rect(box.x, oy, box.w, size);
			ctx.clip();
			if (box.rule) {
				ctx.fillStyle = look(col.box).color;
				ctx.globalAlpha = 0.12;
				ctx.fillRect(box.x, oy, 1, size);
				ctx.globalAlpha = 1;
			}
			const rows = col.feed.children;
			for (let row = 0; row < rows.length; row++) {
				const y = row * ROW - col.y;
				const element = rows[row];
				if (!element || y + ROW < oy || y > oy + size) continue;
				const hot = heat.get(element);
				if (hot) {
					const t = Math.min((now - hot.born) / 2_400, 1);
					ctx.globalAlpha = still ? 0.6 : 0.42 + 0.58 * (1 - t) ** 2;
					const glow = ctx.createLinearGradient(box.x, 0, box.x + box.w, 0);
					glow.addColorStop(0, `${hot.color}99`);
					glow.addColorStop(0.6, `${hot.color}38`);
					glow.addColorStop(1, `${hot.color}00`);
					ctx.fillStyle = glow;
					ctx.fillRect(box.x, y, box.w, ROW);
					ctx.fillStyle = hot.color;
					ctx.fillRect(box.x, y, 2, ROW);
					ctx.globalAlpha = 1;
				}
				let x = box.x + box.pad + (hot?.shift ?? 0);
				for (const node of element.childNodes) {
					const text = node.textContent ?? '';
					const style = look(node instanceof Element ? node : element);
					ctx.fillStyle = style.color;
					ctx.letterSpacing = style.spacing;
					ctx.fillText(text, x, y + base);
					x += ctx.measureText(text).width;
				}
			}
			if (box.fade) {
				const fade = ctx.createLinearGradient(box.x + box.w - 16, 0, box.x + box.w, 0);
				fade.addColorStop(0, 'rgb(0 0 0 / 0)');
				fade.addColorStop(1, '#000');
				ctx.globalCompositeOperation = 'destination-out';
				ctx.fillStyle = fade;
				ctx.fillRect(box.x + box.w - 16, oy, 16, size);
			}
			ctx.restore();
		});
		ctx.globalCompositeOperation = 'destination-over';
		ctx.fillStyle = getComputedStyle(stage).backgroundColor;
		ctx.fillRect(ox, oy, size, size);
		ctx.globalCompositeOperation = 'source-over';
	};

	let pos: Point = { x: 0, y: 0 };

	const drawLoupe = (op: number): void => {
		if (!gl) return;
		const scale = dpr * MAG;
		const size = tex.width / scale;
		const ox = Math.floor((pos.x - size / 2) * scale) / scale;
		const oy = Math.floor((pos.y - size / 2) * scale) / scale;
		paintMess(ox, oy, size, scale);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);
		gl.generateMipmap(gl.TEXTURE_2D);
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.uniform4f(slot.uLens ?? null, pos.x, pos.y, R, 1 + (MAG - 1) * op);
		gl.uniform4f(slot.uBox ?? null, ox, oy, size, size);
		gl.uniform3f(slot.uView ?? null, canvas.height, canvas.width / w, scale);
		gl.uniform1f(slot.uPop ?? null, op);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	};

	let clock = 0;

	const paint = (): void => {
		glass.style.maskImage = hole(pos.x, pos.y, R);
		lens.style.translate = `${(pos.x - R).toFixed(1)}px ${(pos.y - R).toFixed(1)}px`;
		drawLoupe(still ? 1 : pop(clock / 1_000));
	};

	const span = (use: Use): number => {
		if (!ctx) return 0;
		ctx.font = `400 11px ${getComputedStyle(cols[0]?.box ?? stage).fontFamily}`;
		return Math.max(...use.lines.map((text) => ctx.measureText(text).width));
	};

	const place = (col: Col): number => {
		const box = boxes[cols.indexOf(col)];
		return Math.min(Math.max(box ? box.x + box.w / 2 : w / 2, R), w - R);
	};

	const shiftOf = (col: Col, use: Use): number => {
		const box = boxes[cols.indexOf(col)];
		return box ? Math.max(0, place(col) - box.x - box.pad - span(use) / 2) : 0;
	};

	const spot = (col: Col, at: number): Point => ({
		x: place(col),
		y: Math.min(Math.max(at, R), h - R),
	});

	const drift = (t: number): Point => ({
		x: w * (0.5 + 0.3 * Math.sin(t / 5_600 - 1.1)),
		y: h * (0.5 + 0.24 * Math.sin(t / 4_100 + 0.5)),
	});

	const target = (): Point => {
		if (focus?.line.isConnected) {
			const index = Array.prototype.indexOf.call(focus.col.feed.children, focus.line);
			const middle = index * ROW - focus.col.y + (focus.count * ROW) / 2;
			held = spot(focus.col, Math.min(middle, focus.to));
		}
		return held ?? drift(clock + LEAD);
	};

	const show = (index: number): void => {
		const use = uses[index];
		const col = use ? cols[use.col] : undefined;
		if (!use || !col) return;
		current = index;
		const shift = shiftOf(col, use);
		col.queue.unshift(...use.lines.map((text): Queued => [text, use.color, shift]));
		col.mark = use.lines.length;
		col.wait = 0;
		col.owed = Math.max(
			0,
			col.feed.children.length * ROW - col.y - h * use.at + (use.lines.length * ROW) / 2,
		);
		focus = null;
	};

	const refit = (): void => {
		fit();
		paint();
	};
	const observer = new ResizeObserver(refit);
	observer.observe(stage);
	document.fonts.addEventListener('loadingdone', refit);
	cleanup.push(() => {
		observer.disconnect();
		document.fonts.removeEventListener('loadingdone', refit);
	});
	fit();

	const rest = uses[parts.resting];
	const restCol = rest ? cols[rest.col] : undefined;
	if (still || !rest || !restCol) {
		if (rest && restCol) {
			const rows = restCol.feed.children;
			const at = Math.round((h * rest.at) / ROW);
			const shift = shiftOf(restCol, rest);
			rest.lines.forEach((text, offset) =>
				rows[at + offset]?.replaceWith(line(text, rest.color, shift)),
			);
			pos = spot(restCol, (at + rest.lines.length / 2) * ROW);
		} else pos = { x: w / 2, y: h / 2 };
		paint();
		const follow = (event: PointerEvent): void => {
			const box = stage.getBoundingClientRect();
			pos = { x: event.clientX - box.left, y: event.clientY - box.top };
			paint();
		};
		listen('pointermove', follow);
		return () => {
			for (const stop of cleanup) stop();
		};
	}

	let pointer: Point | null = null;
	let seen: Point | null = null;
	let flick: Point = { x: 0, y: 0 };
	let caught = false;
	let left: (Point & { at: number }) | null = null;
	const vel: Point = { x: 0, y: 0 };
	pos = drift(0);

	const follow = (dt: number): void => {
		let aim: Point;
		if (pointer) {
			if (seen) {
				const k = 1 - Math.exp(-dt / 40);
				flick.x += ((pointer.x - seen.x) / dt - flick.x) * k;
				flick.y += ((pointer.y - seen.y) / dt - flick.y) * k;
			}
			seen = pointer;
			aim = { x: pointer.x + flick.x * LEAD, y: pointer.y + flick.y * LEAD };
		} else {
			seen = null;
			flick = { x: 0, y: 0 };
			const path = target();
			const k = left ? smooth((clock - left.at) / 1_800) : 1;
			aim = left ? { x: left.x + (path.x - left.x) * k, y: left.y + (path.y - left.y) * k } : path;
		}
		for (let remaining = dt / 1_000; remaining > 0; remaining -= 1 / 240) {
			const step = Math.min(remaining, 1 / 240);
			vel.x += (STIFF * (aim.x - pos.x) - DAMP * vel.x) * step;
			vel.y += (STIFF * (aim.y - pos.y) - DAMP * vel.y) * step;
			pos.x += vel.x * step;
			pos.y += vel.y * step;
		}
		if (!pointer) return;
		const dx = pos.x - pointer.x;
		const dy = pos.y - pointer.y;
		const d = Math.hypot(dx, dy);
		const wall = WALL * R;
		caught ||= d <= wall;
		if (caught && d > wall) {
			pos.x = pointer.x + (dx * wall) / d;
			pos.y = pointer.y + (dy * wall) / d;
		}
	};

	listen('pointermove', (event) => {
		const box = stage.getBoundingClientRect();
		pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
		left = null;
	});
	listen('pointerleave', () => {
		pointer = null;
		caught = false;
		left = { at: clock, x: pos.x, y: pos.y };
	});

	let switchAt = EVERY;
	listen('click', () => {
		switchAt = clock + EVERY;
		show((current + 1) % uses.length);
	});

	let last = 0;
	let frame = 0;
	const tick = (now: number): void => {
		const dt = last ? Math.min(now - last, 50) : 16;
		last = now;
		clock += dt;

		if (clock >= switchAt) {
			switchAt += EVERY;
			show((current + 1) % uses.length);
		}

		const use = uses[current];
		for (const col of cols) {
			if (col.wait >= 0) {
				col.wait -= dt;
				if (col.wait < 0) col.boost += col.owed / (SEEK / 1_000);
			}
			col.boost *= Math.exp(-dt / SEEK);
			col.y += ((col.speed + col.boost) * dt) / 1_000;
			while (col.y >= ROW) {
				col.y -= ROW;
				col.feed.firstElementChild?.remove();
				const added = line(...next(col));
				col.feed.append(added);
				if (col.mark > 0 && heat.has(added)) {
					if (use && col.mark === use.lines.length && cols[use.col] === col) {
						focus = {
							col,
							line: added,
							count: col.mark,
							to: h * use.at + (use.lines.length * ROW) / 2,
						};
					}
					col.mark--;
				}
			}
			col.feed.style.translate = `0 ${(-col.y).toFixed(2)}px`;
		}

		follow(dt);
		paint();
		frame = requestAnimationFrame(tick);
	};

	show(0);
	paint();
	const watch = new IntersectionObserver(([entry]) => {
		if (entry?.isIntersecting && !frame) {
			last = 0;
			frame = requestAnimationFrame(tick);
		} else if (!entry?.isIntersecting && frame) {
			cancelAnimationFrame(frame);
			frame = 0;
		}
	});
	watch.observe(stage);
	cleanup.push(() => {
		watch.disconnect();
		cancelAnimationFrame(frame);
	});
	return () => {
		for (const stop of cleanup) stop();
	};
}
