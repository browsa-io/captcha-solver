// What the end-to-end suite runs the extension against, all on this machine:
//   site   the fixture pages (test/fixtures) as http://<anything>.test/, with a fresh random captcha picture per
//          request and its own "server verdict" (/check answers Correct! only for the right text)
//   api    a stand-in for the captcha API, answering in the live API's shapes (cost block, taskId, fix, charged,
//          the trial block in getBalance, reportIncorrect); every request is kept for the tests to read
//   proxy  the browser's only way out: every request of the browser (pages, the extension, the browser itself)
//          passes here and is written down with its host. *.test goes to the site, 127.0.0.1 to the api, everything
//          else is refused, so nothing in a test run reaches the internet.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(path.dirname(here), 'fixtures');
export const ANSWER = 'AB12C';
export const MARK = 'SECRET-MARKER';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
/** A w x h grey-noise PNG: different bytes every call, so every page load shows a "new" captcha picture. */
export function noisePng(w = 140, h = 48) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; crypto.randomFillSync(raw, y * (w + 1) + 1, w); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// a browser that closes cuts its connections: that is not an error of the test
const quiet = (server) => { server.on('connection', (s) => s.on('error', () => undefined)); server.on('clientError', (_e, s) => s.destroy()); return server; };
const listen = (server) => new Promise((resolve) => quiet(server).listen(0, '127.0.0.1', () => resolve(server.address().port)));
const read = (req) => new Promise((resolve) => { const b = []; req.on('data', (d) => b.push(d)); req.on('end', () => resolve(Buffer.concat(b).toString('utf8'))); });

export async function startSite() {
  const logo = noisePng(60, 40);
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra }); res.end(body); };
    if (u.pathname === '/captcha.png' || u.pathname === '/pic.png') return send(200, 'image/png', noisePng());
    if (u.pathname === '/logo.png') return send(200, 'image/png', logo);
    if (u.pathname === '/captcha-logo.svg') return send(200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#888"/></svg>');
    if (u.pathname === '/check') return send(200, 'text/plain', (await read(req)).trim() === ANSWER ? 'Correct!' : 'Incorrect!');
    const file = path.join(FIXTURES, path.basename(u.pathname));
    if (u.pathname.endsWith('.html') && fs.existsSync(file)) {
      // things a solve must never carry away: a cookie, a form value, page text (and the address's path and query)
      const html = fs.readFileSync(file, 'utf8').replace('</body>',
        `<p id="private">${MARK}-TEXT</p><input type="hidden" name="csrf" value="${MARK}-FORM"></body>`);
      return send(200, 'text/html; charset=utf-8', html, { 'Set-Cookie': `session=${MARK}-COOKIE; Path=/` });
    }
    send(404, 'text/plain', 'not found');
  });
  return { server, port: await listen(server), close: () => server.close() };
}

/** The API stand-in. `next` is a queue of scripted answers for createTask (an object, or 'drop' to cut the
 * connection once; `down` cuts every connection while it is set); with nothing queued a picture task is solved. `trial` (when set) is reported by getBalance. */
export async function startApi() {
  const state = { requests: [], next: [], down: false, trial: null, balance: 100, price: 0.004, tasks: new Map(), reports: [], keyOk: (k) => /^agt_live_/.test(k) };
  const err = (errorCode, errorDescription, fix) => ({ errorId: 1, errorCode, errorDescription: `${errorDescription}. ${fix} You were not charged.`, fix, charged: false });
  const server = http.createServer(async (req, res) => {
    const raw = await read(req);
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
    state.requests.push({ at: Date.now(), method: req.method, path: req.url, headers: req.headers, raw, body });
    if (state.down) { req.socket.destroy(); return; }       // the service cannot be reached
    const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (!state.keyOk(String(body.clientKey || ''))) {
      return send(err('ERROR_KEY_DENIED_ACCESS', 'clientKey is missing or invalid', 'Send your Browsa API key (agt_live_...) as clientKey; the description says which rule refused it.'));
    }
    if (req.url === '/getBalance') {
      return send({ errorId: 0, errorCode: '', errorDescription: '', balance: state.balance, unit: 'credits', ...(state.trial ? { trial: { ...state.trial, left: state.trial.total - state.trial.used } } : {}) });
    }
    if (req.url === '/createTask') {
      const scripted = state.next.shift();
      if (scripted === 'drop') { req.socket.destroy(); return; }
      if (scripted) return send(scripted);
      const taskId = crypto.randomUUID();
      state.tasks.set(taskId, { type: body.task?.type });
      if (state.trial) { state.trial.used++; state.trial.usedToday++; }
      state.balance = Math.round((state.balance - state.price) * 1000) / 1000;
      return send({ errorId: 0, errorCode: '', errorDescription: '', taskId, status: 'ready', solution: { text: ANSWER }, solveSeconds: 0.4,
        cost: { charged: true, amount: state.price, unit: 'credits', credits: state.price, note: 'Charged once, for this solve.' } });
    }
    if (req.url === '/reportIncorrect') {
      const t = state.tasks.get(body.taskId);
      if (!t) return send(err('ERROR_TASKID_INVALID', 'no such task', 'Send the taskId createTask returned, with the same key, within 10 minutes of the solve.'));
      if (t.reported) return send(err('ERROR_ALREADY_REPORTED', 'this solve was already reported', 'Nothing to do: the first report stands, and a refund is made only once.'));
      t.reported = true;
      state.reports.push(body.taskId);
      state.balance = Math.round((state.balance + state.price) * 1000) / 1000;
      return send({ errorId: 0, status: 'success', outcome: 'incorrect', refunded: true, refund: { amount: state.price, unit: 'credits' },
        message: `Recorded. ${state.price} credits were given back for this solve.` });
    }
    send(err('ERROR_BAD_REQUEST', 'unknown method', 'Send a POST with a JSON object as the body to one of the documented methods.'));
  });
  const port = await listen(server);
  return { server, port, state, err, base: `http://127.0.0.1:${port}`, close: () => server.close(),
    calls: (p = '/createTask') => state.requests.filter((r) => r.path === p) };
}

/** The recording proxy. `seen` gets one row per request: { host, port, method, url, kind: 'site' | 'api' | 'refused' }. */
export async function startProxy(sitePort, apiPort) {
  const seen = [];
  const route = (host, port) => (/\.test$/.test(host) ? { kind: 'site', port: sitePort } : (host === '127.0.0.1' && Number(port) === apiPort) ? { kind: 'api', port: apiPort } : null);
  const server = http.createServer((req, res) => {
    let u;
    try { u = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
    const r = route(u.hostname, u.port || 80);
    seen.push({ at: Date.now(), host: u.hostname, port: u.port || '80', method: req.method, url: req.url, kind: r ? r.kind : 'refused' });
    if (!r) { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('refused by the test proxy'); return; }
    const up = http.request({ host: '127.0.0.1', port: r.port, method: req.method, path: u.pathname + u.search, headers: { ...req.headers, host: u.host } }, (ur) => {
      res.writeHead(ur.statusCode || 502, ur.headers);
      ur.pipe(res);
    });
    up.on('error', () => { res.destroy(); });
    req.on('error', () => up.destroy());
    res.on('error', () => up.destroy());
    req.pipe(up);
  });
  server.on('connect', (req, socket) => {                  // https: the host is written down, nothing is let out
    const [host, port] = String(req.url).split(':');
    seen.push({ at: Date.now(), host, port: port || '443', method: 'CONNECT', url: req.url, kind: 'refused' });
    socket.on('error', () => undefined);
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  const port = await listen(server);
  void net;
  return { server, port, seen, close: () => server.close() };
}
