/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
// "Jarvis" in the iPhone share sheet: share a screenshot of a song (or a
// YouTube Music link) and Jarvis saves it and writes your Suno version.
module.exports = (config) => ({
  type: "share",
  name: "JarvisShare",
  displayName: "Jarvis",
  bundleIdentifier: ".share",
  deploymentTarget: "18.0",
  frameworks: ["UIKit", "SwiftUI", "UniformTypeIdentifiers", "AppIntents", "WidgetKit"],
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
  },
});
