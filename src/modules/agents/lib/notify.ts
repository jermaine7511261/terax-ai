import {
  isNotificationGranted,
  requestNotificationPermission,
  sendNotification,
} from "@/platform";

let granted = false;

async function ensurePermission(): Promise<boolean> {
  // Cache only the positive result: a transient denial (e.g. the OS prompt
  // dismissed while unfocused) must not disable notifications for the session.
  if (granted) return true;
  let ok = await isNotificationGranted();
  if (!ok) ok = await requestNotificationPermission();
  granted = ok;
  return ok;
}

export async function osNotify(title: string, body: string): Promise<void> {
  try {
    if (await ensurePermission()) sendNotification({ title, body });
  } catch (e) {
    console.warn("[yamet] os notification failed:", e);
  }
}
