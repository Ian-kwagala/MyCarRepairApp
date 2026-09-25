import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

// Tracks whether the phone currently has an internet connection.

/** True while the device is online. Starts as true and treats "unknown" as online, so nothing is blocked while it checks. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(
    // addEventListener returns the unsubscribe function, which React calls on unmount.
    () =>
      NetInfo.addEventListener((s) => {
        setOnline(s.isConnected !== false && s.isInternetReachable !== false);
      }),
    [],
  );
  return online;
}
