import "server-only";
import { COMMS_OPTIONS } from "@/lib/mentorship/constants";

// Shared parsing/validation for the profile fields collected at onboarding
// and edited later on the portal profile page.

export type ProfileFields = {
  phone: string | null;
  linkedin: string | null;
  level: string | null;
  gradYear: string | null;
  interests: string | null;
  backgroundStory: string | null;
  skills: string | null;
  dreamRoles: string | null;
  aspirations: string | null;
  longTermVision: string | null;
  expectations: string | null;
  challenges: string | null;
  availability: string | null;
  commsPref: string | null;
};

const MAX_SHORT = 200;
const MAX_LONG = 2000;
// Browser-side compression targets well under this; the cap only guards
// against hand-crafted oversized payloads (Netlify bodies are ~6MB anyway).
export const MAX_PHOTO_CHARS = 900_000;

function short(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, MAX_SHORT) : null;
}

function long(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, MAX_LONG) : null;
}

export function parseProfileFields(formData: FormData): ProfileFields {
  const commsRaw = String(formData.get("commsPref") ?? "");
  const commsPref = COMMS_OPTIONS.some((c) => c.value === commsRaw)
    ? commsRaw
    : null;

  const linkedinRaw = short(formData.get("linkedin"));
  const linkedin =
    linkedinRaw && !/^https?:\/\//.test(linkedinRaw)
      ? `https://${linkedinRaw}`
      : linkedinRaw;

  return {
    phone: short(formData.get("phone")),
    linkedin,
    level: short(formData.get("level")),
    gradYear: short(formData.get("gradYear")),
    interests: short(formData.get("interests")),
    backgroundStory: long(formData.get("backgroundStory")),
    skills: long(formData.get("skills")),
    dreamRoles: long(formData.get("dreamRoles")),
    aspirations: long(formData.get("aspirations")),
    longTermVision: long(formData.get("longTermVision")),
    expectations: long(formData.get("expectations")),
    challenges: long(formData.get("challenges")),
    availability: short(formData.get("availability")),
    commsPref,
  };
}

// Accepts only the data-URL shape the wizard produces.
export function validatePhotoData(value: string): string | null {
  if (!value) return null;
  if (!value.startsWith("data:image/jpeg;base64,")) return null;
  if (value.length > MAX_PHOTO_CHARS) return null;
  return value;
}
