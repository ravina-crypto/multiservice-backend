const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");

require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(), // or serviceAccountKey.json
  });
}
const db = admin.firestore();

// ✅ Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ✅ Health check
app.get("/", (req, res) => {
  res.send("✅ Backend running successfully!");
});

// ✅ Create Razorpay order
app.post("/order", async (req, res) => {
  try {
    const options = {
      amount: req.body.amount * 100, // in paise
      currency: "INR",
      receipt: "receipt_" + Date.now(),
    };
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating Razorpay order");
  }
});

// ✅ Verify Razorpay Payment & Update Firestore Order
app.post("/payment/verify", async (req, res) => {
  try {
    const { orderId, paymentId, signature, customerId } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: "Invalid payment" });
    }

    // Find pending payment order for this customer
    const snapshot = await db
      .collection("orders")
      .where("customerId", "==", customerId)
      .where("status", "==", "PendingPayment")
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "Order not found for update" });
    }

    const orderDoc = snapshot.docs[0].ref;

    // Update status after successful payment
    await orderDoc.update({
      status: "Pending", // Tailor can start now
      paymentId,
    });

    // Notify user
    await axios.post(`${process.env.NOTIFY_URL}/notify`, {
      userId: customerId,
      title: "💳 Payment Successful",
      body: "Your payment was received! Tailor will start soon.",
    });

    res.json({ success: true, message: "Payment verified & order updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Payment verification failed" });
  }
});

// ✅ Create new tailoring order
app.post("/orders", async (req, res) => {
  try {
    const { customerId, service, amount, address } = req.body;

    const newOrder = {
      customerId,
      service,
      amount,
      address,
      status: "PendingPayment", // First wait for payment
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection("orders").add(newOrder);
    res.json({ id: docRef.id, ...newOrder });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error creating order" });
  }
});

// ✅ Fetch all orders (Tailor/Delivery use this)
app.get("/orders", async (req, res) => {
  try {
    const snapshot = await db.collection("orders").get();
    const orders = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching orders" });
  }
});

// ✅ Fetch orders of a specific customer
app.get("/orders/customer/:customerId", async (req, res) => {
  try {
    const snapshot = await db
      .collection("orders")
      .where("customerId", "==", req.params.customerId)
      .get();

    const orders = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching customer orders" });
  }
});

// ✅ Update order status (Tailor/Delivery use this)
app.put("/orders/:id", async (req, res) => {
  try {
    const { status } = req.body;
    const orderRef = db.collection("orders").doc(req.params.id);

    await orderRef.update({ status });

    res.json({ id: req.params.id, status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error updating order status" });
  }
});

// ✅ Notify customer via FCM
app.post("/notify", async (req, res) => {
  try {
    const { userId, title, body } = req.body;

    if (!userId || !title || !body) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // Fetch customer's FCM token
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists || !userDoc.data().fcmToken) {
      return res.status(404).json({ error: "No FCM token found for user" });
    }

    const fcmToken = userDoc.data().fcmToken;

    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
    };

    await admin.messaging().send(message);

    res.json({ success: true, message: "📩 Notification sent!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
