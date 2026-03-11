const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- CLOUDINARY ---------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* ---------- MIDDLEWARE ---------- */
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ storage: multer.memoryStorage() });

/* ---------- DATABASE ---------- */
const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("DB connection error:", err.message);
  } else {
    console.log("DB connected:", dbPath);
  }
});

/* ---------- TABLE ---------- */
db.run(`
CREATE TABLE IF NOT EXISTS menu (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT,
price TEXT,
category TEXT,
image TEXT,
stock INTEGER DEFAULT 0
)
`);

/* ---------- API: GET MENU ---------- */
app.get("/api/menu/all", (req, res) => {
  db.all("SELECT * FROM menu", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

/* ---------- API: ADD ITEM ---------- */
app.post("/api/menu/add", upload.single("image"), async (req, res) => {
  try {
    let imageUrl = "";

    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "flowers" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });

      imageUrl = result.secure_url;
    }

    const { name, price, category, stock } = req.body;

    db.run(
      "INSERT INTO menu(name,price,category,image,stock) VALUES(?,?,?,?,?)",
      [name, price, category, imageUrl, stock],
      function (err) {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        res.json({ success: true });
      }
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload error" });
  }
});

/* ---------- API: DELETE ITEM ---------- */
app.post("/api/menu/delete", (req, res) => {
  const { id } = req.body;

  db.run("DELETE FROM menu WHERE id=?", [id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ success: true });
  });
});

/* ---------- SERVER ---------- */
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});