import { test } from 'node:test';
import assert from 'node:assert/strict';
import { euclideanDistance, findBestMatch, pickLargestFace, MATCH_THRESHOLD } from '../js/match.js';

// 128次元のうち先頭だけ値を持つベクトル
const vec = (first) => [first, ...new Array(127).fill(0)];
const emp = (id, ...firsts) => ({ id, name: `社員${id}`, descriptors: firsts.map(vec), createdAt: '' });

test('MATCH_THRESHOLD は 0.5', () => {
  assert.equal(MATCH_THRESHOLD, 0.5);
});

test('euclideanDistance', () => {
  assert.equal(euclideanDistance([0, 0], [3, 4]), 5);
});

test('findBestMatch: 最も近い人を返す（各人の複数特徴量のうち最小距離で比較）', () => {
  const result = findBestMatch(vec(0), [emp(1, 0.4, 0.9), emp(2, 0.2)]);
  assert.equal(result.employee.id, 2);
  assert.ok(Math.abs(result.distance - 0.2) < 1e-9);
});

test('findBestMatch: 最小距離が 0.5 ちょうどなら一致しない', () => {
  assert.equal(findBestMatch(vec(0), [emp(1, 0.5)]), null);
});

test('findBestMatch: 0.5 未満なら一致', () => {
  assert.equal(findBestMatch(vec(0), [emp(1, 0.49)]).employee.id, 1);
});

test('findBestMatch: 従業員がいなければ null', () => {
  assert.equal(findBestMatch(vec(0), []), null);
});

test('pickLargestFace: 面積が最大の顔', () => {
  const face = (w, h) => ({ detection: { box: { width: w, height: h } } });
  const big = face(100, 120);
  assert.equal(pickLargestFace([face(50, 50), big, face(90, 90)]), big);
});

test('pickLargestFace: 空なら null', () => {
  assert.equal(pickLargestFace([]), null);
});
