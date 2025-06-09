const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser")
const axios = require("axios")
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const sessionMessages = {}; // simple in-memory session message store
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Load Korean stopwords from file
const stopwordsPath = path.join(__dirname, "korean_stopwords.txt");
let koreanStopwords = new Set();
try {
  const stopwordsContent = fs.readFileSync(stopwordsPath, "utf-8");
  koreanStopwords = new Set(
    stopwordsContent.split("\n").map(w => w.trim()).filter(Boolean)
  );
  console.log("불용어 로드 완료:", koreanStopwords.size, "개");
} catch (err) {
  console.error("불용어 파일 로드 실패:", err.message);
}

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

    res.json({ token, user_id: user.id, nickname: user.nickname, email: user.email});
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

app.post("/gpt", async (req, res) => {
  const { message: userMessage, session_id = "global" } = req.body;

  if (!sessionMessages[session_id]) {
    sessionMessages[session_id] = [
      {
        role: "system",
        content: `너는 감정을 공감하고 위기 상황에 신중히 대응하는 챗봇이야.  
                  사용자의 현재 감정과 시급한 필요를 물어보고, 물리적·심리적 안전 여부를 먼저 확인해.  
                  무리하게 이야기하도록 강요하지 말고, 경청과 공감을 중심으로 대응해.  
                  상담자는 내담자의 자율성과 존엄을 존중해야 하며, 판단이나 강요는 삼가야 해.  
                  사용자가 자살, 자해, 타살, 타해 등을 직·간접적으로 언급할 경우 아래 기관을 안내해줘:
                  - 생명의 전화 1588-9191 (24시간)
                  - 보건복지상담센터 129 / www.129.go.kr
                  - 국가트라우마센터 https://www.nct.go.kr/
                  - 경기도 정신건강복지센터 031-212-0435  
                  지킬 수 없는 약속은 하지 말고, 쉬운 말로 따뜻하게 설명해줘.`
      }
    ];
  }

  sessionMessages[session_id].push({ role: "user", content: userMessage });

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: sessionMessages[session_id],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const gptReply = response.data.choices[0].message.content;
    sessionMessages[session_id].push({ role: "assistant", content: gptReply });
    res.json({ reply: gptReply });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "GPT 요청 실패" });
  }
});

app.post("/save-emotion-entry", (req, res) => {
  const { user_id, diary_date, diary, emotions } = req.body;
  if (!user_id || !diary_date || !diary || !Array.isArray(emotions) || emotions.length === 0) {
    return res.status(400).json({ message: "필수 항목 누락 또는 잘못된 감정 배열" });
  }

  const insertDiarySql = `
    INSERT INTO emotion_diary (user_id, diary_date, diary, dominant_emotion, created_at)
    VALUES (?, ?, ?, ?, NOW())
  `;

  const dominantEmotion = emotions.reduce((max, cur) => cur.percent > max.percent ? cur : max, emotions[0]);

  db.query(insertDiarySql, [user_id, diary_date, diary, dominantEmotion.emotion], (err, result) => {
    if (err) {
      console.error("일기 저장 오류:", err);
      return res.status(500).json({ message: "일기 저장 실패" });
    }

    const diaryId = result.insertId;

    const insertDetailsSql = `
      INSERT INTO emotion_details (diary_id, emotion, percent)
      VALUES ?
    `;
    const detailValues = emotions.map(e => [diaryId, e.emotion, e.percent]);

    db.query(insertDetailsSql, [detailValues], (err) => {
      if (err) {
        console.error("감정 상세 저장 오류:", err);
        return res.status(500).json({ message: "감정 상세 저장 실패" });
      }
      res.json({ message: "저장 성공" });
    });
  });
});

app.get("/get-emotion-entries", (req, res) => {
  const { user_id, diary_date } = req.query;
  if (!user_id || !diary_date) {
    return res.status(400).json({ message: "필수 항목 누락" });
  }

  const sql = `
    SELECT ed.id AS diary_id, ed.diary, ed.dominant_emotion, ed.created_at,
           dt.emotion, dt.percent
    FROM emotion_diary ed
    LEFT JOIN emotion_details dt ON ed.id = dt.diary_id
    WHERE ed.user_id = ? AND ed.diary_date = ?
    ORDER BY ed.id ASC
  `;

  db.query(sql, [user_id, diary_date], (err, results) => {
    if (err) {
      console.error("감정 조회 오류:", err);
      return res.status(500).json({ message: "조회 실패" });
    }

    const diaryMap = {};
    results.forEach(row => {
      if (!diaryMap[row.diary_id]) {
        diaryMap[row.diary_id] = {
          diary_id: row.diary_id,
          diary: row.diary,
          dominant_emotion: row.dominant_emotion,
          created_at: row.created_at,
          emotions: []
        };
      }
      if (row.emotion) {
        diaryMap[row.diary_id].emotions.push({
          emotion: row.emotion,
          percent: row.percent
        });
      }
    });

    const result = { entries: Object.values(diaryMap) };
    console.log(JSON.stringify(result, null, 2));
    res.json(result);
  });
});

