export type WindowBounds = { x: number; y: number; width: number; height: number };
export type WindowState = { bounds: WindowBounds; maximized: boolean };
export const defaultWindowSize = { width: 1120, height: 780 };

export function parseWindowState(raw: string): WindowState | undefined {
  try {
    const value = JSON.parse(raw);
    const bounds = value?.bounds;
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) || bounds.width < 760 || bounds.height < 620) return undefined;
    return { bounds, maximized: value.maximized === true };
  } catch {
    return undefined;
  }
}

export function centeredBounds(area: WindowBounds): WindowBounds {
  const width = Math.min(defaultWindowSize.width, area.width);
  const height = Math.min(defaultWindowSize.height, area.height);
  return { width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2) };
}

export function startupBounds(state: WindowState | undefined, areas: WindowBounds[]): WindowBounds {
  if (!areas.length) throw new Error("No screen work area available");
  const bounds = state?.bounds;
  if (!bounds) return centeredBounds(areas[0]);
  const area = areas.find((area) => bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y);
  if (!area) return centeredBounds(areas[0]);
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return { width, height, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) };
}