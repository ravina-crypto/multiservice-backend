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

// ✅ Initialize Firebase Admin SDK
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

// Add money
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
    res.json({ success: true, message: "Money added to wallet" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Pay with wallet
app.post("/wallet/pay", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const walletRef = db.collection("wallets").doc(userId);
    const walletDoc = await walletRef.get();

    if (!walletDoc.exists || walletDoc.data().balance < amount) {
      return res
        .status(400)
        .json({ success: false, message: "Insufficient balance" });
    }

    await walletRef.update({
      balance: admin.firestore.FieldValue.increment(-amount),
      transactions: admin.firestore.FieldValue.arrayUnion({
        type: "debit",
        amount,
        timestamp: new Date(),
      }),
    });

    res.json({ success: true, message: "Payment successful via wallet" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Wallet history
app.get("/wallet/:userId", async (req, res) => {
  try {
    const walletDoc = await db.collection("wallets").doc(req.params.userId).get();
    res.json(walletDoc.exists ? walletDoc.data() : { balance: 0, transactions: [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- ORDER APIs ----------------

// Create new order
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

// Update order
app.post("/orders/update", async (req, res) => {
  try {
    const { orderId, status } = req.body;
    const orderRef = db.collection("orders").doc(orderId);

    await orderRef.update({ status });

    // push notification if FCM token exists
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

    res.json({ success: true, message: "Order status updated" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- PAYMENT APIs ----------------

// Create Razorpay order
app.post("/order", async (req, res) => {
  try {
    const options = {
      amount: req.body.amount * 100, // in paise
      currency: "INR",
      receipt: "receipt_" + Date.now(),
    };
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (err) {
    res.status(500).send(err);
  }
});

// Verify payment
app.post("/payment/verify", async (req, res) => {
  try {
    const { orderId, paymentId, signature, customerId } = req.body;

    await db.collection("payments").doc(paymentId).set({
      orderId,
      paymentId,
      signature,
      customerId,
      status: "Verified",
      createdAt: new Date(),
    });

    await db.collection("orders").doc(orderId).update({ status: "Paid" });

    res.json({ success: true, message: "Payment verified" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- AUTH APIs ----------------

// Signup
app.post("/signup", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    const userRecord = await admin.auth().createUser({
      email,
      password,
    });

    await db.collection("users").doc(userRecord.uid).set({
      email,
      role,
      createdAt: new Date(),
    });

    res.json({ success: true, userId: userRecord.uid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { idToken } = req.body;

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userDoc = await db.collection("users").doc(decodedToken.uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    res.json({
      success: true,
      userId: decodedToken.uid,
      role: userDoc.data().role,
    });
  } catch (err) {
    res.status(401).json({ success: false, error: "Invalid token" });
  }
});

// ---------------- START SERVER ----------------

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Backend running on port ${PORT}`)
);
