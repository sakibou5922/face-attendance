// face.js のカメラ制御（CDN の face-api は loadModels 内で動的 import するので、ここでは読み込まれない）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startCamera, stopCamera } from '../js/face.js';

function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track] };
}

function fakeVideo({ playRejects = null } = {}) {
  return {
    srcObject: null,
    async play() { if (playRejects) throw playRejects(); },
  };
}

// getUserMedia を呼ぶたびに新しいストリームを返し、resolve のタイミングをテストから制御する
let pending = [];
beforeEach(() => {
  pending = [];
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: () => new Promise((resolve) => {
        const stream = fakeStream();
        pending.push(() => { resolve(stream); return stream; });
      }),
    },
  });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

test('stopCamera: その video のストリームを止めて外す', async () => {
  const video = fakeVideo();
  const started = startCamera(video);
  await tick();
  const stream = pending[0]();
  await started;
  assert.equal(video.srcObject, stream);
  stopCamera(video);
  assert.equal(stream.track.stopped, true);
  assert.equal(video.srcObject, null);
});

test('startCamera: カメラ準備中にキャンセルされたら、届いたストリームをすぐ止めて CancelledError', async () => {
  const video = fakeVideo();
  let stale = false;
  const started = startCamera(video, () => stale);
  await tick();
  stale = true;
  const stream = pending[0]();
  await assert.rejects(started, { name: 'CancelledError' });
  assert.equal(stream.track.stopped, true);
  assert.equal(video.srcObject, null);
});

test('startCamera: play() 中に中断されてもキャンセル扱い（予期しないエラーにしない）', async () => {
  let stale = false;
  const video = fakeVideo({ playRejects: () => { stale = true; return Object.assign(new Error('aborted'), { name: 'AbortError' }); } });
  const started = startCamera(video, () => stale);
  await tick();
  const stream = pending[0]();
  await assert.rejects(started, { name: 'CancelledError' });
  assert.equal(stream.track.stopped, true);
});

test('startCamera: 別々の video のカメラは互いに止め合わない', async () => {
  const a = fakeVideo();
  const b = fakeVideo();
  const startedA = startCamera(a);
  const startedB = startCamera(b);
  await tick();
  const streamA = pending[0]();
  const streamB = pending[1]();
  await Promise.all([startedA, startedB]);
  stopCamera(a);
  assert.equal(streamA.track.stopped, true);
  assert.equal(streamB.track.stopped, false);
  stopCamera(b);
  assert.equal(streamB.track.stopped, true);
});
