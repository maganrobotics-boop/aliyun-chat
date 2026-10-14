import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { createSubtitleService } from './service.mjs';

const config = { baseUrl: 'https://dashscope.aliyuncs.com', apiKey: 'sk-synthetic-transport' };
async function serverFor(t, upgrade) {
  const server = http.createServer();
  if (upgrade) server.on('upgrade', upgrade);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `ws://127.0.0.1:${server.address().port}`;
  // Test-only loopback adapter; production's endpoint allowlist stays unchanged.
  class LoopbackSocket extends WebSocket { constructor(_url, options) { super(endpoint, options); } }
  return { server, LoopbackSocket };
}

for (const status of [401, 403, 429, 500]) {
  test(`real ws HTTP ${status} rejection closes the connection with a safe error`, async t => {
    let attempts = 0;
    const { LoopbackSocket } = await serverFor(t, (request, socket) => {
      attempts++; assert.equal(request.headers.authorization, `Bearer ${config.apiKey}`);
      const privateBody = 'provider-private-response';
      socket.end(`HTTP/1.1 ${status} Rejected\r\nContent-Length: ${privateBody.length}\r\nConnection: close\r\n\r\n${privateBody}`);
    });
    const service = createSubtitleService({ WebSocket: LoopbackSocket, connectTimeoutMs: 1500 });
    try {
      for (let i = 0; i < 2; i++) await assert.rejects(
        service.start('test', config, { direction: 'ja-zh', saveRecording: false }),
        error => error.status === (status === 500 ? 502 : 503) && !error.message.includes('provider-private'));
      assert.equal(attempts, 2);
    } finally { await service.close(); }
  });
}

test('real ws authenticates/configures both directions and acknowledges graceful finish', async t => {
  const { server, LoopbackSocket } = await serverFor(t);
  const wss = new WebSocketServer({ server });
  const languages = [];
  wss.on('connection', (socket, request) => {
    assert.equal(request.headers.authorization, `Bearer ${config.apiKey}`);
    socket.on('message', raw => {
      const event = JSON.parse(raw);
      if (event.type === 'session.update') {
        languages.push(event.session.translation.language);
        socket.send(JSON.stringify({ type: 'session.updated' }));
      } else if (event.type === 'session.finish') socket.send(JSON.stringify({ type: 'session.finished' }));
      else assert.fail('Authentication check must not send audio');
    });
  });
  const service = createSubtitleService({ WebSocket: LoopbackSocket, connectTimeoutMs: 1500 });
  try {
    for (const direction of ['ja-zh', 'zh-ja']) {
      const session = await service.start('test', config, { direction, saveRecording: false });
      service.finish('test', session.id);
      const events = (await service.events('test', session.id, 0).text()).trim().split('\n').map(JSON.parse);
      assert.equal(events.at(-1).reason, 'finished');
    }
    assert.deepEqual(languages, ['zh', 'ja']);
  } finally { await service.close(); for (const client of wss.clients) client.terminate(); await new Promise(resolve => wss.close(resolve)); }
});
