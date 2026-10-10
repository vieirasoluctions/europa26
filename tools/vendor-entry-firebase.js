export { initializeApp } from 'firebase/app';
export { connectAuthEmulator } from 'firebase/auth';
export { connectFirestoreEmulator } from 'firebase/firestore';
export { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
export { initializeFirestore, memoryLocalCache, doc, collection, setDoc, deleteDoc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
