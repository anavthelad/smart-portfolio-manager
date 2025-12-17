import express from "express";
import path from "path";
import fs from "fs-extra";
import multer from "multer";
import axios from "axios";

// ---- FIX FOR pdf-parse ----
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const app = express();
const PORT = 3000;
const __dirname = path.resolve();

// ======== HUGGINGFACE KEY =========
const HF_API_KEY = "Bearer hf_RgadvDvliegpWsUaRBkcKDKduNlgNYzsmwE";

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ===== USER AUTH SYSTEM =====
const USERS_FILE = path.join(__dirname, "users.json");

async function ensureUsersFile() {
  if (!(await fs.pathExists(USERS_FILE))) {
    await fs.writeJson(USERS_FILE, []);
  }
}

async function readUsers() {
  await ensureUsersFile();
  return fs.readJson(USERS_FILE);
}

async function writeUsers(users) {
  return fs.writeJson(USERS_FILE, users, { spaces: 2 });
}

// Register
app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ success: false, message: "All fields required" });

  const users = await readUsers();
  if (users.find(u => u.email === email))
    return res.status(400).json({ success: false, message: "Email already registered" });

  users.push({ name, email, password });
  await writeUsers(users);

  res.json({ success: true, user: { name, email } });
});

// Login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const users = await readUsers();
  const user = users.find(u => u.email === email && u.password === password);

  if (!user) return res.status(401).json({ success: false, message: "Invalid credentials" });

  res.json({
    success: true,
    token: Buffer.from(email).toString("base64"),
    user: { name: user.name, email: user.email }
  });
});

// ===== PDF SUMMARIZER =====
const upload = multer({ dest: "./summarizer/uploads" });

app.post("/api/summarize", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);

    // Extract text
    const pdfData = await pdfParse(buffer);
    const extractedText = pdfData.text.substring(0, 9000); 

    const hfResponse = await axios.post(
      "https://api-inference.huggingface.co/models/google/pegasus-large",
      { inputs: extractedText },
      {
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 300000
      }
    );

    fs.unlinkSync(filePath);

    res.json({
      success: true,
      summary:
        hfResponse.data[0]?.summary_text ||
        hfResponse.data[0]?.generated_text ||
        "⚠ No summary returned."
    });

  } catch (err) {
    console.error("❌ Summarizer Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Summarization failed." });
  }
});

// ===== FRONTEND ROUTING =====
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Running at: http://localhost:${PORT}`);
});
