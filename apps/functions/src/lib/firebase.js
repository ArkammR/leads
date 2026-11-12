const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

module.exports = { admin, db, FieldValue, Timestamp };
