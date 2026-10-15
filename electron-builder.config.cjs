const { chmod, copyFile, rename } = require("node:fs/promises");
const { resolve } = require("node:path");

module.exports = {
  appId: "com.kelmankenberg.khinsiderdownloader",
  productName: "Khinsider Downloader",
  executableName: "khinsider-downloader",
  directories: { output: "release", buildResources: "assets" },
  asar: true,
  npmRebuild: false,
  files: ["dist/**/*", "package.json"],
  extraResources: [{ from: ".packaging/chromium", to: "chromium" }],
  linux: {
    syncDesktopName: true,
    target: ["deb", "AppImage", "pacman"],
    icon: "assets/khinsider-downloader.png",
    category: "AudioVideo",
    synopsis: "Download public KHInsider soundtrack tracks",
    desktop: { entry: { Name: "Khinsider Downloader", StartupWMClass: "khinsider-downloader", Terminal: "false" } },
    artifactName: "Khinsider-Downloader-${version}-${arch}.${ext}",
  },
  deb: {
    packageName: "khinsider-downloader",
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
  pacman: {
    packageName: "khinsider-downloader",
    compression: "xz",
    artifactName: "Khinsider-Downloader-${version}-x86_64.pkg.tar.xz",
    depends: [
      "glibc", "gcc-libs", "gtk3", "libnotify", "nss", "nspr", "libxss", "libxtst",
      "xdg-utils", "at-spi2-core", "util-linux-libs", "libsecret", "alsa-lib", "mesa",
      "libxkbcommon", "libdrm", "libxcomposite", "libxdamage", "libxrandr", "libxfixes",
      "libx11", "libxcb", "libxext", "libxrender", "libcups", "pango", "cairo", "dbus",
      "expat", "glib2",
    ],
  },
  afterPack: async ({ appOutDir, electronPlatformName }) => {
    if (electronPlatformName !== "linux") return;
    await rename(resolve(appOutDir, "khinsider-downloader"), resolve(appOutDir, "khinsider-downloader-bin"));
    await copyFile(resolve(__dirname, "scripts/linux-launcher.sh"), resolve(appOutDir, "khinsider-downloader"));
    await chmod(resolve(appOutDir, "khinsider-downloader"), 0o755);
  },
};