require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser")
const axios = require("axios")
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "이메일 또는 비밀번호 누락" });

  const sql = "SELECT * FROM users WHERE email = ?";
  db.query(sql, [email], async (err, results) => {
    if (err) return res.status(500).json({ message: "서버 오류" });
    if (results.length === 0) return res.status(401).json({ message: "존재하지 않는 이메일" });

    const user = results[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ message: "비밀번호 불일치" });

    const token = jwt.sign(
      { id: user.id, email: user.email, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ token });
  });
});

app.post("/register", async (req, res) => {
  const { email, password, nickname } = req.body;
  if (!email || !password) return res.status(400).json({ message: "이메일 또는 비밀번호 누락" });

  try {
    const hash = await bcrypt.hash(password, 10);
    const sql = "INSERT INTO users (email, password_hash, nickname) VALUES (?, ?, ?)";
    db.query(sql, [email, hash, nickname], (err) => {
      if (err) {
        console.error("회원가입 오류:", err);
        return res.status(500).json({ message: "회원가입 실패" });
      }
      res.json({ message: "회원가입 성공" });
    });
  } catch (err) {
    console.error("해싱 실패:", err);
    res.status(500).json({ message: "서버 오류" });
  }
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post("/gpt", async(req, res) =>{
    const userMessage = req.body.message;

    try {
        const response = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "너는 감정을 분석하고 공감하는 챗봇이야." },
              { role: "user", content: userMessage },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );
    
        const gptReply = response.data.choices[0].message.content;
        res.json({ reply: gptReply });
      } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: "GPT 요청 실패" });
      }
});

app.listen(port, () => {
    console.log(`GPT 서버 실행 중: http://localhost:${port}`);
  });