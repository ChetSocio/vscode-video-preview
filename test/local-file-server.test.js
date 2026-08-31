const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LocalFileServer } = require('../out/LocalFileServer');

async function withServer(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-preview-test-'));
  const filePath = path.join(dir, 'sample.mp4');
  fs.writeFileSync(filePath, Buffer.from('0123456789'));

  const server = new LocalFileServer();
  await server.start();
  const token = server.register(filePath);

  try {
    await run(server.url(token));
  } finally {
    server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('serves the complete file without a range header', async () => {
  await withServer(async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('content-length'), '10');
    assert.equal(await response.text(), '0123456789');
  });
});

test('serves explicit, open-ended and suffix byte ranges', async () => {
  await withServer(async (url) => {
    const explicit = await fetch(url, { headers: { Range: 'bytes=2-5' } });
    assert.equal(explicit.status, 206);
    assert.equal(explicit.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await explicit.text(), '2345');

    const openEnded = await fetch(url, { headers: { Range: 'bytes=7-' } });
    assert.equal(openEnded.status, 206);
    assert.equal(openEnded.headers.get('content-range'), 'bytes 7-9/10');
    assert.equal(await openEnded.text(), '789');

    const suffix = await fetch(url, { headers: { Range: 'bytes=-3' } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get('content-range'), 'bytes 7-9/10');
    assert.equal(await suffix.text(), '789');
  });
});

test('clamps range ends and rejects invalid ranges', async () => {
  await withServer(async (url) => {
    const clamped = await fetch(url, { headers: { Range: 'bytes=8-999' } });
    assert.equal(clamped.status, 206);
    assert.equal(clamped.headers.get('content-range'), 'bytes 8-9/10');
    assert.equal(await clamped.text(), '89');

    const invalid = await fetch(url, { headers: { Range: 'bytes=20-' } });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('content-range'), 'bytes */10');
  });
});

test('supports HEAD without sending a body', async () => {
  await withServer(async (url) => {
    const response = await fetch(url, { method: 'HEAD' });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-length'), '10');
    assert.equal(await response.text(), '');
  });
});
