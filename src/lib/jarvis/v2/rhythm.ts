export type Rhythm = {
  tz: string;
  workdays: string[];
  workStart: string;
  workEnd: string;
  familyStart: string;
  familyEnd: string;
  quietStart: string;
  quietEnd: string;
  maxPushesPerDay: number;
  maxPushesPerHour: number;
  // v3: always on. Important items get through at any hour; the rest wait for the digest.
  alwaysOn: boolean;
  familyThreshold: number; // minimum score that interrupts family time
  quietThreshold: number; // minimum score that interrupts quiet hours
  stopWorkPush: boolean; // send the "time to stop work" push
};

// Must match DEFAULT_RHYTHM in services/listener/src/context.js.
export const RHYTHM_DEFAULTS: Rhythm = {
  tz: "Asia/Kuwait",
  workdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"],
  workStart: "08:00",
  workEnd: "18:00",
  familyStart: "18:30",
  familyEnd: "21:30",
  quietStart: "22:30",
  quietEnd: "06:30",
  maxPushesPerDay: 40,
  maxPushesPerHour: 8,
  alwaysOn: true,
  familyThreshold: 70,
  quietThreshold: 70,
  stopWorkPush: false,
};
