import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execute = promisify(execFile);
const schema = "org.cinnamon.desktop.interface";

export function cinnamonThemeIsDark(value: string): boolean | undefined {
  const match = value.trim().match(/^'([^']+)'$/);
  return match ? /(?:^|[-_\s])dark(?:$|[-_\s])/i.test(match[1]) : undefined;
}

export async function monitorCinnamonTheme(
  onChange: (dark: boolean | undefined) => void,
): Promise<() => void> {
  if (!/(?:^|:)X-Cinnamon(?:$|:)/i.test(process.env.XDG_CURRENT_DESKTOP ?? "")) return () => {};

  try {
    const { stdout } = await execute("gsettings", ["get", schema, "gtk-theme"], { timeout: 3_000 });
    onChange(cinnamonThemeIsDark(stdout));
  } catch {
    return () => {};
  }

  const monitor = spawn("gsettings", ["monitor", schema, "gtk-theme"], { stdio: ["ignore", "pipe", "ignore"] });
  const lines = createInterface({ input: monitor.stdout });
  lines.on("line", (line) => {
    const prefix = "gtk-theme: ";
    if (line.startsWith(prefix)) onChange(cinnamonThemeIsDark(line.slice(prefix.length)));
  });
  monitor.on("error", () => onChange(undefined));
  monitor.on("exit", () => onChange(undefined));
  return () => {
    lines.close();
    monitor.kill();
  };
}