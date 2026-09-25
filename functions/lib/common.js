const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Verifies the caller's Firebase ID token and returns their uid, or throws.
// Every endpoint that touches per-user data requires this.
async function requireUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    const err = new Error('Missing Authorization bearer token');
    err.statusCode = 401;
    throw err;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid;
  } catch (e) {
    const err = new Error('Invalid or expired auth token');
    err.statusCode = 401;
    throw err;
  }
}

module.exports = { admin, db, requireUser };
