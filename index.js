const express = require("express");
const cors = require("cors");
const multer = require("multer");
const streamifier = require("streamifier");
const { v2: cloudinary } = require("cloudinary");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const Stripe = require("stripe");
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICES_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);


const app = express();
app.use(express.json());
app.use(cors({ origin: ["http://localhost:5173"], credentials: true }));

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});


const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100 MB

const port = process.env.PORT || 5000;


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_SECRET_KEY}@cluster0.gmdbo5r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});


const verifyToken = async (req, res, next) => {
    const accessToken = req.headers?.authorization
    if (!accessToken || !accessToken.startsWith("Bearer ")) return res.status(401).send({ message: "unauthorized access" })
    const token = accessToken.split(" ")[1]
    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.decoded = decoded
        next();
    }
    catch (error) {
        return res.status(401).send({ message: "unauthorized access" })
    }
}

const verifyEmail_query = async (req, res, next) => {
    if (req.decoded.email === req.query.email) next()
    else return res.status(401).send({ message: "unauthorized access" })
}


async function run() {
    try {
        const userCollection = client.db("apnrghor").collection("userinfo");
        const apartmentCollection = client.db("apnrghor").collection("appartments");
        const agreementCollection = client.db("apnrghor").collection("agreements");
        const announcmentCollection = client.db("apnrghor").collection("announcment");
        const couponsCollection = client.db("apnrghor").collection("coupons");
        const paymentCollection = client.db("apnrghor").collection("payments");


        const verifyAdmin_query = async (req, res, next) => {
            const email = req.query.email;
            const filter = { email: email };
            const result = await userCollection.findOne(filter)
            if (result.role === "ADMIN") next();
            else return res.status(401).send({ message: "unauthorized access" })
        }

        const verifyAdmin_query_obj = async (req, res, next) => {
            const { email } = req.query;
            if (email === req.decoded.email) {
                const filter = { email: email };
                const result = await userCollection.findOne(filter)
                if (result.role === "ADMIN") next();
                else return res.status(401).send({ message: "unauthorized access" })
            }
            else return res.status(401).send({ message: "unauthorized access" })
        }



        app.get("/apartments", async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 6;
            const skip = (page - 1) * limit;

            const minRent = parseInt(req.query.minRent) || 0;
            const maxRent = parseInt(req.query.maxRent) || Number.MAX_SAFE_INTEGER;

            const filter = {
                available: { $ne: false },
                rent: { $gte: minRent, $lte: maxRent }
            };

            const total = await apartmentCollection.countDocuments(filter);
            const totalPages = Math.ceil(total / limit);

            const apartments = await apartmentCollection
                .find(filter)
                .skip(skip)
                .limit(limit)
                .toArray();

            res.json({ apartments, totalPages });
        });


        app.get('/user', verifyToken, async (req, res) => {
            const email = req.query;
            const result = await userCollection.findOne(email)
            res.send(result)
        })

        app.get('/agreementrqst', verifyToken, verifyEmail_query, verifyAdmin_query, async (req, res) => {
            const result = await agreementCollection.find({ status: "pending" }).toArray()
            res.send(result)
        })


        app.get('/allmembers', verifyToken, verifyEmail_query, verifyAdmin_query, async (req, res) => {
            const result = await userCollection.find({ role: "member" }).toArray()
            res.send(result)
        })


        app.get('/announcements', verifyToken, async (req, res) => {
            const result = await announcmentCollection.find().toArray()
            res.send(result)
        })

        app.get("/dashboard-stats", verifyToken, async (req, res) => {
            try {
                // 1️⃣ Users count
                const [userCounts, apartmentCounts, agreementCounts] = await Promise.all([
                    userCollection.aggregate([
                        { $match: { role: { $in: ["user", "member"] } } },
                        { $group: { _id: "$role", count: { $sum: 1 } } }
                    ]).toArray(),

                    // 2️⃣ Apartments count & available
                    apartmentCollection.aggregate([
                        {
                            $group: {
                                _id: null,
                                totalApartments: { $sum: 1 },
                                availableApartments: { $sum: { $cond: ["$available", 1, 0] } }
                            }
                        }
                    ]).toArray(),

                    // 3️⃣ Agreement/unavailable rooms count
                    apartmentCollection.countDocuments({ available: false })
                ]);

                const totalApartments = apartmentCounts[0]?.totalApartments || 0;
                const availableApartments = apartmentCounts[0]?.availableApartments || 0;
                const unavailableApartments = agreementCounts || 0;

                const stats = {
                    totalRooms: totalApartments,
                    availablePercentage:
                        totalApartments > 0
                            ? ((availableApartments / totalApartments) * 100).toFixed(2) + "%"
                            : "0%",
                    unavailablePercentage:
                        totalApartments > 0
                            ? ((unavailableApartments / totalApartments) * 100).toFixed(2) + "%"
                            : "0%",
                    users: userCounts.find((u) => u._id === "user")?.count || 0,
                    members: userCounts.find((u) => u._id === "member")?.count || 0,
                };

                res.json(stats);
            } catch (error) {
                console.error("Error fetching dashboard stats:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        });


        app.get('/specificagreement', verifyToken, verifyEmail_query, async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) {
                    return res.status(400).send({ message: "Email is required" });
                }

                const result = await agreementCollection.findOne({
                    email: email,
                    status: "checked"
                });


                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Server error", error });
            }
        });

        app.get("/coupons", async (req, res) => {
            try {
                const coupons = await couponsCollection.find().toArray();

                res.status(200).send(coupons)
            } catch (error) {
                console.error("Error fetching coupons:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        app.get('/allcoupons', async (req, res) => {
            try {
                const coupons = await couponsCollection.find().toArray();

                res.status(200).send(coupons)
            } catch (error) {
                console.error("Error fetching coupons:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        })

        app.post("/validate-coupon", verifyToken, async (req, res) => {
            try {
                const { coupon } = req.body;

                if (!coupon) {
                    return res.status(400).json({ success: false, message: "No coupon provided." });
                }

                const couponData = await couponsCollection.findOne({ code: coupon });

                if (!couponData) {
                    return res.json({ success: false, message: "Invalid coupon code." });
                }

                // Example checks: you can extend this with your own logic
                if (couponData.expired) {
                    return res.json({ success: false, message: "Coupon has expired." });
                }

                if (couponData.used) {
                    return res.json({ success: false, message: "Coupon already used." });
                }

                // ✅ Coupon is valid
                return res.json({
                    success: true,
                    message: "Coupon applied successfully!",
                    discount: couponData.discount || 0, // send discount % back
                });
            } catch (err) {
                console.error("Error validating coupon:", err);
                return res.status(500).json({ success: false, message: "Server error." });
            }
        });


        app.get('/paymenthistory', verifyToken, verifyEmail_query, async (req, res) => {
            const months = [
                "January", "February", "March", "April",
                "May", "June", "July", "August",
                "September", "October", "November", "December"
            ];
            const { email } = req.query
            const payments = await paymentCollection.aggregate([
                { $match: { email } },
                {
                    $addFields: {
                        monthIndex: { $indexOfArray: [months, "$paid_month"] }
                    }
                },
                { $sort: { paid_year: 1, monthIndex: 1 } }
            ]).toArray();

            res.send(payments);
        })

        app.post("/create-payment-intent", verifyToken, async (req, res) => {
            try {
                const { id, month, coupon } = req.body;
                const filter = { _id: new ObjectId(id) };
                const result1 = await agreementCollection.findOne(filter);
                if (!result1) {
                    return res.status(404).send({ error: "Agreement not found" });
                }

                let rentAmount = result1.rent;
                let discountApplied = 0;

                if (coupon) {
                    const couponDoc = await couponsCollection.findOne({ code: coupon });

                    if (couponDoc) {
                        discountApplied = couponDoc.discount;
                        rentAmount = Math.round(rentAmount - (rentAmount * discountApplied) / 100);
                    } else {
                        return res.send({ success: false, message: "Invalid coupon code" });
                    }
                }

                const paymentIntent = await stripe.paymentIntents.create({
                    amount: rentAmount * 100,
                    currency: "usd",
                    automatic_payment_methods: { enabled: true },
                });

                const currentYear = new Date().getFullYear();


                const newPayment = {
                    name: result1.name,
                    email: result1.email,
                    agreement_id: result1._id,
                    paymentAmount: rentAmount,
                    paid_month: month,
                    paid_year: currentYear,
                    createdAt: new Date(),
                    coupon: coupon || null,
                    discountApplied,
                };

                await paymentCollection.insertOne(newPayment);

                res.send({
                    clientSecret: paymentIntent.client_secret,
                    success: true,
                    message: discountApplied
                        ? `Coupon applied: ${discountApplied}% off. Final amount: $${rentAmount}`
                        : "Payment intent created successfully",
                });
            } catch (error) {
                console.error("Payment error:", error);
                res.status(500).send({ error: error.message });
            }
        });



        app.post("/announcment", verifyToken, verifyEmail_query, verifyAdmin_query, async (req, res) => {
            const announcment = req.body;
            const result = await announcmentCollection.insertOne(announcment);
            res.status(201).json({ message: "Announcement added successfully", announcment });
        });

        app.post("/addcoupons", async (req, res) => {
            try {
                const { code, discount, description, createdBy } = req.body;

                if (!code || !discount) {
                    return res.status(400).json({ message: "Code and discount are required" });
                }

                const newCoupon = {
                    code,
                    discount: parseFloat(discount),
                    description: description || "",
                    createdBy: createdBy || "Admin",
                    createdAt: new Date(),
                };

                const result = await couponsCollection.insertOne(newCoupon);

                res.status(201).json({
                    message: "Coupon added successfully",
                    coupon: { _id: result.insertedId, ...newCoupon },
                });
            } catch (error) {
                console.error("Error adding coupon:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        app.post('/addagreement', verifyToken, async (req, res) => {
            try {
                const { name, email, floor_no, block_name, apartment_no, rent, agreement_id } = req.body;

                const existing = await agreementCollection.findOne({ email });
                if (existing) {
                    console.log("hiii");
                    return res.status(400).json({ message: "You already applied for an apartment!" });
                }

                const newAgreement = {
                    name,
                    email,
                    floor_no,
                    block_name,
                    apartment_no,
                    rent,
                    agreement_id,
                    status: "pending",
                    createdAt: new Date(),
                };

                const filter = { _id: new ObjectId(agreement_id) }
                const update = { available: false }
                const result2 = await apartmentCollection.updateOne(filter, { $set: update })
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


                const existing = await userCollection.findOne({ email });
                if (existing) return res.status(201).send({ message: "user exists" });

                let photoURL = googlePhotoURL || null;
                let cloudinary_id = null;


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


        app.patch('/removemember', verifyToken, verifyAdmin_query_obj , async (req, res) => {
            const { id } = req.query
            const filter = { _id: new ObjectId(id) }
            const result1 = await userCollection.findOne(filter);
            const apart_id = result1.apartment_id;
            const filter1 = {_id : new ObjectId(apart_id)}
            const result2 = await apartmentCollection.updateOne(filter1 , {$set : {"available" : true}})
            const result = await userCollection.updateOne(filter, { $set: { role: "user" } })
            res.send(result)
        })

        app.patch("/acceptagreement", verifyToken, verifyEmail_query , verifyAdmin_query , async (req, res) => {
            const user_mail = req.body.email;
            const filter = { _id: new ObjectId(req.body.agree_id) }
            const update = {
                $set: { status: "checked" }
            }
            const result = await agreementCollection.findOne(filter)
            const result1 = await userCollection.updateOne({ email: user_mail }, { $set: { role: "member" , "apartment_id" : result.agreement_id } })
            const result2 = await agreementCollection.updateOne(filter, update)
            res.send(result1)

        })



        app.delete("/deleteagreement", verifyToken, verifyAdmin_query_obj, async (req, res) => {
            try {
                console.log(req.query);

                const { id } = req.query;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ error: "Invalid ID format" });
                }
                const filter = { _id: new ObjectId(id) };
                const result1 = await agreementCollection.findOne(filter);
                const apart_id = result1.agreement_id;
                const filter1 = { _id: new ObjectId(apart_id) };
                const result2 = await apartmentCollection.updateOne(filter1, { $set: { "available": true } })
                const result = await agreementCollection.deleteOne(filter);

                if (result.deletedCount === 0) {
                    return res.status(404).json({ error: "Agreement not found" });
                }

                res.json({ message: "Agreement deleted successfully", result });
            } catch (err) {
                console.error("Error deleting agreement:", err);
                res.status(500).json({ error: "Failed to delete agreement" });
            }
        });


        await client.db("admin").command({ ping: 1 });
        console.log("Connected to MongoDB!");
    } finally { }
}
run().catch(console.dir);

app.listen(port, () => console.log(`Server running on port ${port}`));
