const express = require("express");
const cors = require("cors");
const multer = require("multer");
const streamifier = require("streamifier");
const { v2: cloudinary } = require("cloudinary");
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors({ origin: ["http://localhost:5173"], credentials: true }));

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Memory storage for multer
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100 MB

const port = process.env.PORT || 5000;

// MongoDB setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_SECRET_KEY}@cluster0.gmdbo5r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

async function run() {
    try {
        const userCollection = client.db("apnrghor").collection("userinfo");
        const apartmentCollection = client.db("apnrghor").collection("appartments");
        const agreementCollection = client.db("apnrghor").collection("agreements");


        app.get("/apartments", async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 6;
            const skip = (page - 1) * limit;

            const total = await apartmentCollection.countDocuments();
            const totalPages = Math.ceil(total / limit);
            const apartments = await apartmentCollection.find().skip(skip).limit(limit).toArray();

            res.json({ apartments, totalPages });
        });

        app.get('/user', async (req, res) => {
            const email = req.query;
            const result = await userCollection.findOne(email)
            res.send(result)
        })

        app.get('/agreementrqst' , async (req , res) =>{
            const result = await agreementCollection.find({status: "pending"}).toArray()
            res.send(result)
        })

        app.post('/addagreement', async (req, res) => {
            try {
                const { name, email, floor_no, block_name, apartment_no, rent } = req.body;

                // ✅ Prevent duplicate agreement by the same user
                const existing = await agreementCollection.findOne({ email });
                if (existing) {
                    return res.status(400).json({ message: "You already applied for an apartment!" });
                }

                const newAgreement = {
                    name,
                    email,
                    floor_no,
                    block_name,
                    apartment_no,
                    rent,
                    status: "pending",
                    createdAt: new Date(),
                };

                const result = await agreementCollection.insertOne(newAgreement);

                res.status(201).json({ message: "Agreement request submitted!", result });
            } catch (error) {
                console.error(error);
                res.status(500).json({ message: "Server error while creating agreement" });
            }
        });




        app.post("/adduser", upload.single("photo"), async (req, res) => {
            try {
                const { name, email, googlePhotoURL } = req.body;

                // Check if user exists
                const existing = await userCollection.findOne({ email });
                if (existing) return res.status(201).send({ message: "user exists" });

                let photoURL = googlePhotoURL || null;
                let cloudinary_id = null;

                // If file uploaded, send buffer to Cloudinary
                if (req.file) {
                    const streamUpload = (reqFile) => {
                        return new Promise((resolve, reject) => {
                            const stream = cloudinary.uploader.upload_stream(
                                { folder: "user_profiles" },
                                (error, result) => {
                                    if (result) resolve(result);
                                    else reject(error);
                                }
                            );
                            streamifier.createReadStream(reqFile.buffer).pipe(stream);
                        });
                    };

                    const uploadResult = await streamUpload(req.file);
                    photoURL = uploadResult.secure_url;
                    cloudinary_id = uploadResult.public_id;
                }

                const newUser = {
                    name,
                    email,
                    photoURL,
                    cloudinary_id,
                    createdAt: new Date(),
                    role: "user"
                };

                const result = await userCollection.insertOne(newUser);
                res.send(result);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Server error" });
            }
        });

        await client.db("admin").command({ ping: 1 });
        console.log("Connected to MongoDB!");
    } finally { }
}
run().catch(console.dir);

app.listen(port, () => console.log(`Server running on port ${port}`));
