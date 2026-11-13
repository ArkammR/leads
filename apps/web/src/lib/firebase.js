import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

const e = import.meta.env;
const cfg = {
  apiKey: e.VITE_FIREBASE_API_KEY,
  authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: e.VITE_FIREBASE_PROJECT_ID,
  storageBucket: e.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: e.VITE_FIREBASE_APP_ID,
};

// The UI still renders (with a setup notice) until the project ID is filled in.
export const configured = Boolean(cfg.projectId && cfg.apiKey);

let app = null, auth = null, db = null, fns = null;
if (configured) {
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);
  fns = getFunctions(app, e.VITE_FUNCTIONS_REGION || "us-central1");
  if (e.VITE_USE_EMULATORS === "true") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099");
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  }
}
export { auth, db };

const call = (name) => async (data) => (await httpsCallable(fns, name)(data)).data;
export const api = Object.fromEntries(
  ["createUser", "setActive", "saveProduct", "adjustStock", "importLeads", "updateLeadStatus", "createOrder", "verifyOrder", "resolveAlert", "saveExpense", "recordRemittance", "setCommission", "payCommissions", "cancelOrder", "reassignLeads",
    "clockAction", "setTarget", "saveTask", "setTaskStatus", "postAnnouncement", "markAnnouncementsRead",
    "listCouriers", "saveCourierConfig", "saveShippingSettings", "updateShipTo", "bookShipments", "clearShipment", "syncShipments", "setShipmentStatus", "markWaybillsPrinted", "saveLeadSource", "rotateLeadSourceKey", "startMetaConnect"]
    .map((n) => [n, call(n)])
);
