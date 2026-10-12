const { chmod, copyFile, rename } = require("node:fs/promises");
const { resolve } = require("node:path");

module.exports = {
  appId: "com.kelmankenberg.kdownloader",
  productName: "K-Downloader",
  executableName: "k-downloader",
  directories: { output: "release", buildResources: "assets" },
  asar: true,
  npmRebuild: false,
  files: ["dist/**/*", "package.json"],
  extraResources: [{ from: ".packaging/chromium", to: "chromium" }],
  linux: {
    syncDesktopName: true,
    target: ["deb", "AppImage"],
    icon: "assets/k-downloader.png",
    category: "AudioVideo",
    synopsis: "Download public KHInsider soundtrack tracks",
    desktop: { entry: { Name: "K-Downloader", StartupWMClass: "k-downloader", Terminal: "false" } },
    artifactName: "K-Downloader-${version}-${arch}.${ext}",
  },
  deb: {
    packageName: "k-downloader",
    compression: "gz",
    recommends: [],
    depends: [
      "libc6 (>= 2.35)", "libgtk-3-0 | libgtk-3-0t64", "libnotify4", "libnss3", "libnspr4",
      "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0 | libatspi2.0-0t64", "libuuid1",
      "libsecret-1-0", "libasound2 | libasound2t64", "libgbm1", "libxkbcommon0", "libdrm2",
      "libxcomposite1", "libxdamage1", "libxrandr2", "libxfixes3", "libx11-6", "libxcb1",
      "libxext6", "libxrender1", "libcups2 | libcups2t64", "libpango-1.0-0", "libcairo2",
    ],
  },
  afterPack: async ({ appOutDir, electronPlatformName }) => {
    if (electronPlatformName !== "linux") return;
    await rename(resolve(appOutDir, "k-downloader"), resolve(appOutDir, "k-downloader-bin"));
    await copyFile(resolve(__dirname, "scripts/linux-launcher.sh"), resolve(appOutDir, "k-downloader"));
    await chmod(resolve(appOutDir, "k-downloader"), 0o755);
  },
};