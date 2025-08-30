const admin = require("firebase-admin");

// Initialize Firebase Admin SDK (only once)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(), // or use serviceAccountKey.json
  });
}

const db = admin.firestore();

/**
 * Send notification to a specific user
 * @param {string} userId - Firestore userId
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 */
async function sendNotification(userId, title, body) {
  try {
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      console.log("⚠️ No user found with ID:", userId);
      return;
    }

    const fcmToken = userDoc.data().fcmToken;
    if (!fcmToken) {
      console.log("⚠️ No FCM token for user:", userId);
      return;
    }

    const message = {
      token: fcmToken,
      notification: { title, body },
    };

    const response = await admin.messaging().send(message);
    console.log("✅ Notification sent:", response);
  } catch (err) {
    console.error("❌ Error sending notification:", err);
  }
}

module.exports = { sendNotification };
