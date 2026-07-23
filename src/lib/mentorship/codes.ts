import "server-only";
import { randomInt } from "crypto";

// Unambiguous alphabet (no 0/O, 1/I/L) so codes survive being read aloud or
// retyped from a WhatsApp message.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateAccessCode(): string {
  let raw = "";
  for (let i = 0; i < 8; i++) {
    raw += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Normalize whatever the mentee typed: trim, uppercase, tolerate a missing or
// misplaced hyphen.
export function normalizeAccessCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== 8) return input.trim().toUpperCase();
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}