// 월별 top 3 감정 조회 엔드포인트
app.get("/monthly-top-emotions", (req, res) => {
  const { user_id, year, month } = req.query;
  if (!user_id || !year || !month) {
    return res.status(400).json({ message: "필수 항목 누락" });
  }

  const sql = `
    SELECT dominant_emotion AS emotion, COUNT(*) AS count
    FROM emotion_diary
    WHERE user_id = ?
      AND YEAR(diary_date) = ?
      AND MONTH(diary_date) = ?
    GROUP BY dominant_emotion
    ORDER BY count DESC
    LIMIT 3
  `;

  db.query(sql, [user_id, year, month], (err, results) => {
    if (err) {
      console.error("감정 통계 조회 오류:", err);
      return res.status(500).json({ message: "조회 실패" });
    }
    res.json(results);
  });
});

// 감정 Top3 + 단어 목록 통합 응답
app.get("/monthly-top-emotions-with-words", (req, res) => {
  const { user_id, year, month } = req.query;
  if (!user_id || !year || !month) {
    return res.status(400).json({ message: "필수 항목 누락" });
  }

  const topEmotionSql = `
    SELECT dominant_emotion AS emotion, COUNT(*) AS count
    FROM emotion_diary
    WHERE user_id = ?
      AND YEAR(diary_date) = ?
      AND MONTH(diary_date) = ?
    GROUP BY dominant_emotion
    ORDER BY count DESC
    LIMIT 3
  `;

  db.query(topEmotionSql, [user_id, year, month], (err, topEmotions) => {
    if (err) {
      console.error("감정 통계 조회 오류:", err);
      return res.status(500).json({ message: "조회 실패" });
    }

    const emotionResults = [];
    let processedCount = 0;

    if (topEmotions.length === 0) {
      return res.json([]);
    }

    topEmotions.forEach(row => {
      const emotion = row.emotion;
      const count = row.count;

      const diarySql = `
        SELECT diary
        FROM emotion_diary
        WHERE user_id = ? AND YEAR(diary_date) = ? AND MONTH(diary_date) = ? AND dominant_emotion = ?
      `;

      db.query(diarySql, [user_id, year, month, emotion], (err, diaries) => {
        if (err) {
          console.error("일기 조회 오류:", err);
          return res.status(500).json({ message: "단어 조회 실패" });
        }

        const combinedText = diaries.map(r => r.diary).join(" ");
        console.log("일기 텍스트:", combinedText);

        // Spawn python3 extract.py, send combinedText via stdin
        const python = spawn("python3", ["extract_words.py"]);

        python.stdin.write(combinedText);
        python.stdin.end();

        let resultData = "";
        python.stdout.on("data", (data) => {
          resultData += data.toString();
        });

        python.stderr.on("data", (data) => {
          console.error("파이썬 오류:", data.toString());
        });

        python.on("close", () => {
          // 불용어 제거
          resultData = resultData
            .split(",")
            .map(w => w.trim())
            .filter(w => w && !koreanStopwords.has(w))
            .join(",");
          // Assume extract.py outputs comma-separated words
          const words = resultData.split(",").map(w => w.trim()).filter(Boolean);
          emotionResults.push({
            emotion,
            count,
            words
          });
          console.log("[" + emotion + "] 추출된 단어 목록:", words);
          processedCount++;
          if (processedCount === topEmotions.length) {
            res.json(emotionResults);
          }
        });
      });
    });
  });
});

// 월별 일별 감정 색상 조회 엔드포인트
app.get("/monthly-emotion-colors", (req, res) => {
  const { user_id, year, month } = req.query;
  if (!user_id || !year || !month) {
    return res.status(400).json({ message: "필수 항목 누락" });
  }

  const sql = `
    SELECT DATE_FORMAT(diary_date, '%Y-%m-%d') AS diary_date, dominant_emotion AS emotion
    FROM emotion_diary
    WHERE user_id = ?
      AND YEAR(diary_date) = ?
      AND MONTH(diary_date) = ?
  `;

  db.query(sql, [user_id, year, month], (err, results) => {
    if (err) {
      console.error("색상 조회 오류:", err);
      return res.status(500).json({ message: "조회 실패" });
    }
    res.json(results);
  });
});

app.listen(port, () => {
    console.log(`GPT 서버 실행 중: http://localhost:${port}`);
  });