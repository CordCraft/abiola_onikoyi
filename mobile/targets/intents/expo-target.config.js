/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "app-intent",
  name: "JarvisIntents",
  bundleIdentifier: ".intents",
  deploymentTarget: "18.0",
  frameworks: ["AppIntents", "WidgetKit"],
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
  },
});
