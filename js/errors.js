// エラー → 画面に出す日本語メッセージ

export function namedError(name, message = '') {
  const err = new Error(message);
  err.name = name;
  return err;
}

export function errorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'カメラの使用を許可してください。アドレスバーのカメラアイコンから許可できます。';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'カメラが見つかりません。';
    case 'NotReadableError':
      return 'カメラを他のアプリが使用中です。他のアプリを閉じてからお試しください。';
    case 'InsecureContextError':
      return 'カメラを使うには https のページで開いてください。';
    case 'ModelLoadError':
      return '顔認識の準備に失敗しました。通信環境を確認して再読み込みしてください。';
    default:
      return '予期しないエラーが発生しました。再読み込みしてください。';
  }
}
