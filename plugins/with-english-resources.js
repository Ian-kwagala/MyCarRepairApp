// Keep only English (the app's only language) in the APK's resource table. Android libraries ship their
// strings in ~100 languages; dropping them saves about 1 MB per APK (NFR10 size budget).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = 'androidResources {';

module.exports = function withEnglishResources(config) {
  return withAppBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults.contents;
    if (gradle.includes('localeFilters')) return cfg;
    if (!gradle.includes(MARKER)) throw new Error('with-english-resources: no androidResources block in app/build.gradle');
    cfg.modResults.contents = gradle.replace(MARKER, `${MARKER}\n        localeFilters.add('en')`);
    return cfg;
  });
};
