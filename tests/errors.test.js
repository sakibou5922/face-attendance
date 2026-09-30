import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage, namedError } from '../js/errors.js';

test('namedError: name が設定される', () => {
  const err = namedError('ModelLoadError', 'x');
  assert.equal(err.name, 'ModelLoadError');
  assert.equal(err.message, 'x');
});

test('errorMessage: カメラ拒否', () => {
  assert.match(errorMessage(namedError('NotAllowedError')), /カメラの使用を許可してください/);
});

test('errorMessage: カメラなし', () => {
  assert.equal(errorMessage(namedError('NotFoundError')), 'カメラが見つかりません。');
});

test('errorMessage: モデル読込失敗', () => {
  assert.equal(errorMessage(namedError('ModelLoadError')), '顔認識の準備に失敗しました。通信環境を確認して再読み込みしてください。');
});

test('errorMessage: https でない', () => {
  assert.match(errorMessage(namedError('InsecureContextError')), /https/);
});

test('errorMessage: 不明なエラーや undefined でも落ちない', () => {
  assert.match(errorMessage(new Error('?')), /予期しないエラー/);
  assert.match(errorMessage(undefined), /予期しないエラー/);
});
