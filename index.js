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
    const { name, email, password, student_id, age, bio, userType, vehicleInfo } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(32).toString('hex');

    users[email] = {
        name,
        email,
        hashedPassword,
        student_id,
        age,
        bio,
        userType,
        vehicleInfo: userType === 'driver' ? vehicleInfo : null,
        token,
        verified: false
    };

    const mailOptions = {
        from: 'riou0615@gmail.com',
        to: email,
        subject: 'Confirm your email',
        text: `Hello ${name}, please confirm your email by clicking on the following link: https://ride-sharing-platform.onrender.com/confirm/${token}`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
            return res.status(500).json({ message: `Error sending email: ${error.message}` });
        }
        res.status(200).json({ message: 'Registration successful! Please check your email to verify your account.' });
    });
});

// メール確認エンドポイント
app.get('/confirm/:token', (req, res) => {
    const { token } = req.params;

    for (let email in users) {
        if (users[email].token === token) {
            users[email].verified = true;
            return res.send('Email verified! You can now log in.');
        }
    }
    res.status(400).send('Invalid token');
});

// ログインエンドポイント
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    const user = users[email];
    if (!user) {
        return res.status(400).json({ message: 'User not found' });
    }

    bcrypt.compare(password, user.hashedPassword, (err, isMatch) => {
        if (err) return res.status(500).json({ message: 'Server error' });
        if (!isMatch) return res.status(400).json({ message: 'Invalid password' });

        const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ message: 'Login successful', token });
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

// プロフィール編集エンドポイント
app.post('/edit-profile', authenticateToken, (req, res) => {
    const { name, email, student_id } = req.body;
    const user = users[req.user.email];
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.name = name || user.name;
    user.email = email || user.email;
    user.student_id = student_id || user.student_id;
    res.status(200).json({ message: 'Profile updated successfully' });
});

// ライド募集作成エンドポイント（運転者のみ）
app.post('/create-ride-request', authenticateToken, (req, res) => {
    const { departure, destination, dateTime, seatsAvailable } = req.body;
    const user = users[req.user.email];

    if (user.userType !== 'driver') {
        return res.status(403).json({ message: 'Only drivers can create ride requests' });
    }

    const requestId = crypto.randomBytes(16).toString('hex');
    rideRequests[requestId] = {
        userId: req.user.email,
        departure,
        destination,
        dateTime,
        seatsAvailable
    };

    res.status(200).json({ message: 'Ride request created successfully', requestId });
});

// ライド募集閲覧エンドポイント
app.get('/search-rides', (req, res) => {
    const availableRides = Object.entries(rideRequests).map(([requestId, ride]) => ({
        requestId,
        ...ride
    }));
    res.json(availableRides);
});

// ホーム画面のエンドポイント
app.get('/home', authenticateToken, (req, res) => {
    res.send("Welcome to your homepage!");
});

// ホームページにindex.htmlを提供
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
