import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBAfQyphiBW_LOxaqHuqFKhXv5c8y5Lrd8",
  authDomain: "dars-4e5d0.firebaseapp.com",
  projectId: "dars-4e5d0",
  storageBucket: "dars-4e5d0.firebasestorage.app",
  messagingSenderId: "265945958214",
  appId: "1:265945958214:web:b9e1c524f29f6a3c608747",
  measurementId: "G-TGJFGQNH7Y",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export default app;
