# git statusを自作する(Qiita記事)
## セットアップと実行方法

TypeScriptで実装された `git status` の簡易版ツールの実行手順です。

### 1\. 事前準備

Node.js がインストールされている必要があります。

```bash
# プロジェクトのディレクトリに移動
cd my-git-status

# 依存ライブラリのインストール
npm install
```

### 2\. 実行方法

本ツールは、**コマンドを実行したディレクトリ**を対象に `git status` の解析を行います。
そのため、解析したいGitリポジトリのルートディレクトリでコマンドを実行してください。

```bash
# 解析したいGitリポジトリへ移動（例）
cd /path/to/your/git-repository

# ツールを実行（パスはツールの場所を指定）
npx ts-node /path/to/my-git-status/src/index.ts
```

※ `my-git-status` ディレクトリ内で開発中にテスト実行する場合は、解析対象の `.git` ディレクトリが存在する場所で以下を実行します。

```bash
npx ts-node src/index.ts
```
