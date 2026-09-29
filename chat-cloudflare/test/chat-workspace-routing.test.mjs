import test from 'node:test';
import assert from 'node:assert/strict';
import { routeStaticRequest } from '../src/static-router.mjs';

async function assetFor(path, method = 'GET') {
  const paths = [];
  const env = { ASSETS: { fetch: async request => {
    paths.push(new URL(request.url).pathname);
    return new Response('<html>fixture</html>', { headers: { 'content-type': 'text/html' } });
  } } };
  const response = await routeStaticRequest(new Request('https://chat.omindos.cn' + path, { method }), env);
  return { paths, response };
}
test('homepage and release checks open the four-tab workspace', async () => {
  for (const path of ['/', '/?release=20260927-r2', '/newbie-village']) {
    const result = await assetFor(path);
    assert.deepEqual(result.paths, ['/newbie-village.html']);
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
  }
});
test('original assistant and management routes remain intact', async () => {
  for (const path of ['/?ta=1', '/?ta=1&course=python', '/manage']) {
    assert.deepEqual((await assetFor(path)).paths, ['/index.html']);
  }
});
test('workspace HTML rejects mutation requests', async () => {
  const { response, paths } = await assetFor('/', 'POST');
  assert.equal(response.status, 405);
  assert.equal(paths.length, 0);
});
