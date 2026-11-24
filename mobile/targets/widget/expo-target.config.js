/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "JarvisWidget",
  displayName: "Jarvis",
  bundleIdentifier: ".widget",
  deploymentTarget: "18.0",
  frameworks: ["SwiftUI", "WidgetKit", "AppIntents"],
  colors: {
    $accent: { color: "#1C9C9C", darkColor: "#2EC4C4" },
    $widgetBackground: { color: "#FFFFFF", darkColor: "#0A1020" },
    navy: { color: "#14234B", darkColor: "#C9D4F2" },
    danger: { color: "#C0392B", darkColor: "#F07167" },
  },
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
  },
});
