require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser")
const axios = require("axios")

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

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