// カメラ・顔の特徴量抽出（ブラウザ専用）。製品版で別方式に差し替える場合はこのファイルを置き換える
import { pickLargestFace } from './match.js';
import { namedError } from './errors.js';

const FACE_API_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js';
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';

let faceapi = null;
let modelsPromise = null;

/** face-api 本体とモデルを読み込む（1回だけ。失敗したら次回呼び出しで再試行） */
export function loadModels() {
  modelsPromise ??= (async () => {
    const api = await import(FACE_API_URL);
    await api.tf.ready();
    await Promise.all([
      api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    faceapi = api;
  })().catch((err) => {
    modelsPromise = null;
    throw namedError('ModelLoadError', String(err));
  });
  return modelsPromise;
}

const stopTracks = (stream) => stream?.getTracks().forEach((track) => track.stop());

/**
 * video にカメラ映像を流す。isStale() が true を返したら（待っている間にキャンセルされたら）
 * 届いたストリームをすぐ止めて CancelledError を投げる。
 * ストリームは video ごとに持つので、別の画面のカメラを止めてしまうことはない。
 */
export async function startCamera(videoEl, isStale = () => false) {
  if (!navigator.mediaDevices?.getUserMedia) throw namedError('InsecureContextError');
  stopCamera(videoEl);
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  if (isStale()) {
    stopTracks(stream);
    throw namedError('CancelledError');
  }
  videoEl.srcObject = stream;
  try {
    await videoEl.play();
  } catch (err) {
    if (!isStale()) throw err;
  }
  if (isStale()) {
    stopTracks(stream);
    if (videoEl.srcObject === stream) videoEl.srcObject = null;
    throw namedError('CancelledError');
  }
}

export function stopCamera(videoEl) {
  if (!videoEl) return;
  stopTracks(videoEl.srcObject);
  videoEl.srcObject = null;
}

/** 映像から一番大きい顔の特徴量（128次元）を返す。顔がなければ null */
export async function detectDescriptor(videoEl) {
  await loadModels();
  const results = await faceapi
    .detectAllFaces(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  const face = pickLargestFace(results);
  return face ? Array.from(face.descriptor) : null;
}
