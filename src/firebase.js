import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyBRmv_kptYpKKi67QE83RSG9oUsLQcFnZY',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'edigix-quizz.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'edigix-quizz',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'edigix-quizz.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '193610142918',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:193610142918:web:a972b31d9d8d7c40d173c7',
}

const hasValidConfig = Object.values(firebaseConfig).every(Boolean)
const app = hasValidConfig ? initializeApp(firebaseConfig) : null
const secondaryApp = hasValidConfig ? initializeApp(firebaseConfig, 'student-auth-app') : null

export const auth = app ? getAuth(app) : null
export const studentAuth = secondaryApp ? getAuth(secondaryApp) : null
export const db = app ? getFirestore(app) : null
export const studentDb = secondaryApp ? getFirestore(secondaryApp) : null
export const isFirebaseReady = Boolean(app && auth && studentAuth && db && studentDb)
