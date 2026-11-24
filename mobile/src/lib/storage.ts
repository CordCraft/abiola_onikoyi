import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { ExtensionStorage } from "@bacons/apple-targets";

// The device token lives in the Keychain for the app. The widget and Siri
// extensions cannot read the app's Keychain item, so the token and host are
// mirrored into the shared App Group, which only this app's targets can read.

const extra = (Constants.expoConfig?.extra ?? {}) as { appGroup?: string; defaultHost?: string };
export const APP_GROUP = extra.appGroup ?? "group.com.abiolaonikoyi.jarvis";
export const DEFAULT_HOST = extra.defaultHost ?? "https://abiolaonikoyi.com";

const shared = new ExtensionStorage(APP_GROUP);

export type Pairing = { token: string; host: string };

export async function loadPairing(): Promise<Pairing | null> {
  const token = await SecureStore.getItemAsync("jarvis.token");
  if (!token) return null;
  const host = (await SecureStore.getItemAsync("jarvis.host")) ?? DEFAULT_HOST;
  mirror({ token, host }); // keep the extensions in sync after reinstalls
  return { token, host };
}

export async function savePairing(p: Pairing): Promise<void> {
  await SecureStore.setItemAsync("jarvis.token", p.token);
  await SecureStore.setItemAsync("jarvis.host", p.host);
  mirror(p);
}

export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync("jarvis.token");
  await SecureStore.deleteItemAsync("jarvis.host");
  shared.remove("token");
  shared.remove("host");
  shared.remove("today");
  ExtensionStorage.reloadWidget();
}

function mirror(p: Pairing) {
  shared.set("token", p.token);
  shared.set("host", p.host);
}

// The widget shows this cached copy instantly and refreshes it itself.
export function shareToday(json: string) {
  shared.set("today", json);
  ExtensionStorage.reloadWidget();
}

// Small preferences (not secret)
export async function getPref(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(`pref.${key}`);
}
export async function setPref(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(`pref.${key}`, value);
}
