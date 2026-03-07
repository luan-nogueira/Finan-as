import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAA9oMvrsKbsixFBgJ5MlZuHdriVBcG4hA",
  authDomain: "financas-4f348.firebaseapp.com",
  projectId: "financas-4f348",
  storageBucket: "financas-4f348.firebasestorage.app",
  messagingSenderId: "521022969270",
  appId: "1:521022969270:web:aa68de175296674d35dd17"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
