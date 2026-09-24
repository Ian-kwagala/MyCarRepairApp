/* global jest */
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
  };
});

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
