const express = require("express")
const path = require("path")
const sqlite3 = require("sqlite3").verbose()
const multer = require("multer")
const cloudinary = require("cloudinary").v2

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json({limit:"20mb"}))
app.use(express.urlencoded({extended:true}))
app.use(express.static(path.join(__dirname,"public")))

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

const upload = multer({storage:multer.memoryStorage()})

const dbPath = path.join(__dirname,"database.db")

const db = new sqlite3.Database(dbPath,(err)=>{
  if(err){
    console.log(err)
  }else{
    console.log("DB connected")
  }
})

function run(sql,params=[]){
  return new Promise((resolve,reject)=>{
    db.run(sql,params,function(err){
      if(err) reject(err)
      else resolve(this)
    })
  })
}

function get(sql,params=[]){
  return new Promise((resolve,reject)=>{
    db.get(sql,params,(err,row)=>{
      if(err) reject(err)
      else resolve(row)
    })
  })
}

function all(sql,params=[]){
  return new Promise((resolve,reject)=>{
    db.all(sql,params,(err,row)=>{
      if(err) reject(err)
      else resolve(row)
    })
  })
}

async function init(){
  await run(`
  CREATE TABLE IF NOT EXISTS menu(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    price INTEGER,
    image TEXT,
    stock INTEGER
  )
  `)
}

init()

app.get("/api/menu/all",async(req,res)=>{
  const rows = await all("SELECT * FROM menu ORDER BY id DESC")
  res.json(rows)
})

app.post("/api/menu/add",async(req,res)=>{
  const {name,price,image,stock} = req.body
  await run(
    "INSERT INTO menu(name,price,image,stock) VALUES(?,?,?,?)",
    [name,price,image,stock]
  )
  res.json({ok:true})
})

app.post("/api/menu/update",async(req,res)=>{
  const {id,name,price,image,stock} = req.body
  await run(
    "UPDATE menu SET name=?,price=?,image=?,stock=? WHERE id=?",
    [name,price,image,stock,id]
  )
  res.json({ok:true})
})

app.post("/api/menu/delete",async(req,res)=>{
  const {id} = req.body
  await run("DELETE FROM menu WHERE id=?",[id])
  res.json({ok:true})
})

app.post("/api/upload",upload.single("image"),async(req,res)=>{
  try{

    const result = await new Promise((resolve,reject)=>{
      const stream = cloudinary.uploader.upload_stream(
        {folder:"flowers"},
        (err,result)=>{
          if(err) reject(err)
          else resolve(result)
        }
      )
      stream.end(req.file.buffer)
    })

    res.json({
      url: result.secure_url
    })

  }catch(e){
    res.status(500).json({error:e.message})
  }
})

app.listen(PORT,()=>{
  console.log("Server running "+PORT)
})