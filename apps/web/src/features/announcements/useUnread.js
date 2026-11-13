import { collection, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";

// Announcements this person hasn't seen (newer than users/{uid}.announcementsSeenAt), for their role.
export function useUnreadAnnouncements(profile) {
  const { data } = useLive(() => query(collection(db, "announcements"), where("isActive", "==", true)), []);
  const seen = profile.announcementsSeenAt?.toMillis?.() || 0;
  return data
    .filter((a) => a.audience === "all" || a.audience === profile.role)
    .filter((a) => (a.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER) > seen && a.by !== profile.id)
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}
