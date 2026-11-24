import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { encryptDeviceToken } from "@/lib/jwt";

// Paired iPhone app installs. Each pairing mints a long-lived device token
// (see encryptDeviceToken); removing the device here revokes it, because
// getSession() checks the list on every Bearer request.
// Stored in JarvisSetting so no new table is needed.

export type MobileDevice = {
  id: string;
  name: string;
  createdAt: string;
};

const KEY = "mobile_devices";

export async function listDevices(): Promise<MobileDevice[]> {
  const row = await prisma.jarvisSetting.findUnique({ where: { key: KEY } });
  try {
    const parsed = row ? JSON.parse(row.value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveDevices(devices: MobileDevice[]): Promise<void> {
  const value = JSON.stringify(devices);
  await prisma.jarvisSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export async function isDeviceActive(id: string): Promise<boolean> {
  return (await listDevices()).some((d) => d.id === id);
}

export async function pairDevice(user: string, name: string): Promise<{ device: MobileDevice; token: string }> {
  const device: MobileDevice = {
    id: randomUUID(),
    name: name.trim().slice(0, 60) || "iPhone",
    createdAt: new Date().toISOString(),
  };
  await saveDevices([...(await listDevices()), device]);
  const expiresAt = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString();
  const token = await encryptDeviceToken({ user, expiresAt, dev: device.id });
  return { device, token };
}

export async function revokeDevice(id: string): Promise<void> {
  await saveDevices((await listDevices()).filter((d) => d.id !== id));
}
