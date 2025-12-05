// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// OpenAI クライアント
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// index.html を返すルート
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 必殺技生成API
app.post("/api/generate-skill", async (req, res) => {
  const { intro } = req.body;
  if (!intro || !intro.trim()) {
    return res.status(400).json({ error: "intro is required" });
  }

  try {
    // Chat Completions を使って JSON を返してもらう
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
あなたはユーモアとセンスのあるRPG風必殺技クリエイターです。
ユーザーの自己紹介文を読み、その内容を理解し、
「その人に合った完全オリジナル必殺技の名前」を生成してください。

条件:
- 四字熟語風＋カタカナ技の形にする（例：猫愛無双ギャラクシーバースト）
- ユーモアを必ず入れる
- 職業・性格・趣味などを反映する
- 日本語で出力する

出力は必ず次の JSON 形式だけにしてください（余計な文字は一切入れない）:

{
  "name": "...",
  "tagline": "...",
  "description": "..."
}
          `.trim(),
        },
        {
          role: "user",
          content: `自己紹介文: """${intro}"""`,
        },
      ],
    });

    // モデルからの返答（文字列のJSON）をパース
    const content = completion.choices[0].message.content;
    const skill = JSON.parse(content);

    res.json(skill);
  } catch (err) {
    console.error("AI error:", err);
    res.status(500).json({ error: "AI request failed" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
