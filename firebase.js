// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAA9oMvrsKbsixFBgJ5MlZuHdriVBcG4hA",
  authDomain: "financas-4f348.firebaseapp.com",
  projectId: "financas-4f348",
  storageBucket: "financas-4f348.firebasestorage.app",
  messagingSenderId: "521022969270",
  appId: "1:521022969270:web:aa68de175296674d35dd17",
  measurementId: "G-1ENMQQ30RZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
