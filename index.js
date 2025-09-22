const { MongoClient, ServerApiVersion } = require('mongodb');
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
  res.send("apnrghor server is running")
})



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_SECRET_KEY}@cluster0.gmdbo5r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {

    const apartmentCollection = client.db("apnrghor").collection("appartments")

    app.get("/apartments", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6;
      const skip = (page - 1) * limit;

      const total = await apartmentCollection.countDocuments();
      const totalPages = Math.ceil(total / limit);

      const apartments = await apartmentCollection
        .find()
        .skip(skip)
        .limit(limit)
        .toArray();

      res.json({ apartments, totalPages });
    });





    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {

  }
}
run().catch(console.dir);



app.listen(port, () => {
  console.log("server is running");

})