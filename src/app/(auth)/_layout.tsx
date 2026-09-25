// Navigation stack for the signed-out screens (welcome, sign in, sign up, forgot password).
import { Stack } from 'expo-router';

// Start on the welcome screen so "back" from sign-in lands there.
export const unstable_settings = { initialRouteName: 'welcome' };

/** Stack of sign-in screens with no header (each screen draws its own). */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
