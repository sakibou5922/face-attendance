# 顔認証 出退勤デモ 設計書

- 作成日: 2026-09-30
- ステータス: レビュー待ち

## 1. 目的と前提

- **目的**: 顔認証で出退勤を打刻するデモを作り、営業等で見せる。評判が良ければ製品版（複数社向け）に拡張する。
- **コスト**: 0円。有料API・サーバーは使わない。
- **形態**: ブラウザで動く静的Webアプリ（ビルド不要）。PC/iPadのカメラで動作。公開は GitHub Pages / Netlify 無料枠（https）。
- **デモの範囲外（製品版で対応）**: 管理者ログイン、複数社・複数店舗、サーバー保存、なりすまし（写真かざし）対策。

## 2. 技術選定

- 顔認識: **@vladmandic/face-api**（face-api.js のメンテ継続版、MIT、無料）。モデルは jsDelivr CDN から読み込む。
  - 使用モデル: `tinyFaceDetector`（検出）、`faceLandmark68Net`（顔の位置合わせ）、`faceRecognitionNet`（128次元の特徴量）
- 保存: ブラウザの **IndexedDB**
- 言語: 素のHTML / CSS / JavaScript（ES Modules）。フレームワーク・ビルドなし。
- 顔画像そのものは保存しない。保存するのは特徴量（数値の配列）のみ。

## 3. 構成（ファイル）

```
face-attendance/
  index.html          画面の骨組み（タブ: 打刻 / 従業員登録 / 勤怠一覧）
  css/style.css
  js/
    app.js            タブ切替・起動処理
    face.js           カメラ制御、モデル読込、特徴量抽出、照合   ← 製品版で差し替え可能な境界
    store.js          IndexedDB への保存・読込                   ← 製品版でサーバー保存に差し替え可能な境界
    attendance.js     打刻ルール・日別集計・CSV生成（純粋関数、DOM/DB非依存）
    views/punch.js    打刻画面
    views/register.js 従業員登録画面
    views/records.js  勤怠一覧画面
  tests/
    attendance.test.js  Node 標準の node:test で実行
```

各モジュールの責務:

- **face.js** — `loadModels()`, `startCamera(videoEl)`, `stopCamera()`, `detectDescriptor(videoEl)` → 最も大きい顔1つの特徴量 or null, `findBestMatch(descriptor, employees)` → `{employee, distance} | null`
- **store.js** — `listEmployees()`, `addEmployee({name, descriptors})`, `deleteEmployee(id)`, `addPunch({employeeId, type, timestamp})`, `listPunches({from, to})`, `seedSampleData()`
- **attendance.js** — `shouldRejectPunch(lastPunch, newPunch)`, `summarizeDaily(punches, employees)`, `toCsv(rows)`

## 4. データ

IndexedDB `face-attendance`（version 1）

| ストア | キー | フィールド |
|---|---|---|
| employees | id（自動採番） | name: string, descriptors: number[][]（128次元×3枚）, createdAt: ISO文字列 |
| punches | id（自動採番） | employeeId: number, type: `"in"` \| `"out"`, timestamp: ISO文字列 |

- 従業員を削除すると、その人の打刻も削除する。

## 5. 画面と動き

### 5.1 打刻
1. 大きな「出勤」「退勤」ボタンが表示される。
2. 押すとカメラが起動し、最大10秒間、0.3秒ごとに顔を探す。
3. 照合: 登録者の各特徴量とのユークリッド距離の最小値が **0.5 未満** なら本人と判定（最も近い人）。
4. 成功時「山田太郎さん 出勤 9:02」を大きく表示 → 3秒後に初期画面へ戻り、カメラを停止。
5. 二重打刻防止: 同じ人・同じ種別の打刻が **1分以内** にあれば記録せず「すでに打刻済みです」と表示。

### 5.2 従業員登録
1. 名前を入力 →「撮影開始」
2. 3回撮影（「正面」「少し右」「少し左」と案内）。各回、顔が1つ検出できたら特徴量を保存。
3. 3枚揃ったら保存。登録済み一覧（名前・登録日・削除ボタン）を表示。
4. 名前が空なら撮影を開始させない。

### 5.3 勤怠一覧
- 月の選択（初期値: 今月）。
- 表の列: 日付 / 名前 / 出勤 / 退勤 / 勤務時間
- 集計ルール: 同じ日・同じ人について、出勤＝その日の最初の `in`、退勤＝その日の最後の `out`。片方がない場合は「—」とし、勤務時間も「—」とする。勤務時間は `H:MM` 形式（休憩は差し引かない）。
- 「CSVダウンロード」: UTF-8（BOM付き、Excelで文字化けしない）、列は表と同じ。
- 「サンプルデータを入れる」: 架空の従業員3名（顔データはダミー値で照合には使えない）と今月の打刻を投入する。

## 6. エラー時の動き

| 状況 | 表示 |
|---|---|
| カメラの使用許可が拒否された | 「カメラの使用を許可してください」と許可手順の案内 |
| カメラがない | 「カメラが見つかりません」 |
| モデルの読み込みに失敗（オフライン等） | 「顔認識の準備に失敗しました。通信環境を確認して再読み込みしてください」 |
| 従業員が0人の状態で打刻 | 「先に従業員登録をしてください」 |
| 10秒以内に顔が見つからない／一致しない | 「認識できませんでした。もう一度お試しください」 |
| 複数の顔が写っている | 一番大きい（手前の）顔を使う |

## 7. テスト

- **自動テスト**（`node --test tests/`）: attendance.js の純粋関数を対象とする。
  - 二重打刻判定（59秒で拒否、61秒で許可、種別が違えば許可）
  - 日別集計（通常ケース、退勤なし、出勤なし、1日に複数回打刻）
  - CSV（BOM付き、カンマやダブルクオートを含む名前のエスケープ）
- **手動確認**（ブラウザ）: 登録 → 打刻（本人／未登録者）→ 一覧 → CSV の一連の流れ。カメラ拒否時の表示も確認する。

## 8. 動かし方

- ローカル: `npx serve face-attendance` などの静的サーバーで開く（localhost ならカメラが使える）。
- 公開: フォルダを GitHub Pages / Netlify にアップロードする。
