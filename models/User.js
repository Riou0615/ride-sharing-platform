// mongooseをインポート
const mongoose = require('mongoose');

// ユーザースキーマの定義
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },      // 名前（必須項目）
  email: { type: String, required: true, unique: true }, // メールアドレス（必須項目でユニーク）
  password: { type: String, required: true }   // パスワード（必須項目）
});

// モデルの作成
const User = mongoose.model('User', userSchema);

module.exports = User; // 他のファイルでUserモデルを使えるようにエクスポート
