import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const config = require(resolve(root, "electron-builder.config.cjs"));

export function renderAurFiles(version, checksum) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("AUR generation requires a stable numeric release version (for example 0.1.0).");
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error("AUR generation requires a SHA-256 checksum, not SKIP.");
  const archive = `K-Downloader-${version}-x86_64.pkg.tar.xz`;
  const source = `https://github.com/kelmankenberg/K-Downloader/releases/download/v${version}/${archive}`;
  const dependencies = config.pacman.depends;
  const pkgbuild = `pkgname=k-downloader-bin
pkgver=${version}
pkgrel=1
pkgdesc='Linux desktop downloader for public KHInsider album tracks'
arch=('x86_64')
url='https://github.com/kelmankenberg/K-Downloader'
license=('LicenseRef-Proprietary')
depends=(${dependencies.map((dependency) => `'${dependency}'`).join(" ")})
makedepends=('libarchive')
provides=("k-downloader=$pkgver")
conflicts=('k-downloader')
options=('!strip' '!debug')
source_x86_64=('${source}')
sha256sums_x86_64=('${checksum}')
noextract=('${archive}')

package() {
  bsdtar --no-same-owner --exclude='.PKGINFO' --exclude='.BUILDINFO' --exclude='.MTREE' --exclude='.INSTALL' -xf "$srcdir/${archive}" -C "$pkgdir"
  install -dm755 "$pkgdir/usr/bin"
  ln -s '/opt/K-Downloader/k-downloader' "$pkgdir/usr/bin/k-downloader"
  chmod 4755 "$pkgdir/opt/K-Downloader/chrome-sandbox"
}
`;
  const srcinfo = `pkgbase = k-downloader-bin
\tpkgdesc = Linux desktop downloader for public KHInsider album tracks
\tpkgver = ${version}
\tpkgrel = 1
\turl = https://github.com/kelmankenberg/K-Downloader
\tarch = x86_64
\tlicense = LicenseRef-Proprietary
\tmakedepends = libarchive
${dependencies.map((dependency) => `\tdepends = ${dependency}`).join("\n")}
\tprovides = k-downloader=${version}
\tconflicts = k-downloader
\toptions = !strip
\toptions = !debug
\tnoextract = ${archive}
\tsource_x86_64 = ${source}
\tsha256sums_x86_64 = ${checksum}

pkgname = k-downloader-bin
`;
  return { pkgbuild, srcinfo };
}

export async function generateAur(artifact, output, version) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(artifact)) hash.update(chunk);
  const files = renderAurFiles(version, hash.digest("hex"));
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "PKGBUILD"), files.pkgbuild);
  await writeFile(resolve(output, ".SRCINFO"), files.srcinfo);
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { version, license } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  if (license !== "UNLICENSED") throw new Error("Update the AUR license metadata to match package.json before generating a recipe.");
  const output = resolve(root, "release/aur/k-downloader-bin");
  await generateAur(resolve(root, "release", `K-Downloader-${version}-x86_64.pkg.tar.xz`), output, version);
  console.log(`AUR recipe: ${output} (nothing was published). Review distribution permission before submitting to AUR.`);
}