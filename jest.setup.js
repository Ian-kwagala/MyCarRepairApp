/* global jest */
// Runs before every Jest test file. Replaces native Expo modules (which can't run in Node) with small fakes
// so the local data store and utilities can be tested without a device.

// In-memory AsyncStorage.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Deterministic crypto for the local data store.
jest.mock('expo-crypto', () => {
  let n = 0;
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_alg, value) => `hash:${value}`,
    randomUUID: () => `uuid-${++n}`,
    getRandomBytes: (len) => Uint8Array.from({ length: len }, (_, i) => (i * 7 + n++) % 256),
  };
});

// PDF receipts, image resizing, the photo picker and the file system are stubbed: tests only need them to exist.
jest.mock('expo-print', () => ({ printToFileAsync: async () => ({ uri: 'file:///receipt.pdf' }), printAsync: async () => {} }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: () => ({}) }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///doc' },
  Directory: class {
    exists = true;
    create() {}
  },
  File: class {
    constructor(dir, name) {
      this.uri = typeof dir === 'string' ? dir : `file:///doc/photos/${name}`;
    }
    copy() {}
  },
}));
