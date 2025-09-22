const express = require('express');
const cors = require('cors');
require('dotenv').config()
const app = express()
app.use(express.json())
app.use(cors({
  origin: [
    "http://localhost:5173"

  ],
  credentials: true
}))

const port = process.env.PORT || 5000

app.get("/", (req, res) => {
  res.send("sharemeal server is running")
})



app.listen(port, () => {
  console.log("server is running");

})