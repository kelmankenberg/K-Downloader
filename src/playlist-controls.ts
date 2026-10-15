import type {
  GuiFormatPolicy,
  GuiPlaylist,
  GuiPlaylistAddResult,
  GuiPlaylistEntry,
  GuiPlaylistProgress,
  GuiPlaylistsState,
} from "./gui-types.js";
import { playlistNameError } from "./playlist.js";

const NEW_PLAYLIST = "__new__";
const LOSSLESS = ["FLAC", "ALAC", "WAV"];

type EntryStatus = { state: string; error?: string };

export type PlaylistControls = {
  /** Returns the target playlist id, asking for a new playlist name when none exists. */
  targetId: () => Promise<string | undefined>;
  describeAdd: (result: GuiPlaylistAddResult, singleTitle?: string) => string;
  open: () => void;
  isBusy: () => boolean;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : String(error);
}

export function initializePlaylistControls(options: {
  outputRoot: () => string;
  openSource: (url: string) => void;
  onBusyChange?: (busy: boolean) => void;
}): PlaylistControls {
  const api = window.khinsiderDownloader;
  const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
  const list = $<HTMLUListElement>("#playlist-list");
  const emptyList = $<HTMLElement>("#playlist-empty-list");
  const nameHeading = $<HTMLElement>("#playlist-name");
  const meta = $<HTMLElement>("#playlist-meta");
  const rows = $<HTMLTableSectionElement>("#playlist-rows");
  const table = $<HTMLTableElement>("#playlist-table");
  const emptyEntries = $<HTMLElement>("#playlist-empty");
  const warning = $<HTMLElement>("#playlists-warning");
  const errorText = $<HTMLElement>("#playlist-error");
  const newButton = $<HTMLButtonElement>("#playlist-new");
  const renameButton = $<HTMLButtonElement>("#playlist-rename");
  const deleteButton = $<HTMLButtonElement>("#playlist-delete");
  const clearButton = $<HTMLButtonElement>("#playlist-clear");
  const formatSelect = $<HTMLSelectElement>("#playlist-format");
  const skipInput = $<HTMLInputElement>("#playlist-skip");
  const checkButton = $<HTMLButtonElement>("#playlist-check");
  const downloadButton = $<HTMLButtonElement>("#playlist-download");
  const cancelButton = $<HTMLButtonElement>("#playlist-cancel");
  const progress = $<HTMLProgressElement>("#playlist-progress");
  const progressText = $<HTMLElement>("#playlist-progress-text");
  const dialog = $<HTMLDialogElement>("#playlist-name-dialog");
  const dialogForm = $<HTMLFormElement>("#playlist-name-form");
  const dialogTitle = $<HTMLElement>("#playlist-name-dialog-title");
  const dialogInput = $<HTMLInputElement>("#playlist-name-input");
  const dialogError = $<HTMLElement>("#playlist-name-error");
  const dialogSave = $<HTMLButtonElement>("#playlist-name-save");
  const targets = [...document.querySelectorAll<HTMLSelectElement>("select.playlist-target")];

  let state: GuiPlaylistsState = { playlists: [], readOnly: false, warning: "" };
  let selectedId: string | undefined;
  let busy = false;
  let runningId: string | undefined;
  let dragId: string | undefined;
  const statuses = new Map<string, Map<string, EntryStatus>>();

  const selected = (): GuiPlaylist | undefined => state.playlists.find((playlist) => playlist.id === selectedId);

  function setBusy(value: boolean, playlistId?: string): void {
    busy = value;
    runningId = value ? playlistId : undefined;
    options.onBusyChange?.(value);
    render();
  }

  function promptName(title: string, action: string, initial: string, submit: (name: string) => Promise<void>, ignoreId?: string): void {
    dialogTitle.textContent = title;
    dialogSave.textContent = action;
    dialogInput.value = initial;
    dialogError.textContent = "";
    dialog.dataset.ignoreId = ignoreId ?? "";
    pendingSubmit = submit;
    dialog.showModal();
    dialogInput.select();
  }
  let pendingSubmit: ((name: string) => Promise<void>) | undefined;
  dialogForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = dialogInput.value;
    const invalid = playlistNameError(name, state.playlists, dialog.dataset.ignoreId || undefined);
    if (invalid) {
      dialogError.textContent = invalid;
      return;
    }
    dialogSave.disabled = true;
    try {
      await pendingSubmit?.(name);
      dialog.close();
    } catch (error) {
      dialogError.textContent = message(error);
    } finally {
      dialogSave.disabled = false;
    }
  });
  $<HTMLButtonElement>("#playlist-name-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    pendingSubmit = undefined;
    renderTargets();
  });

  function createPlaylist(): Promise<string | undefined> {
    return new Promise((resolve) => {
      let createdId: string | undefined;
      promptName("New playlist", "Create", "", async (name) => {
        const playlist = await api.createPlaylist(name);
        createdId = playlist.id;
        selectedId = playlist.id;
      });
      dialog.addEventListener("close", () => resolve(createdId), { once: true });
    });
  }

  function renderTargets(): void {
    for (const select of targets) {
      const choices = state.playlists.map((playlist) => {
        const option = document.createElement("option");
        option.value = playlist.id;
        option.textContent = `${playlist.name} (${playlist.entries.length})`;
        return option;
      });
      const create = document.createElement("option");
      create.value = NEW_PLAYLIST;
      create.textContent = "New playlist…";
      if (!state.activePlaylistId) {
        const none = document.createElement("option");
        none.value = "";
        none.textContent = choices.length === 0 ? "No playlists" : "Choose playlist";
        choices.unshift(none);
      }
      select.replaceChildren(...choices, create);
      select.value = state.activePlaylistId ?? "";
      select.disabled = state.readOnly;
    }
  }

  function policy(): GuiFormatPolicy {
    if (formatSelect.value === "prefer-lossless") return { kind: "prefer-lossless" };
    if (formatSelect.value === "lossless-only") return { kind: "lossless-only", skipUnavailable: skipInput.checked };
    return { kind: "specific", format: formatSelect.value.slice("format:".length), skipUnavailable: skipInput.checked };
  }

  function selection(entry: GuiPlaylistEntry): { format?: string; state: string } {
    if (!entry.formats) return { state: "Not checked" };
    const formats = entry.formats;
    if (formatSelect.value === "prefer-lossless") {
      const format = LOSSLESS.find((candidate) => formats.includes(candidate)) ?? formats.find((candidate) => candidate === "MP3") ?? formats[0];
      return format ? { format, state: "Ready" } : { state: "Unavailable" };
    }
    const format = formatSelect.value === "lossless-only"
      ? LOSSLESS.find((candidate) => formats.includes(candidate))
      : formats.includes(formatSelect.value.slice("format:".length)) ? formatSelect.value.slice("format:".length) : undefined;
    if (format) return { format, state: "Ready" };
    return { state: skipInput.checked ? "Skipped" : "Unavailable" };
  }

  function renderFormatOptions(playlist: GuiPlaylist | undefined): void {
    const previous = formatSelect.value;
    formatSelect.querySelectorAll("option[data-discovered]").forEach((option) => option.remove());
    const formats = [...new Set(playlist?.entries.flatMap((entry) => entry.formats ?? []) ?? [])].sort();
    for (const format of formats) {
      const option = document.createElement("option");
      option.value = `format:${format}`;
      option.textContent = `Specific format: ${format}`;
      option.dataset.discovered = "true";
      formatSelect.append(option);
    }
    if ([...formatSelect.options].some((option) => option.value === previous)) formatSelect.value = previous;
    else formatSelect.value = "prefer-lossless";
  }

  function iconButton(label: string, text: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row-button";
    button.textContent = text;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.disabled = disabled;
    button.addEventListener("click", onClick);
    return button;
  }

  function act(action: () => Promise<unknown>): void {
    errorText.textContent = "";
    void action().catch((error: unknown) => { errorText.textContent = message(error); });
  }

  function renderEntries(playlist: GuiPlaylist | undefined): void {
    const locked = busy || state.readOnly || !playlist;
    const entryStatus = (playlist && statuses.get(playlist.id)) ?? new Map<string, EntryStatus>();
    const entries = playlist?.entries ?? [];
    const width = Math.max(3, String(entries.length).length);
    rows.replaceChildren(...entries.map((entry, index) => {
      const row = document.createElement("tr");
      row.dataset.entryId = entry.id;
      row.draggable = !locked;
      const cells = ["position", "album", "title", "formats", "choice", "state", "actions"].map((name) => {
        const cell = document.createElement("td");
        cell.className = `playlist-${name}`;
        row.append(cell);
        return cell;
      });
      const choice = selection(entry);
      const status = entryStatus.get(entry.trackUrl);
      cells[0]!.textContent = String(index + 1).padStart(width, "0");
      cells[1]!.textContent = entry.albumTitle;
      cells[2]!.textContent = entry.title;
      cells[3]!.textContent = entry.formats ? entry.formats.join(", ") || "None found" : "Not checked";
      cells[4]!.textContent = choice.format ?? "-";
      cells[5]!.textContent = status ? status.state : choice.state;
      cells[5]!.dataset.state = (status ? status.state : choice.state).toLowerCase();
      if (status?.error) cells[5]!.title = status.error;
      cells[6]!.append(
        iconButton(`Move ${entry.title} up`, "↑", () => act(() => api.movePlaylistEntry(playlist!.id, entry.id, index - 1)), locked || index === 0),
        iconButton(`Move ${entry.title} down`, "↓", () => act(() => api.movePlaylistEntry(playlist!.id, entry.id, index + 1)), locked || index === entries.length - 1),
        iconButton(`Open ${entry.title} on KHInsider`, "Open", () => options.openSource(entry.trackUrl)),
        iconButton(`Remove ${entry.title}`, "Remove", () => act(() => api.removePlaylistEntries(playlist!.id, [entry.id])), locked),
      );
      return row;
    }));
    table.hidden = entries.length === 0;
    emptyEntries.hidden = entries.length > 0;
  }

  function render(): void {
    let playlist = selected();
    if (!playlist) {
      selectedId = state.activePlaylistId ?? state.playlists[0]?.id;
      playlist = selected();
    }
    warning.textContent = state.warning;
    emptyList.hidden = state.playlists.length > 0;
    list.replaceChildren(...state.playlists.map((candidate) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "playlist-list-item";
      if (candidate.id === playlist?.id) button.setAttribute("aria-current", "true");
      const name = document.createElement("span");
      name.textContent = candidate.name;
      const count = document.createElement("span");
      count.className = "playlist-count";
      count.textContent = String(candidate.entries.length);
      button.append(name, count);
      button.addEventListener("click", () => {
        selectedId = candidate.id;
        errorText.textContent = "";
        render();
        if (!state.readOnly && state.activePlaylistId !== candidate.id) act(() => api.setActivePlaylist(candidate.id));
      });
      item.append(button);
      return item;
    }));

    nameHeading.textContent = playlist?.name ?? "No playlist selected";
    const outputRoot = options.outputRoot().replace(/\/+$/, "");
    meta.textContent = playlist
      ? `${playlist.entries.length} ${playlist.entries.length === 1 ? "track" : "tracks"} · ${playlist.lastDirectory ? `Downloads to ${playlist.lastDirectory}` : `Saves under ${outputRoot}`}`
      : state.playlists.length === 0 ? "Create a playlist, then add tracks from KHInsider track pages or an inspected album." : "";
    renderFormatOptions(playlist);
    const editable = !!playlist && !busy && !state.readOnly;
    newButton.disabled = busy || state.readOnly;
    renameButton.disabled = !editable;
    deleteButton.disabled = !editable;
    clearButton.disabled = !editable || !playlist || playlist.entries.length === 0;
    formatSelect.disabled = busy || !playlist;
    skipInput.disabled = busy || !playlist || formatSelect.value === "prefer-lossless";
    const blocked = !!playlist?.entries.some((entry) => selection(entry).state === "Unavailable");
    checkButton.disabled = busy || !playlist || playlist.entries.length === 0;
    downloadButton.disabled = busy || !playlist || playlist.entries.length === 0 || blocked;
    downloadButton.title = blocked ? "Some tracks lack the selected format. Choose another policy or skip them." : "";
    cancelButton.disabled = !busy || !runningId;
    renderEntries(playlist);
    renderTargets();
  }

  function applyPolicy(playlist: GuiPlaylist | undefined): void {
    const saved = playlist?.formatPolicy;
    if (!saved) return;
    const value = saved.kind === "specific" ? `format:${saved.format}` : saved.kind;
    renderFormatOptions(playlist);
    if ([...formatSelect.options].some((option) => option.value === value)) formatSelect.value = value;
    skipInput.checked = saved.kind !== "prefer-lossless" && saved.skipUnavailable;
  }

  function setState(next: GuiPlaylistsState): void {
    const previousSelected = selectedId;
    state = next;
    if (!state.playlists.some((playlist) => playlist.id === selectedId)) selectedId = state.activePlaylistId ?? state.playlists[0]?.id;
    if (selectedId !== previousSelected) applyPolicy(selected());
    render();
  }

  api.onPlaylists(setState);
  void api.getPlaylists().then((initial) => {
    setState(initial);
    applyPolicy(selected());
    render();
  }).catch((error: unknown) => { warning.textContent = message(error); });

  for (const select of targets) {
    select.addEventListener("change", async () => {
      if (select.value === NEW_PLAYLIST) {
        select.value = state.activePlaylistId ?? "";
        await createPlaylist();
        return;
      }
      if (select.value) act(() => api.setActivePlaylist(select.value));
    });
  }

  newButton.addEventListener("click", () => { void createPlaylist(); });
  renameButton.addEventListener("click", () => {
    const playlist = selected();
    if (!playlist) return;
    promptName("Rename playlist", "Rename", playlist.name, async (name) => {
      const result = await api.renamePlaylist(playlist.id, name);
      progressText.textContent = result.folder ? `Folder renamed to ${result.folder}` : progressText.textContent;
      if (result.folderError) errorText.textContent = result.folderError;
    }, playlist.id);
  });
  deleteButton.addEventListener("click", () => {
    const playlist = selected();
    if (playlist) act(() => api.deletePlaylist(playlist.id));
  });
  clearButton.addEventListener("click", () => {
    const playlist = selected();
    if (playlist) act(() => api.clearPlaylist(playlist.id));
  });
  formatSelect.addEventListener("change", render);
  skipInput.addEventListener("change", render);

  rows.addEventListener("dragstart", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-entry-id]");
    dragId = row?.dataset.entryId;
    if (dragId) event.dataTransfer?.setData("text/plain", dragId);
  });
  rows.addEventListener("dragover", (event) => {
    if (dragId) event.preventDefault();
  });
  rows.addEventListener("drop", (event) => {
    event.preventDefault();
    const row = (event.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-entry-id]");
    const playlist = selected();
    const moving = dragId;
    dragId = undefined;
    if (!row || !playlist || !moving || row.dataset.entryId === moving) return;
    const toIndex = playlist.entries.findIndex((entry) => entry.id === row.dataset.entryId);
    act(() => api.movePlaylistEntry(playlist.id, moving, toIndex));
  });
  rows.addEventListener("dragend", () => { dragId = undefined; });

  checkButton.addEventListener("click", async () => {
    const playlist = selected();
    if (!playlist) return;
    errorText.textContent = "";
    progress.value = 0;
    progress.max = playlist.entries.length;
    progressText.textContent = "Checking track pages…";
    statuses.set(playlist.id, new Map());
    setBusy(true, playlist.id);
    try {
      const result = await api.checkPlaylistFormats(playlist.id);
      if (!result) progressText.textContent = "Format check canceled";
      else {
        progressText.textContent = result.failed.length === 0
          ? `Checked ${result.checked} tracks`
          : `Checked ${result.checked} tracks · ${result.failed.length} could not be read`;
      }
    } catch (error) {
      errorText.textContent = message(error);
      progressText.textContent = "Format check failed";
    } finally {
      setBusy(false);
    }
  });

  downloadButton.addEventListener("click", async () => {
    const playlist = selected();
    if (!playlist) return;
    errorText.textContent = "";
    progress.value = 0;
    progress.max = playlist.entries.length;
    progressText.textContent = "Preparing playlist";
    const statusMap = new Map<string, EntryStatus>();
    statuses.set(playlist.id, statusMap);
    setBusy(true, playlist.id);
    try {
      const result = await api.downloadPlaylist({ playlistId: playlist.id, policy: policy(), outputRoot: options.outputRoot() });
      if (!result) {
        progressText.textContent = "Download canceled";
        return;
      }
      for (const track of result.tracks) {
        statusMap.set(track.trackUrl, { state: label(track.state), ...(track.error ? { error: track.error } : {}) });
      }
      progress.value = progress.max;
      const notes = [
        result.suffixed ? `Saved to ${result.directory} because a folder with the playlist name already held other files` : `${label(result.state)} · ${result.directory}`,
        ...result.warnings,
      ];
      progressText.textContent = notes.join(" · ");
    } catch (error) {
      errorText.textContent = message(error);
      progressText.textContent = "Download failed";
    } finally {
      setBusy(false);
    }
  });

  cancelButton.addEventListener("click", async () => {
    cancelButton.disabled = true;
    progressText.textContent = "Canceling…";
    try {
      await api.cancel();
    } catch (error) {
      errorText.textContent = message(error);
    }
  });

  function label(stateName: string): string {
    return stateName.charAt(0).toUpperCase() + stateName.slice(1);
  }

  api.onPlaylistProgress((event: GuiPlaylistProgress) => {
    const playlist = state.playlists.find((candidate) => candidate.id === event.playlistId);
    const entry = playlist?.entries[event.number - 1];
    const statusMap = statuses.get(event.playlistId) ?? new Map<string, EntryStatus>();
    statuses.set(event.playlistId, statusMap);
    progress.max = Math.max(1, event.totalTracks);
    progress.value = event.completedTracks;
    const stateLabel = {
      "resolve-start": "Checking",
      "resolve-complete": "Checked",
      "resolve-failed": "Page failed",
      "track-start": "Downloading",
      "track-complete": "Complete",
      "track-failed": "Failed",
      canceled: "Canceled",
    }[event.stage];
    if (entry && event.stage !== "resolve-start") statusMap.set(entry.trackUrl, { state: stateLabel });
    progressText.textContent = event.stage.startsWith("resolve")
      ? `Checking track pages · ${event.completedTracks} of ${event.totalTracks}`
      : event.stage === "track-start"
        ? `Downloading ${String(event.number).padStart(3, "0")} · ${event.title}`
        : event.stage === "track-complete"
          ? `Completed ${event.completedTracks} of ${event.totalTracks} tracks`
          : event.stage === "track-failed" ? `Failed ${String(event.number).padStart(3, "0")} · ${event.title}` : "Canceled";
    if (event.playlistId === selectedId) renderEntries(selected());
  });

  return {
    targetId: async () => {
      if (state.readOnly) throw new Error(state.warning || "Playlists are read-only.");
      if (state.activePlaylistId) return state.activePlaylistId;
      return createPlaylist();
    },
    describeAdd: (result, singleTitle) => {
      if (result.added === 0 && result.duplicates > 0) return `Already in playlist "${result.playlistName}"`;
      if (result.added === 0) return "No tracks were added";
      const what = singleTitle && result.added === 1 ? `"${singleTitle}"` : `${result.added} ${result.added === 1 ? "track" : "tracks"}`;
      const duplicateNote = result.duplicates > 0 ? ` · ${result.duplicates} already in playlist` : "";
      return `Added ${what} to "${result.playlistName}"${duplicateNote}`;
    },
    open: () => {
      render();
      newButton.focus();
    },
    isBusy: () => busy,
  };
}
