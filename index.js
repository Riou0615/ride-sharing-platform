require('dotenv').config();

const express = require('express');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const path = require('path');
const app = express();

app.use(express.json());

// メモリ内にユーザー情報を保存する（簡易データベースとして）
const users = {};
const rideRequests = {};
const chatRooms = {}; // チャットルームごとのメッセージを保存

// Nodemailerの設定
const transporter = nodemailer.createTransport({
    service: 'SendGrid',
    auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
    }
});

// ユーザー登録エンドポイント
app.post('/register', async (req, res) => {
    const { name, email, password, student_id, userType } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(32).toString('hex');

    users[email] = {
        name,
        email,
        hashedPassword,
        student_id,
        userType,
        token,
        verified: false
    };

    const mailOptions = {
        from: 'riou0615@gmail.com',
        to: email,
        subject: 'Confirm your email',
        text: `Hello ${name}, please confirm your email by clicking on the following link: https://ride-sharing-platform.onrender.com/confirm/${token}`
    };

    transporter.sendMail(mailOptions, (error) => {
        if (error) {
            console.error('Error sending email:', error);
            return res.status(500).json({ message: 'メール送信中にエラーが発生しました' });
        }
        res.status(200).json({ message: '登録に成功しました！メールを確認してください。' });
    });
});

// メール確認エンドポイント
app.get('/confirm/:token', (req, res) => {
    const { token } = req.params;

    for (let email in users) {
        if (users[email].token === token) {
            users[email].verified = true;
            return res.send('メール認証が完了しました！ログインできます。');
        }
    }
    res.status(400).send('無効なトークンです');
});

// ログインエンドポイント
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    const user = users[email];
    if (!user) {
        return res.status(400).json({ message: 'ユーザーが見つかりません' });
    }

    bcrypt.compare(password, user.hashedPassword, (err, isMatch) => {
        if (err) return res.status(500).json({ message: 'サーバーエラー' });
        if (!isMatch) return res.status(400).json({ message: 'パスワードが正しくありません' });

        const token = jwt.sign({ email: user.email, userType: user.userType }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ message: 'ログインに成功しました', token });
    });
});

// 認証ミドルウェア
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// ホーム画面のエンドポイント
app.get('/home', authenticateToken, (req, res) => {
    res.send("ホーム画面へようこそ！");
});

// プロフィール編集エンドポイント
app.post('/edit-profile', authenticateToken, (req, res) => {
    const { name, email, studentId } = req.body;

    const user = users[req.user.email];
    if (!user) {
        return res.status(400).json({ message: 'ユーザーが見つかりません' });
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (studentId) user.student_id = studentId;

    res.json({ message: 'プロフィールが更新されました！' });
});

// ライド募集作成エンドポイント
app.post('/create-ride-request', authenticateToken, (req, res) => {
    const { departure, destination, dateTime, seatsAvailable } = req.body;

    const user = users[req.user.email];
    if (user.userType !== 'driver') {
        return res.status(400).json({ message: '運転者のみライドの募集を作成できます' });
    }

    const requestId = crypto.randomBytes(16).toString('hex');
    rideRequests[requestId] = {
        userId: user.email,
        departure,
        destination,
        dateTime,
        seatsAvailable,
        passengers: [],
        approvedPassengers: []
    };

    res.status(200).json({ message: 'ライドの募集が作成されました！', requestId });
});

// 募集閲覧エンドポイント
app.get('/search-rides', (req, res) => {
    const rides = Object.values(rideRequests);
    res.json(rides);
});

// 同乗者がライドを選択し、登録するエンドポイント
app.post('/join-ride', authenticateToken, (req, res) => {
    const { rideId } = req.body;
    const user = users[req.user.email];

    if (user.userType !== 'passenger') {
        return res.status(400).json({ message: '同乗者のみライドに参加できます' });
    }

    const ride = rideRequests[rideId];
    if (!ride) {
        return res.status(404).json({ message: 'ライドが見つかりません' });
    }

    ride.passengers.push(user.email);

    const mailOptions = {
        from: 'riou0615@gmail.com',
        to: ride.userId,
        subject: '新しい同乗者が参加を希望しています',
        text: `${user.name}さんがあなたのライドに参加を希望しています。承認するには、プラットフォームにログインしてください。`
    };

    transporter.sendMail(mailOptions, (error) => {
        if (error) {
            console.error('Error sending email:', error);
            return res.status(500).json({ message: `通知メールの送信に失敗しました: ${error.message}` });
        }
        res.status(200).json({ message: 'ライドに参加申請を行いました。運転者の承認をお待ちください。' });
    });
});

// 運転者が同乗者を承認するエンドポイント
app.post('/approve-passenger', authenticateToken, (req, res) => {
    const { rideId, passengerEmail } = req.body;
    const user = users[req.user.email];

    const ride = rideRequests[rideId];
    if (!ride || ride.userId !== user.email) {
        return res.status(404).json({ message: 'ライドが見つからないか、承認権限がありません' });
    }

    ride.approvedPassengers.push(passengerEmail);

    const chatRoomId = crypto.randomBytes(16).toString('hex');
    chatRooms[chatRoomId] = {
        rideId: rideId,
        users: [user.email, passengerEmail],
        messages: []
    };

    res.status(200).json({ message: '同乗者を承認しました。チャットルームが作成されました。', chatRoomId });
});

// チャットメッセージの送信エンドポイント
app.post('/send-message', authenticateToken, (req, res) => {
    const { chatRoomId, message } = req.body;
    const chatRoom = chatRooms[chatRoomId];

    if (!chatRoom || !chatRoom.users.includes(req.user.email)) {
        return res.status(403).json({ message: 'このチャットルームにアクセスできません' });
    }

    const newMessage = {
        sender: req.user.email,
        message,
        timestamp: new Date().toISOString()
    };
    chatRoom.messages.push(newMessage);

    res.status(200).json({ message: 'メッセージが送信されました', newMessage });
});

// チャットメッセージの取得エンドポイント
app.get('/chat-messages/:chatRoomId', authenticateToken, (req, res) => {
    const { chatRoomId } = req.params;
    const chatRoom = chatRooms[chatRoomId];

    if (!chatRoom || !chatRoom.users.includes(req.user.email)) {
        return res.status(403).json({ message: 'このチャットルームにアクセスできません' });
    }

    res.status(200).json(chatRoom.messages);
});

// ホームページにindex.htmlを提供
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// サーバーの起動
app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
