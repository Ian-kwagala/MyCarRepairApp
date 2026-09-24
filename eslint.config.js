// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "server/*", "android/*", "ios/*"],
  },
  {
    // Package entry points that bundle far more than the app uses (APK size, see the files named below).
    ignores: ["src/components/icons.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "lucide-react-native", message: "Import icons from '@/components/icons' (add new ones there)." },
          { name: "@expo-google-fonts/inter", message: "Import a single weight, e.g. '@expo-google-fonts/inter/400Regular'." },
          { name: "@expo-google-fonts/space-grotesk", message: "Import a single weight, e.g. '@expo-google-fonts/space-grotesk/700Bold'." },
        ],
      }],
    },
  },
]);
