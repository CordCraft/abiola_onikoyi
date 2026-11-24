// The app lives inside the website repo, whose own node_modules (Next.js,
// another React) sit one level up. Look in mobile/node_modules first; nested
// package folders still resolve normally.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

module.exports = config;
