"use server";

import { verifySession } from "@/lib/dal";
import { listDevices, pairDevice, revokeDevice } from "@/lib/jarvis/mobile-devices";

export type DeviceRow = { id: string; name: string; createdAt: string };

export async function listMobileDevices(): Promise<DeviceRow[]> {
  await verifySession();
  return (await listDevices()).map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt }));
}

// Returns the device token once; it is never stored or shown again.
export async function pairMobileDevice(name: string): Promise<{ token: string; devices: DeviceRow[] }> {
  const { user } = await verifySession();
  const { token } = await pairDevice(user, name);
  return { token, devices: await listMobileDevices() };
}

export async function revokeMobileDevice(id: string): Promise<DeviceRow[]> {
  await verifySession();
  await revokeDevice(id);
  return listMobileDevices();
}
