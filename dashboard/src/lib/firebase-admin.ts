import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import serviceAccount from './service.json';

// Initialize Firebase Admin only if not already initialized
const adminApp = getApps().length === 0
  ? initializeApp({ credential: cert(serviceAccount as any) })
  : getApps()[0];

export const adminDb = getFirestore(adminApp);
export default adminApp;
