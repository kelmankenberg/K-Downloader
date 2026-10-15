export const appearanceModes = ["light", "dark", "system"] as const;
export const colorThemes = ["mint", "ocean", "amber", "rose", "monochrome"] as const;
export type Appearance = {
  mode: typeof appearanceModes[number];
  theme: typeof colorThemes[number];
};

export const defaultAppearance: Appearance = { mode: "system", theme: "mint" };
export const appearanceStorageKey = "khinsider-downloader.appearance";

export function parseAppearance(raw: string | null): Appearance {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      mode: appearanceModes.includes(value?.mode) ? value.mode : defaultAppearance.mode,
      theme: colorThemes.includes(value?.theme) ? value.theme : defaultAppearance.theme,
    };
  } catch {
    return { ...defaultAppearance };
  }
}

export function resolvedMode(mode: Appearance["mode"], systemDark: boolean): "light" | "dark" {
  return mode === "system" ? systemDark ? "dark" : "light" : mode;
}

export function initializeAppearance(): void {
  let preferences = { ...defaultAppearance };
  try {
    preferences = parseAppearance(localStorage.getItem(appearanceStorageKey));
  } catch {}
  const systemScheme = matchMedia("(prefers-color-scheme: dark)");
  let systemDark = systemScheme.matches;
  const modeInputs = document.querySelectorAll<HTMLInputElement>('input[name="appearance-mode"]');
  const themeInputs = document.querySelectorAll<HTMLInputElement>('input[name="color-theme"]');
  const storageStatus = document.querySelector<HTMLElement>("#appearance-storage-status");

  function apply(): void {
    document.documentElement.dataset.mode = resolvedMode(preferences.mode, systemDark);
    document.documentElement.dataset.theme = preferences.theme;
    modeInputs.forEach((input) => { input.checked = input.value === preferences.mode; });
    themeInputs.forEach((input) => { input.checked = input.value === preferences.theme; });
  }

  function save(): void {
    apply();
    try {
      localStorage.setItem(appearanceStorageKey, JSON.stringify(preferences));
      if (storageStatus) storageStatus.textContent = "";
    } catch {
      if (storageStatus) storageStatus.textContent = "Appearance could not be saved. Changes apply to this session only.";
    }
  }

  modeInputs.forEach((input) => input.addEventListener("change", () => {
    preferences.mode = input.value as Appearance["mode"];
    save();
  }));
  themeInputs.forEach((input) => input.addEventListener("change", () => {
    preferences.theme = input.value as Appearance["theme"];
    save();
  }));
  if (window.khinsiderDownloader?.onSystemTheme && window.khinsiderDownloader?.systemTheme) {
    let updateReceived = false;
    window.khinsiderDownloader.onSystemTheme((dark) => {
      updateReceived = true;
      systemDark = dark;
      apply();
    });
    void window.khinsiderDownloader.systemTheme().then((dark) => {
      if (!updateReceived) {
        systemDark = dark;
        apply();
      }
    }).catch(() => {
      systemScheme.addEventListener("change", () => {
        systemDark = systemScheme.matches;
        apply();
      });
    });
  } else {
    systemScheme.addEventListener("change", () => {
      systemDark = systemScheme.matches;
      apply();
    });
  }
  apply();
}