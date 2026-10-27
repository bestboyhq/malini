import http from 'node:http';
import https from 'node:https';

const port = Number(process.env.PORT ?? 8787);
const faultKind = process.env.FAULT_KIND ?? 'thinking_delta';
const faultAfterDeltas = Number(process.env.FAULT_AFTER_DELTAS ?? 2);
const faultMode = process.env.FAULT_MODE ?? 'overloaded';
const faultStatus = Number(process.env.FAULT_STATUS ?? 529);
const faultBody =
	process.env.FAULT_BODY ??
	'{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
const faultHeaders = JSON.parse(process.env.FAULT_HEADERS ?? '{}');
let faultsLeft = Number(process.env.FAULT_COUNT ?? Number.POSITIVE_INFINITY);
const OVERLOADED =
	'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
let cut = false;

function answersMessages(request) {
	return new URL(request.url, 'http://proxy').pathname === '/v1/messages' && faultsLeft > 0;
}

function respond(request, response) {
	faultsLeft -= 1;
	console.error(`${faultMode} ${request.url} with ${faultStatus}`);
	if (faultMode === 'refuse') {
		response.socket.destroy();
		return;
	}
	response.writeHead(faultStatus, { 'content-type': 'application/json', ...faultHeaders });
	response.end(faultBody);
}

http
	.createServer((request, response) => {
		const chunks = [];
		request.on('data', (chunk) => chunks.push(chunk));
		request.on('end', () => {
			if ((faultMode === 'respond' || faultMode === 'refuse') && answersMessages(request)) {
				respond(request, response);
				return;
			}
			const body = Buffer.concat(chunks);
			const headers = { ...request.headers, host: 'api.anthropic.com' };
			delete headers['accept-encoding'];
			const streaming = request.url.startsWith('/v1/messages') && body.includes('"stream":true');
			const upstream = https.request(
				{ host: 'api.anthropic.com', path: request.url, method: request.method, headers },
				(reply) => {
					response.writeHead(reply.statusCode, reply.headers);
					let deltas = 0;
					let cutHere = false;
					reply.on('data', (data) => {
						if (cutHere) return;
						response.write(data);
						if (!streaming || cut || faultMode === 'respond' || faultMode === 'refuse') return;
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
