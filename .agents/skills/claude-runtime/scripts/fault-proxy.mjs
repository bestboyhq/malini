import http from 'node:http';
import https from 'node:https';

const port = Number(process.env.PORT ?? 8787);
const faultKind = process.env.FAULT_KIND ?? 'thinking_delta';
const faultAfterDeltas = Number(process.env.FAULT_AFTER_DELTAS ?? 2);
const faultMode = process.env.FAULT_MODE ?? 'overloaded';
const unjudgedResponses =
	process.env.FAULT_RESPONSES === 'all' ? Infinity : Number(process.env.FAULT_RESPONSES ?? 1);
const OVERLOADED =
	'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
let cut = false;
let unjudged = 0;

function withoutVerdicts(event) {
	const line = event.split('\n').find((candidate) => candidate.startsWith('data: '));
	if (!line?.includes('"safeguard_results"') || unjudged >= unjudgedResponses) return event;
	const message = JSON.parse(line.slice('data: '.length));
	let calls = 0;
	for (const { status } of message.delta?.safeguard_results ?? []) {
		if (status?.type !== 'available') continue;
		for (const id of Object.keys(status.tool_uses)) {
			status.tool_uses[id] = { type: 'unavailable', reason: 'error' };
			calls += 1;
		}
	}
	if (calls === 0) return event;
	unjudged += 1;
	console.error(`dropped the verdicts of ${calls} call(s), response ${unjudged}`);
	return event.replace(line, `data: ${JSON.stringify(message)}`);
}

function forwardWithoutVerdicts(reply, response) {
	let pending = '';
	reply.setEncoding('utf8');
	reply.on('data', (text) => {
		pending += text;
		const events = pending.split('\n\n');
		pending = events.pop() ?? '';
		for (const event of events) response.write(`${withoutVerdicts(event)}\n\n`);
	});
	reply.on('end', () => response.end(pending));
}

http
	.createServer((request, response) => {
		const chunks = [];
		request.on('data', (chunk) => chunks.push(chunk));
		request.on('end', () => {
			const body = Buffer.concat(chunks);
			const headers = { ...request.headers, host: 'api.anthropic.com' };
			delete headers['accept-encoding'];
			const streaming = request.url.startsWith('/v1/messages') && body.includes('"stream":true');
			const upstream = https.request(
				{ host: 'api.anthropic.com', path: request.url, method: request.method, headers },
				(reply) => {
					response.writeHead(reply.statusCode, reply.headers);
					if (faultKind === 'verdict') {
						forwardWithoutVerdicts(reply, response);
						return;
					}
					let deltas = 0;
					let cutHere = false;
					reply.on('data', (data) => {
						if (cutHere) return;
						response.write(data);
						if (!streaming || cut) return;
						deltas += data.toString().split(`"type":"${faultKind}"`).length - 1;
						if (deltas < faultAfterDeltas) return;
						cut = cutHere = true;
						console.error(`cut ${request.url} after ${deltas} ${faultKind} (${faultMode})`);
						reply.destroy();
						if (faultMode === 'drop') response.socket.destroy();
						else response.end(OVERLOADED);
					});
					reply.on('end', () => !cutHere && response.end());
				},
			);
			upstream.on('error', () => response.destroy());
			upstream.end(body);
		});
	})
	.listen(port, '127.0.0.1', () => console.error(`fault proxy on ${port}`));
