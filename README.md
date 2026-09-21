# JSSA マッチングツール 2（jssa-matching3）

AIを活用したJSSA（日本スタートアップ支援協会）イベント参加者向けマッチングツール。
アプリ１（jssa-matching-v2）をベースに、以下の仕様に変更したバージョンです。

---

## 🔄 アプリ２の仕様（アプリ１との違い）

1. ユーザーがログイン・プロフィール登録・アンケート入力
2. **マッチング結果はユーザーには非表示**（アプリ１では結果カードを直接表示していたが、アプリ２ではAIマッチング結果をスプレッドシート「マッチング結果」に保存するのみとし、ユーザー画面には表示しない）
3. 岡代表が管理画面（`/admin`）の「📋 マッチング結果」タブでマッチング結果を確認し、**企業名のみ**をユーザーにメール送信する（「📧 企業名のみメール送信」ボタン）
4. ユーザーが会いたい企業名を岡代表にメール返信する（アプリ外・メール上でのやり取り）
5. 岡代表が管理画面の「💬 ユーザー返信を登録」ボタンで、ユーザーから返信のあった企業名を「会いたいリクエスト」に手動登録し、対象企業の役職者を選択したうえで、ユーザープロフィールを紹介メールとして送信する（「すべて」タブ→「✅ 推薦メール送信」）
6. 双方合意後に紹介プロフィールメールを送信する

---

## 📁 プロジェクト構成

```
jssa-matching3/
├── public/
│   ├── login.html          # ログイン画面
│   ├── profile.html        # プロフィール登録
│   ├── index.html          # アンケート入力（結果は表示しない）
│   ├── mypage.html         # マイページ（会いたい履歴のみ表示）
│   └── admin.html          # 管理画面（マッチング結果確認・メール送信）
├── netlify/
│   └── functions/
│       ├── auth.js               # ログイン認証
│       ├── save-profile.js       # プロフィール保存
│       ├── match.js              # マッチングエンジン（結果はシート保存のみ、ユーザーには非公開）
│       ├── admin-api.js          # 管理者用API（マッチング結果確認・企業名送信・会いたいリクエスト管理）
│       ├── sheets-helper.js      # Googleスプレッドシート連携
│       ├── send-email.js / advice.js / enrich.js / save-request.js / get-history.js / get-pitch.js / upload-pitch.js / collect-company-info.js / counter.js / debug.js
├── netlify.toml
├── package.json
└── README.md
```

---

## 🗂 スプレッドシート構成（アプリ１と共有）

アプリ１と同じスプレッドシートを使用します。アプリ２では新たに以下のシートを使用します（存在しない場合は事前に作成してください）：

- **マッチング結果**：列＝バッチID / 日時 / ユーザーID / ユーザー会社名 / ユーザー氏名 / ユーザーメール / マッチ企業名 / スコア / ステータス（未通知／企業名送信済み）
- **会いたいリクエスト**：アプリ１と同じ形式（岡代表が手動登録、または将来的にユーザー入力フォームと連携可能）

---

## 🚀 Netlifyへのデプロイ手順

### 1. Build settings
- **Build command**: （空欄でOK）
- **Publish directory**: `public`
- **Functions directory**: `netlify/functions`

### 2. 環境変数（アプリ１と同じ）

| Key | 内容 |
|-----|------|
| `ANTHROPIC_API_KEY` | Claude APIキー（AIマッチング理由生成に使用） |
| `GOOGLE_API_KEY` | Google APIキー |
| `GOOGLE_SERVICE_ACCOUNT` | Googleサービスアカウント（JSON文字列） |
| `GOOGLE_SHEET_ID` | スプレッドシートID |
| `RESEND_API_KEY` | メール送信用APIキー（Resend） |
| `ADMIN_PASSWORD` | 管理画面ログインパスワード |

### 3. カスタムドメイン

`matching.jssa-matching3.jp` をNetlifyのDomain managementから追加し、お名前.comのレンタルサーバーDNS設定でCNAME・TXTレコードを設定します。

---

## 🛠 ローカル開発

```bash
npm install
npm install -g netlify-cli
netlify dev
# → http://localhost:8888 で起動
```
