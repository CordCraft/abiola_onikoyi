// Native Swift for the widget, Control Center buttons and Siri intents lives in
// targets/ (@bacons/apple-targets), outside ios/. Without this the fingerprint
// ignores Swift edits and the Jarvis iOS workflow ships an OTA update instead
// of a new TestFlight build.
/** @type {import('expo/fingerprint').Config} */
const config = {
  extraSources: [{ type: "dir", filePath: "targets", reasons: ["apple-targets"] }],
};
module.exports = config;
