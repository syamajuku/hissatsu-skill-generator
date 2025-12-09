import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// OpenAI クライアント
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// __dirname 相当（ES Modules 用）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ミドルウェア
app.use(cors());
app.use(express.json());

// index.html を配信（今まで通り）
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


// ===== ここは既存の必殺技API =====
app.post("/api/generate-skill", async (req, res) => {
  try {
    const { intro } = req.body;
    if (!intro) {
      return res.status(400).json({ error: "intro is required" });
    }

    const prompt = `
あなたは、カードゲームの必殺技名と説明を考えるクリエイティブなAIです。
ユーザーの自己紹介文をもとに、以下の形式で日本語の必殺技情報を生成してください。

- 必殺技名：コミカルでユニークな四文字熟語＋カタカナの組み合わせ（例：「電光石火バスター」「一石二鳥スラッシュ」）。最大12文字程度。
- キャッチコピー：1文。必殺技の雰囲気が伝わる短い説明。
- 説明文：2〜3文。どんな状況で使われ、どんな効果やニュアンスがあるかを、少し笑えるトーンで説明してください。

必殺技名には自己紹介文の要素（性格、趣味、仕事など）を、さりげなく反映してください。
自己紹介文：
${intro}
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 300,
    });

    const text = response.output[0].content[0].text;

    // 簡易パース（「必殺技名：」「キャッチコピー：」「説明文：」で分割する想定）
    const nameMatch = text.match(/必殺技名[:：]\s*(.+)/);
    const taglineMatch = text.match(/キャッチコピー[:：]\s*(.+)/);
    const descMatch = text.match(/説明文[:：]\s*([\s\S]+)/);

    const name = nameMatch ? nameMatch[1].trim() : "謎技ネーミング";
    const tagline = taglineMatch ? taglineMatch[1].trim() : "不思議な力を秘めた技だ。";
    const description = descMatch ? descMatch[1].trim() : "詳細不明だが、とにかくすごそうな必殺技である。";

    res.json({ name, tagline, description });
  } catch (err) {
    console.error("AI error:", err);
    res.status(500).json({ error: "failed to generate skill" });
  }
});


// ===== ここから新しい アバター生成API のひな形 =====

// multer 設定：メモリ上にファイルを保持（最大 5MB）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// /api/generate-avatar
app.post("/api/generate-avatar", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ error: "写真ファイルが送信されていません（フィールド名: photo）" });
    }

    console.log("アップロードされたファイル情報:", {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    // 1) Vision で「メガネをかけているか」を判定
    const base64 = req.file.buffer.toString("base64");
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    const visionResp = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Does this person wear eyeglasses in this photo? " +
                "Answer exactly 'YES' or 'NO'.",
            },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
      max_tokens: 5,
    });

    const rawAnswer = (visionResp.choices[0].message.content || "").trim().toUpperCase();
    const hasGlasses = rawAnswer.startsWith("Y"); // YES -> true, NO -> false
    console.log("Vision 判定（メガネ）:", rawAnswer, "=> hasGlasses:", hasGlasses);

    // 2) メガネ有無に応じた指示文
    const glassesInstruction = hasGlasses
      ? "The original person IS wearing eyeglasses. The chibi character MUST wear clearly visible, similar eyeglasses. Do NOT remove, shrink, or simplify the glasses."
      : "The original person is NOT wearing eyeglasses. The chibi character MUST NOT wear any glasses, sunglasses, or eyewear of any kind.";

    // 3) 画像編集用ファイルを作成
    const imageFile = await toFile(req.file.buffer, req.file.originalname, {
      type: req.file.mimetype,
    });

    // 4) 画像編集用プロンプト
    const prompt = `
      Transform the input photo into a full-body chibi anime-style character (2–3 heads tall).
      Requirements:
      • Keep the same pose and overall body direction as the original photo.
      • Reproduce the clothing design and colors as accurately as possible.
      • Make the face resemble the original person (hair, face shape, etc.).
      • Style: colorful game character card illustration, slightly thick outline.
      • Friendly, comedic expression.
      • Remove background → use a simple, soft gradient.
      • IMPORTANT: Output exactly ONE character only, even if multiple appear.
      • Avoid cropping. Show the whole character if possible.
      • ${glassesInstruction}
    `;

    console.log("OpenAI image-to-image edit start");

    const result = await client.images.edit({
      model: "gpt-image-1",
      image: imageFile,
      prompt,
      n: 1,
      size: "1024x1024",
      input_fidelity: "high",
      quality: "high",
      output_format: "png",
    });

    console.log("OpenAI image-to-image edit done");

    const outBase64 = result.data[0].b64_json;
    const imageUrl = `data:image/png;base64,${outBase64}`;

    return res.json({
      ok: true,
      imageUrl,
    });
  } catch (err) {
    console.error("avatar error:", err);
    const message =
      (err?.error && err.error.message) ||
      err?.message ||
      "failed to generate avatar";
    return res.status(500).json({ error: message });
  }
});


// サーバー起動
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
