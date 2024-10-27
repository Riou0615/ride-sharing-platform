require('dotenv').config();

const express = require('express');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const app = express();

app.use(express.json());

// メモリ内にユーザー情報を保存する（簡易データベースとして）
const users = {};
const rideRequests = {};
const chatRooms = {}; // チャットルームごとのメッセージを保存


// Nodemailerの設定（仮のSMTP設定）
const transporter = nodemailer.createTransport({
    service: 'SendGrid',
    auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
    }
});

// ユーザー登録エンドポイント
app.post('/register', async (req, res) => {
    const { name, email, password, student_id } = req.body;

    // パスワードを暗号化
    const hashedPassword = await bcrypt.hash(password, 10);

    // 認証トークンを生成
    const token = crypto.randomBytes(32).toString('hex');

    // ユーザー情報を保存
    users[email] = { name, email, hashedPassword, student_id, token, verified: false };

    // 認証メールを送信
    const mailOptions = {
        from: 'riou0615@gmail.com',
        to: email,
        subject: 'Confirm your email',
        text: `Hello ${name}, please confirm your email by copying and pasting this link into your browser: http://localhost:3000/confirm/${token}`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error); // エラーの詳細を出力
            return res.status(500).send(`Error sending email: ${error.message}`);
        }
        res.status(200).send('Registration successful! Please check your email to verify your account.');
    });
});

// メール確認エンドポイント
app.get('/confirm/:token', (req, res) => {
    const { token } = req.params;

    // トークンを使ってユーザーを検索し、検証フラグをtrueにする
    for (let email in users) {
        if (users[email].token === token) {
            users[email].verified = true;
            return res.send('Email verified! You can now log in.');
        }
    }
    res.status(400).send('Invalid token');
});

const jwt = require('jsonwebtoken'); // JWT用のパッケージを読み込み

// 秘密鍵（トークンの生成と検証に使用）
const JWT_SECRET = process.env.JWT_SECRET;

// ログインエンドポイント
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    // ユーザーが存在するか確認
    const user = users[email];
    if (!user) {
        return res.status(400).send('User not found');
    }

    // パスワードの照合
    bcrypt.compare(password, user.hashedPassword, (err, isMatch) => {
        if (err) return res.status(500).send('Server error');
        if (!isMatch) return res.status(400).send('Invalid password');

        // トークンの生成
        const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ message: 'Login successful', token });
    });
});

// 認証ミドルウェア
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// 保護されたエンドポイント（例）
app.get('/protected', authenticateToken, (req, res) => {
    res.json({ message: 'You have accessed a protected route!', user: req.user });
});

// ユーザー登録エンドポイント
app.post('/register', async (req, res) => {
    const { name, email, password, student_id, age, bio, userType, vehicleInfo } = req.body;

    // パスワードを暗号化
    const hashedPassword = await bcrypt.hash(password, 10);

    // 認証トークンを生成
    const token = crypto.randomBytes(32).toString('hex');

    // ユーザー情報を保存
    users[email] = {
        name,
        email,
        hashedPassword,
        student_id,
        age,
        bio,
        userType, // 追加した属性フィールド
        vehicleInfo: userType === 'driver' ? vehicleInfo : null, // 運転者の場合のみ車両情報を保存
        token,
        verified: false
    };

    // 認証メールを送信
    const mailOptions = {
        from: 'riou0615@gmail.com',
        to: email,
        subject: 'Confirm your email',
        text: `Hello ${name}, please confirm your email by clicking on the following link: https://ride-sharing-platform.onrender.com/confirm/${token}`
    };
    

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return res.status(500).send('Error sending email');
        }
        res.status(200).send('Registration successful! Please check your email to verify your account.');
    });
});

app.post('/create-ride-request', (req, res) => {
    const { userType, userId, dateTime, departure, destination, seatsAvailable } = req.body;

    // 利用者が運転者か確認
    if (userType !== 'driver') {
        return res.status(400).send('Only drivers can create ride requests');
    }

    // ライドリクエスト情報を保存
    const requestId = crypto.randomBytes(16).toString('hex'); // リクエストIDを生成
    rideRequests[requestId] = {
        userId,
        dateTime,
        departure,
        destination,
        seatsAvailable
    };

    res.status(200).send({ message: 'Ride request created successfully', requestId });
});

app.get('/search-rides', (req, res) => {
    const { departure, destination, dateTime } = req.query;

    // 条件に合うリクエストをフィルタリング
    const matchedRides = Object.entries(rideRequests).filter(([requestId, ride]) => {
        return (
            ride.departure === departure &&
            ride.destination === destination &&
            new Date(ride.dateTime).toISOString().slice(0, 10) === dateTime
        );
    }).map(([requestId, ride]) => ({ requestId, ...ride }));

    if (matchedRides.length === 0) {
        return res.status(404).send('No matching rides found');
    }

    res.json({ matchedRides });
});

// チャットメッセージ送信エンドポイント
app.post('/send-message', (req, res) => {
    const { requestId, userId, message } = req.body;

    // チャットルームがなければ作成
    if (!chatRooms[requestId]) {
        chatRooms[requestId] = [];
    }

    // メッセージをチャットルームに追加
    chatRooms[requestId].push({ userId, message, timestamp: new Date().toISOString() });

    res.status(200).send('Message sent');
});

// チャットメッセージ取得エンドポイント
app.get('/get-messages', (req, res) => {
    const { requestId } = req.query;

    // チャットルームが存在するか確認
    if (!chatRooms[requestId]) {
        return res.status(404).send('Chat room not found');
    }

    // チャットルーム内のメッセージを返す
    res.json({ messages: chatRooms[requestId] });
});

const path = require('path');

// ホームページにindex.htmlを提供
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});