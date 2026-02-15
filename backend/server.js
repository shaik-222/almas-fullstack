require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000; // ✅ Fixed for Render
const DATA_FILE = path.join(__dirname, "chats.json");

/* ================= MIDDLEWARE ================= */

app.use(cors());
app.use(express.json());

// ✅ Serve frontend (IMPORTANT)
// If index.html is inside "public" folder use this:
app.use(express.static("public"));

// If your index.html is in root instead,
// comment above line and use this instead:
// app.use(express.static(__dirname));

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.error("❌ GROQ_API_KEY missing");
  process.exit(1);
}

/* ================= DATA LAYER ================= */

async function ensureDataFile() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({}, null, 2));
  }
}

async function readData() {
  await ensureDataFile();
  const data = await fs.readFile(DATA_FILE, "utf8");
  return JSON.parse(data);
}

async function writeData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

async function getChat(chatId) {
  const data = await readData();
  return data[chatId] || null;
}

async function saveChat(chatId, chatData) {
  const data = await readData();
  data[chatId] = chatData;
  await writeData(data);
}

async function deleteChat(chatId) {
  const data = await readData();
  if (!data[chatId]) return false;
  delete data[chatId];
  await writeData(data);
  return true;
}

async function createChat() {
  const data = await readData();
  const chatId = crypto.randomUUID();

  data[chatId] = {
    title: "New Chat",
    createdAt: Date.now(),
    messages: [
      { role: "assistant", content: "Hey 👋 I’m Almas. How can I help you today?" }
    ],
    memory: "",
    forcedMode: null
  };

  await writeData(data);
  return chatId;
}

/* ================= MODES ================= */

const MODES = {
  chat: {
    temperature: 0.8,
    max_tokens: 500,
    systemPrompt:
      "You are Almas, a friendly AI created by Hussain. Be natural and conversational."
  },
  technical: {
    temperature: 0.2,
    max_tokens: 2000,
    systemPrompt:
      "You are Almas, a senior software engineer. Give optimized, correct answers with code blocks."
  },
  concise: {
    temperature: 0.5,
    max_tokens: 150,
    systemPrompt:
      "You are Almas. Give very short and clear answers."
  },
  exam: {
    temperature: 0.3,
    max_tokens: 1200,
    systemPrompt:
      "You are Almas. Answer in structured exam format with headings and bullet points."
  }
};

/* ================= AI CALL ================= */

async function callGroq(messages, config) {
  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages,
          temperature: config.temperature,
          max_tokens: config.max_tokens
        })
      }
    );

    if (!response.ok)
      throw new Error(`Groq API Error: ${response.statusText}`);

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (e) {
    console.error("AI Error:", e);
    return "⚠️ I'm having trouble connecting right now.";
  }
}

/* ================= MODE DETECTION ================= */

function detectMode(message) {
  const techKeywords = [
    "code","bug","error","algorithm","function",
    "javascript","node","react","express","api",
    "database","sql","c++","java","python"
  ];

  const lower = message.toLowerCase();

  if (techKeywords.some(word => lower.includes(word)))
    return "technical";

  if (lower.includes("short answer"))
    return "concise";

  if (lower.includes("exam") || lower.includes("define"))
    return "exam";

  return "chat";
}

/* ================= ROUTES ================= */
// Root route (for Render health check)
app.get("/", (req, res) => {
  res.send("🚀 Almas AI Backend is Live on Render!");
});


// Get all chats
app.get("/api/chats", async (req, res) => {
  try {
    const data = await readData();
    const list = Object.keys(data).map(id => ({
      chatId: id,
      title: data[id].title,
      createdAt: data[id].createdAt
    }));
    list.sort((a, b) => b.createdAt - a.createdAt);
    res.json(list);
  } catch {
    res.status(500).json({ error: "Failed to load chats" });
  }
});

// Get single chat
app.get("/api/chat/:chatId", async (req, res) => {
  const chat = await getChat(req.params.chatId);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  res.json(chat);
});

// Delete chat
app.delete("/api/chat/:chatId", async (req, res) => {
  const success = await deleteChat(req.params.chatId);
  if (!success)
    return res.status(404).json({ error: "Chat not found" });
  res.json({ success: true });
});

// Create new chat
app.post("/api/new-chat", async (req, res) => {
  const chatId = await createChat();
  res.json({ chatId });
});

// Send message
app.post("/api/chat", async (req, res) => {
  const { chatId, message } = req.body;
  if (!chatId || !message)
    return res.status(400).json({ error: "Invalid request" });

  const chat = await getChat(chatId);
  if (!chat)
    return res.status(404).json({ error: "Chat not found" });

  chat.messages.push({ role: "user", content: message });

  const selectedMode = chat.forcedMode || detectMode(message);
  const config = MODES[selectedMode];

  const systemMessage = {
    role: "system",
    content: `${config.systemPrompt}\nUser Memory:\n${chat.memory || "None"}`
  };

  const aiReply = await callGroq(
    [systemMessage, ...chat.messages.slice(-12)],
    config
  );

  chat.messages.push({ role: "assistant", content: aiReply });
  chat.memory = message;

  await saveChat(chatId, chat);

  res.json({
    reply: aiReply,
    modeUsed: selectedMode
  });
});

/* ================= START SERVER ================= */

app.listen(PORT, () => {
  console.log(`✅ Almas server running on port ${PORT}`);
});
