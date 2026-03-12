const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- CLOUDINARY ---------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "",
  api_key: process.env.CLOUDINARY_API_KEY || "",
  api_secret: process.env.CLOUDINARY_API_SECRET || "",
});

const upload = multer({ storage: multer.memoryStorage() });

/* ---------- MIDDLEWARE ---------- */
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------- DATABASE ---------- */
const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("DB connection error:", err.message);
  } else {
    console.log("DB connected:", dbPath);
  }
});

/* ---------- HELPERS ---------- */
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

/* ---------- TABLES ---------- */
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS menu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      category TEXT DEFAULT '',
      image TEXT DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      note TEXT DEFAULT '',
      location_text TEXT DEFAULT '',
      latitude TEXT DEFAULT '',
      longitude TEXT DEFAULT '',
      items TEXT NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+3 hours'))
    )
  `);
});

/* ---------- UPLOAD IMAGE ---------- */
app.post("/api/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No image file uploaded");
    }

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return res.status(500).send("Cloudinary environment variables are missing");
    }

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "flowers" },
        (error, uploaded) => {
          if (error) reject(error);
          else resolve(uploaded);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({
      success: true,
      url: result.secure_url
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).send("Upload error");
  }
});

/* ---------- FLOWERS API ---------- */
app.get("/api/flowers", async (req, res) => {
  try {
    const rows = await all("SELECT * FROM menu ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/api/flowers", async (req, res) => {
  try {
    const {
      name = "",
      price = 0,
      category = "",
      image = "",
      stock = 0
    } = req.body;

    if (!String(name).trim()) {
      return res.status(400).send("Name is required");
    }

    const result = await run(
      `INSERT INTO menu (name, price, category, image, stock)
       VALUES (?, ?, ?, ?, ?)`,
      [
        String(name).trim(),
        Number(price) || 0,
        String(category || "").trim(),
        String(image || "").trim(),
        Number(stock) || 0
      ]
    );

    const item = await get("SELECT * FROM menu WHERE id = ?", [result.lastID]);
    res.json(item);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put("/api/flowers/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      name = "",
      price = 0,
      category = "",
      image = "",
      stock = 0
    } = req.body;

    if (!String(name).trim()) {
      return res.status(400).send("Name is required");
    }

    await run(
      `UPDATE menu
       SET name = ?, price = ?, category = ?, image = ?, stock = ?
       WHERE id = ?`,
      [
        String(name).trim(),
        Number(price) || 0,
        String(category || "").trim(),
        String(image || "").trim(),
        Number(stock) || 0,
        id
      ]
    );

    const item = await get("SELECT * FROM menu WHERE id = ?", [id]);
    res.json(item);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete("/api/flowers/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await run("DELETE FROM menu WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ---------- ORDERS API ---------- */
app.get("/api/orders", async (req, res) => {
  try {
    const rows = await all("SELECT * FROM orders ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const {
      customer_name = "",
      phone = "",
      address = "",
      note = "",
      location_text = "",
      latitude = "",
      longitude = "",
      items = []
    } = req.body;

    if (!String(customer_name).trim()) {
      return res.status(400).send("Customer name is required");
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).send("Cart is empty");
    }

    if (!String(address).trim() && !String(location_text).trim()) {
      return res.status(400).send("Address or location is required");
    }

    let total = 0;
    const finalItems = [];

    for (const row of items) {
      const flowerId = Number(row.id);
      const qty = Number(row.qty) || 0;

      if (!flowerId || qty <= 0) {
        return res.status(400).send("Invalid cart item");
      }

      const flower = await get("SELECT * FROM menu WHERE id = ?", [flowerId]);

      if (!flower) {
        return res.status(400).send(`Product not found: ${flowerId}`);
      }

      if (qty > Number(flower.stock || 0)) {
        return res.status(400).send(`Not enough stock for ${flower.name}`);
      }

      const unitPrice = Number(flower.price) || 0;
      total += unitPrice * qty;

      finalItems.push({
        id: flower.id,
        name: flower.name,
        price: unitPrice,
        qty
      });
    }

    for (const item of finalItems) {
      await run("UPDATE menu SET stock = stock - ? WHERE id = ?", [item.qty, item.id]);
    }

    const result = await run(
      `INSERT INTO orders
      (customer_name, phone, address, note, location_text, latitude, longitude, items, total, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
      [
        String(customer_name).trim(),
        String(phone).trim(),
        String(address).trim(),
        String(note).trim(),
        String(location_text).trim(),
        String(latitude).trim(),
        String(longitude).trim(),
        JSON.stringify(finalItems),
        total
      ]
    );

    const order = await get("SELECT * FROM orders WHERE id = ?", [result.lastID]);

    res.json({
      success: true,
      order_id: order.id,
      items: finalItems,
      total,
      created_at: order.created_at
    });
  } catch (err) {
    console.error("Order error:", err);
    res.status(500).send(err.message);
  }
});

app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const allowed = ["new", "preparing", "ready", "done"];
    const status = String(req.body.status || "");

    if (!allowed.includes(status)) {
      return res.status(400).send("Invalid status");
    }

    await run("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await run("DELETE FROM orders WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ---------- PAGE ROUTES ---------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/order", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "order.html"));
});

app.get("/orders", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "orders.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/thankyou", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "thankyou.html"));
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});