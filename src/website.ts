export const khinsiderHome = "https://downloads.khinsider.com/";
export const websiteTargetStorageKey = "khinsider-downloader.website-target";

export function isKhinsiderWebsiteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === new URL(khinsiderHome).origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isKhinsiderAlbumUrl(value: string): boolean {
  if (!isKhinsiderWebsiteUrl(value)) return false;
  return /^\/game-soundtracks\/album\/[^/]+\/?$/.test(new URL(value).pathname);
}
