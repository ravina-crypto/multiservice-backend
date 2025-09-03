// server.js (multiservice-backend)

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import Razorpay from "razorpay";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ Initialize Firebase Admin SDK with ENV vars
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

// ✅ Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});


// ---------------- WALLET APIs ----------------

// ➕ Add money to wallet
app.post("/wallet/add", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const walletRef = db.collection("wallets").doc(userId);

    await walletRef.set(
      {
        balance: admin.firestore.FieldValue.increment(amount),
        transactions: admin.firestore.FieldValue.arrayUnion({
          type: "credit",
          amount,
          timestamp: new Date(),
        }),
      },
      { merge: true }
    );

    res.json({ success: true, message: "Money added to wallet ✅" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 💳 Pay with wallet
app.post("/wallet/pay", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const walletRef = db.collection("wallets").doc(userId);
    const walletDoc = await walletRef.get();

    if (!walletDoc.exists || walletDoc.data().balance < amount) {
      return res
        .status(400)
        .json({ success: false, message: "Insufficient balance ❌" });
    }

    await walletRef.update({
      balance: admin.firestore.FieldValue.increment(-amount),
      transactions: admin.firestore.FieldValue.arrayUnion({
        type: "debit",
        amount,
        timestamp: new Date(),
      }),
    });

    res.json({ success: true, message: "Payment successful via wallet ✅" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📜 Wallet history
app.get("/wallet/:userId", async (req, res) => {
  try {
    const walletDoc = await db
      .collection("wallets")
      .doc(req.params.userId)
      .get();
    res.json(walletDoc.exists ? walletDoc.data() : { balance: 0, transactions: [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ---------------- ORDER APIs ----------------

// ➕ Create new order
app.post("/orders", async (req, res) => {
  try {
    const { customerId, service, amount, address } = req.body;
    const orderRef = db.collection("orders").doc();

    await orderRef.set({
      id: orderRef.id,
      customerId,
      service,
      amount,
      address,
      status: "PendingPayment",
      createdAt: new Date(),
    });

    res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔄 Update order
app.post("/orders/update", async (req, res) => {
  try {
    const { orderId, status } = req.body;
    const orderRef = db.collection("orders").doc(orderId);

    await orderRef.update({ status });

    // Push notification
    const orderDoc = await orderRef.get();
    const customerId = orderDoc.data().customerId;
    const userDoc = await db.collection("users").doc(customerId).get();

    if (userDoc.exists && userDoc.data().fcmToken) {
      await admin.messaging().send({
        token: userDoc.data().fcmToken,
        notification: {
          title: "Order Update",
          body: `Your order is now ${status}`,
        },
      });
    }

    res.json({ success: true, message: "Order status updated ✅" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ---------------- PAYMENT APIs ----------------

// 💰 Create Razorpay order
app.post("/payment/order", async (req, res) => {
  try {
    const options = {
      amount: req.body.amount * 100, // amount in paise
      currency: "INR",
      receipt: "receipt_" + Date.now(),
    };
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Verify payment
app.post("/payment/verify", async (req, res) => {
  try {
    const { orderId, paymentId, signature, customerId } = req.body;

    // Save payment record
    await db.collection("payments").doc(paymentId).set({
      orderId,
      paymentId,
      signature,
      customerId,
      status: "Verified",
      createdAt: new Date(),
    });

    // Update order status
    await db.collection("orders").doc(orderId).update({ status: "Paid" });

    res.json({ success: true, message: "Payment verified ✅" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ---------------- HEALTH CHECK ----------------
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Backend is running ✅" });
});


// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Backend running on port ${PORT}`)
);
