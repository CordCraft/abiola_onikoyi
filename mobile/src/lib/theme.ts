import { useColorScheme } from "react-native";

// Navy and teal from the AO mark.
const light = {
  bg: "#F4F6FA",
  card: "#FFFFFF",
  text: "#0E1B3D",
  muted: "#5B6478",
  border: "#E1E5EE",
  accent: "#1C9C9C",
  navy: "#14234B",
  danger: "#C0392B",
  warn: "#B7791F",
};

const dark: typeof light = {
  bg: "#0A1020",
  card: "#131C33",
  text: "#EEF2FA",
  muted: "#97A1B8",
  border: "#24304D",
  accent: "#2EC4C4",
  navy: "#C9D4F2",
  danger: "#F07167",
  warn: "#F2C14E",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
