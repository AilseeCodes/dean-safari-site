import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";

// --- Dev Project (deansafaris.web.app) ---
const devConfig = {
  apiKey: "AIzaSyAG9JrHVqV4T3w8YIzAv3M-dN7XnUlpiiE",
  authDomain: "deansafaris.firebaseapp.com",
  projectId: "deansafaris",
  storageBucket: "deansafaris.firebasestorage.app",
  messagingSenderId: "50167362777",
  appId: "1:50167362777:web:388fcd076ef5ee98b57ac8",
  measurementId: "G-NXJL9Q094Q"
};

// --- Live Production Project (deanmcgregorsafaris.com) ---
const liveConfig = {
  apiKey: "AIzaSyClvClEbfANTOn9_V7t0wRXM9kXpSf3Q84",
  authDomain: "deanmcgregorsafaris-live.firebaseapp.com",
  projectId: "deanmcgregorsafaris-live",
  storageBucket: "deanmcgregorsafaris-live.firebasestorage.app",
  messagingSenderId: "223876102508",
  appId: "1:223876102508:web:0abca4ad4431c1b368db49"
};

// Select the correct config based on the current hostname — no network request needed.
// This is synchronous and works on ALL browsers including iOS 9+.
const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLiveSite = hostname.includes('deanmcgregorsafaris') || hostname.includes('mcgregorsafaris');

export const app = initializeApp(isLiveSite ? liveConfig : devConfig);

