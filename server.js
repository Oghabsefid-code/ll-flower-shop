const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const imagesDir = path.join(__dirname, "public", "images");
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("DB connection error:", err.message);
  } else {
    console.log("DB connected:", dbPath);
  }
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getKuwaitDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }

  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, imagesDir);
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^\w.\-]/g, "_");
    cb(null, Date.now() + "-" + safeName);
  }
});

const upload = multer({ storage });

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS flowers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      image TEXT,
      category TEXT,
      stock INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      note TEXT,
      items TEXT NOT NULL,
      total INTEGER NOT NULL,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`ALTER TABLE orders ADD COLUMN location_text TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN latitude TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN longitude TEXT`, () => {});
});

app.post("/api/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("no file uploaded");
  }

  res.json({
    ok: true,
    url: "/images/" + req.file.filename
  });
});

app.get("/api/flowers", async (req, res) => {
  try {
    const rows = await all("SELECT * FROM flowers ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/api/flowers", async (req, res) => {
  try {
    const { name, price, image, category, stock } = req.body;

    if (!name || Number(price) <= 0) {
      return res.status(400).send("name and valid price required");
    }

    await run(
      "INSERT INTO flowers (name, price, image, category, stock) VALUES (?, ?, ?, ?, ?)",
      [
        name.trim(),
        Number(price),
        image || "",
        category || "",
        Number(stock || 0)
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put("/api/flowers/:id", async (req, res) => {
  try {
    const { name, price, image, category, stock } = req.body;

    if (!name || Number(price) <= 0) {
      return res.status(400).send("name and valid price required");
    }

    const oldFlower = await get("SELECT * FROM flowers WHERE id=?", [req.params.id]);
    if (!oldFlower) {
      return res.status(404).send("flower not found");
    }

    await run(
      "UPDATE flowers SET name=?, price=?, image=?, category=?, stock=? WHERE id=?",
      [
        name.trim(),
        Number(price),
        image || oldFlower.image || "",
        category || "",
        Number(stock || 0),
        req.params.id
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete("/api/flowers/:id", async (req, res) => {
  try {
    await run("DELETE FROM flowers WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const {
      customer_name,
      phone,
      address,
      note,
      location_text,
      latitude,
      longitude,
      items
    } = req.body;

    if (!customer_name || !Array.isArray(items) || !items.length) {
      return res.status(400).send("invalid order");
    }

    const hasAddress = String(address || "").trim().length > 0;
    const hasLocation = String(location_text || "").trim().length > 0;

    if (!hasAddress && !hasLocation) {
      return res.status(400).send("address or location required");
    }

    let total = 0;
    const finalItems = [];

    for (const item of items) {
      const flower = await get("SELECT * FROM flowers WHERE id=?", [item.id]);

      if (!flower) {
        return res.status(400).send("flower not found");
      }

      const qty = Number(item.qty || 0);

      if (qty <= 0) {
        return res.status(400).send("invalid qty");
      }

      if (Number(flower.stock) < qty) {
        return res.status(400).send(`stock not enough for ${flower.name}`);
      }

      total += Number(flower.price) * qty;

      finalItems.push({
        id: flower.id,
        name: flower.name,
        price: Number(flower.price),
        qty
      });
    }

    for (const item of finalItems) {
      await run("UPDATE flowers SET stock = stock - ? WHERE id=?", [item.qty, item.id]);
    }

    const kuwaitNow = getKuwaitDateTime();

    const result = await run(
      `INSERT INTO orders
      (customer_name, phone, address, note, location_text, latitude, longitude, items, total, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customer_name.trim(),
        phone || "",
        address || "",
        note || "",
        location_text || "",
        latitude || "",
        longitude || "",
        JSON.stringify(finalItems),
        total,
        "new",
        kuwaitNow
      ]
    );

    res.json({
      ok: true,
      total,
      created_at: kuwaitNow,
      order_id: result.lastID,
      items: finalItems
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const rows = await all("SELECT * FROM orders ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    await run("UPDATE orders SET status=? WHERE id=?", [status || "new", req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    await run("DELETE FROM orders WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});