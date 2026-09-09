# ・Meloly・

メロディが先にあり、母音パターンに合う言葉をあてはめていく、作曲家のための作詞支援ツール。

## 構成

- `index.html` … メインアプリ
- `main.js` / `style.css` … 本体のロジックとスタイル
- `wordrip.html` … WORDRIP（言葉が流れるビジュアル）
- `picturedrip.html` … PictureDrip
- `quickmemo.html` … ・Meloly・mini（スマホ用メモ・PWA）
- `manifest.json` / `sw.js` … PWA設定
- `modules/` … dict / about / audio / floppy / firebase
- `icons/` … アプリアイコン各サイズ

## ローカルでの起動

```
py -m http.server 8000
```
ブラウザで http://localhost:8000/index.html を開く
