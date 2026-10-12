# K-Downloader

Status: Draft for discussion. No application implementation has started.

## Goal

Accept one KHInsider album URL or a pasted list of album URLs, identify their
audio tracks, and download each album into its own local folder with clear
progress and recoverable failures.

Example input:
https://downloads.khinsider.com/game-soundtracks/album/unreal-ii-the-awakening-original-soundtrack

"Entire album" initially means one audio file per track, preferring lossless
when available. Each download offers the formats actually available for that
album, with per-track availability shown before starting.

## Confirmed Requirements

Confirmed on 2026-10-12:

- The application is named K-Downloader.
- A desktop GUI is the primary interface, with a scriptable CLI option too.
- Support a pasted list of album URLs in the initial release, not just one album.
- Individual track-page downloads require no login, as confirmed by the user.
  Separate audio files in each album folder are sufficient; the site's bulk
  archive is not a required output.
- Plan an optional site-login capability for the official bulk-download feature,
  available only when the account has the required standing.
- The GUI offers an opt-in "Remember me" checkbox using secure Linux storage,
  with logout and removal of saved authentication.
- Default output is `~/Music/K-Downloader`, with an alternate destination
  selectable by the user. Use numbered track filenames and save cover artwork
  when available.
- Prefer lossless downloads when available; allow format selection for each
  download based on the formats discovered on the site.
- Automatically fall back to available lossy audio when lossless is unavailable,
  showing the fallback before downloading. Offer a lossless-only option.
- In lossless-only mode, block the run if any track lacks lossless audio unless
  the user explicitly chooses to skip those tracks. Report that album as incomplete.
- Linux is the only required platform for the initial release.
- Provide an AppImage, `.deb` packages for Debian/Ubuntu, and `.rpm` packages for
  Fedora-compatible distributions. Distribution versions and CPU architectures
  remain to be selected.

## Observations and Unknowns

Observed during planning on 2026-10-11:

- The example page advertises 19 tracks, MP3 audio, and approximately 48 MB.
- Its built-in "download all songs at once" link points to `/cp/add_album/41650`,
  an account-related route. The user reports that access depends on active
  uploader standing; credentials alone do not establish eligibility.
- Album artwork is linked from a separate `vgmtreasurechest.com` host.
- A page-reading tool retrieved the album, but a plain `curl` request returned
  HTTP 403. Ordinary script access is therefore not yet established.
- User-supplied screenshots show album -> individual track page -> audio download
  link, including a "Click here to download as MP3" link. The user confirms this
  workflow is available while logged out. Exact HTML selectors, final media URLs,
  and programmatic access still require verification.
- Several tracks are listed as very short and small. Do not assume that small
  files are failed downloads or that the source material is complete.

Before building the full downloader, verify permitted automated access and the
actual link-discovery flow. Do not bypass login requirements, paywalls, CAPTCHAs,
or other access controls. Use only material the user is authorized to download,
and review the site's applicable terms and request limits.

## Recommended Direction

Recommended stack: Electron GUI and Node.js/TypeScript CLI sharing one reusable
download engine. Both interfaces are initial-release deliverables; the CLI is
also a way to exercise the engine during development. No separate Python script
is needed. Keep the engine independent of Electron so CLI use and automated
tests do not require a graphical session.

Target Linux initially with both AppImage and native distribution packages.
Confirmed native formats: `.deb` for Debian/Ubuntu and `.rpm` for Fedora-compatible
distributions. Confirm supported distribution versions and CPU architectures
before defining the build matrix; package format alone does not establish
compatibility with every distribution. Windows and macOS packaging are deferred.

Use an established HTTP client and HTML parser rather than regular expressions
for page parsing. Browser automation is not a default dependency; evaluate it
only if a normal, permitted browser workflow is necessary and acceptable.

## Public Downloads and Optional Account Access

- Primary workflow: collect every album track-page link, visit those pages to
  discover audio links and formats, and queue the separate audio files. This
  automates the public individual-track workflow, not the restricted bulk route.
- No login or uploader standing is required for the primary workflow. Verify
  logged-out access with the chosen client; browser access does not resolve the
  earlier script HTTP 403 by itself.
- Optional account access uses the site's supported login flow and checks actual
  bulk-download eligibility. Inactive standing must remain inactive; do not
  bypass the entitlement check or assume a successful login grants bulk access.
- Propose an isolated site-login session in the GUI and a secure terminal prompt
  for CLI credentials if the site's login flow supports it. Never pass passwords
  in command arguments or store them in logs, manifests, or plaintext settings.
  Never forward site credentials or session cookies to media/CDN hosts.
- The GUI offers an unchecked-by-default "Remember me" checkbox. Without opt-in,
  authentication is session-only. Prefer remembering reusable site session data
  rather than the password, if the supported login flow allows it.
- Store persistent authentication through Linux Secret Service or an equivalent
  verified secure backend. Never fall back to plaintext or an insecure encryption
  backend. If secure storage is unavailable or locked, explain that persistence
  is unavailable and allow session-only sign-in without saving secrets.
- Logout removes saved authentication and clears local session cookies. Expired
  or revoked sessions require sign-in again; remembered sessions never imply
  active bulk-download standing. Handle MFA or challenges through supported user
  interaction, not circumvention.
- Before enabling bulk mode, verify its actual response type, available formats,
  and compatibility with numbered separate-file output. If it returns an archive,
  use a maintained extractor with path/link traversal protection and size limits;
  validate extracted tracks against the album list before marking them complete.
- Bulk mode must preserve the same format preview, manifest, no-overwrite, and
  completion rules. If unavailable or incompatible, offer public-track mode
  instead; never silently change the previewed audio formats.
- Public-track downloading must remain usable without account configuration or
  an available bulk feature. Login and bulk feasibility are a separate gate.

## Format Selection

- Default policy: prefer an available lossless source for each track. Do not
  transcode lossy audio into a lossless container or infer quality from file size.
- Offer "Prefer lossless", "Lossless only", and the actual discovered formats
  in both interfaces.
  Do not assume every album has FLAC or MP3, or every track has the same formats.
- Preview each track's selected format and show missing-format tracks explicitly.
  Discovery must resolve any uncertain availability before the final preview.
- Automatic fallback: when no lossless source exists, use an available lossy
  source, preferring MP3 if offered, and clearly identify those tracks in the
  preview and summary. The GUI shows this before Download is activated; the CLI
  prints the plan before any audio transfer without requiring a fallback prompt.
- Lossless-only mode never substitutes lossy audio. Show tracks without lossless
  sources as unavailable before downloading. Confirmed handling: block the run
  unless the user explicitly chooses to skip those tracks; report any resulting
  album as incomplete, not a complete album download.
- Selecting a specific format never silently substitutes another format. Report
  unavailable tracks and require an explicit skip/fallback choice; noninteractive
  CLI use fails unless a suitable policy was supplied in advance.
- If multiple lossless formats are offered, use an explicit preference order
  (proposed: FLAC first), or let the user select a specific discovered format.
- Save original downloaded bytes with the appropriate extension and record the
  selected format in the manifest. Downloading all formats is deferred.

## Proposed MVP

1. Accept one URL or a list of album URLs and a destination folder.
2. Validate the list and retrieve each album page.
3. Extract each album's title, ordered tracks, and available formats.
4. Preview each album's track count, available formats, and per-track selection.
5. Resolve each selected track to its actual audio URL.
6. Stream files into separate album folders, preserving track order in filenames.
  Save available cover artwork separately in each album folder.
7. Report queue, album, and track progress with a final per-album summary.
8. Allow a rerun to skip verified completed downloads and retry failed tracks.

## Album List and Queue

- GUI input accepts one URL per line, with blank lines and surrounding whitespace
  ignored. Preserve input order and deduplicate normalized album URLs, showing
  which duplicate entries were removed.
- Validate each entry and show invalid lines for correction or explicit removal
  before starting; never silently discard invalid input. Reject invalid CLI input
  with a nonzero exit status before any audio transfers.
- The CLI accepts multiple positional URLs, a newline-delimited list file, or
  standard input. Use the same validation and deduplication rules as the GUI.
- Proposed execution default: download albums sequentially, using the existing
  single-active-transfer limit across the queue, not one download per album.
- Apply a queue-wide format policy with per-album overrides in the GUI. Discover
  available formats separately for each album; do not assume a format supported
  by one album exists in another. CLI runs use one policy for the supplied list;
  differing explicit formats can be requested through separate invocations.
- Preview every album's format choices and fallback before starting the queue.
  A blocked lossless-only album must be resolved or explicitly excluded before
  starting; excluding an album is reported, not counted as a successful download.
- Proposed failure handling: record album-specific failures and continue with
  other albums. Pause the queue on site-wide access denial or rate limiting, and
  stop for shared destination failures such as disk-full errors.
- Allow queued albums to be removed before transfer; cancellation stops the
  active transfer and prevents later albums from starting. Failed albums can
  be retried without redownloading verified completed tracks.
- Keep each album's manifest separate and disambiguate identical album titles
  using source album identity so unrelated albums never share an output folder.
- Final results distinguish complete, incomplete, failed, excluded, and canceled
  albums. CLI failure or incomplete results produce a nonzero exit status.

## Output and Artwork

- Default root folder: `~/Music/K-Downloader`, resolved from the current user's
  home directory. Create it when starting a download if it does not exist.
- The GUI provides a folder picker and displays the selected destination before
  downloading. The CLI accepts `--output <directory>`; omitting it uses the same
  default root. Validate or create the destination before any file transfers.
- Put each album in its own sanitized album-title folder under the selected root,
  with the source-identity collision handling described above.
- Track filenames use zero-padded numbers and titles, such as
  `01 - Intro.mp3`; widen numbering for larger albums and preserve disc identity
  for multi-disc albums. Extensions reflect the actual downloaded formats.
- Discover cover artwork separately from audio tracks and save the original image
  as `cover.<actual-extension>` when available, without converting or embedding it.
  Apply the same safe URL, partial-file, validation, and no-overwrite rules.
- Record artwork status separately in the manifest and summary. A missing cover
  is not an audio failure; a failed cover transfer produces a visible warning and
  can be retried without redownloading completed audio. Shared disk or access
  failures still follow the queue's stop/pause policy.

Example output for the supplied MP3-only album:

```text
~/Music/K-Downloader/Unreal II - The Awakening Original Soundtrack/
  01 - Intro.mp3
  02 - Avalon TCA Base.mp3
  ...
  19 - Credits.mp3
  cover.jpg
  .download-manifest.json
```

CLI concept, not an implemented command:

```sh
k-downloader <album-url> --list-formats
k-downloader <album-url> --format prefer-lossless
k-downloader <album-url> --format lossless-only
k-downloader <album-url> --format mp3
k-downloader <album-url-1> <album-url-2>
k-downloader --input albums.txt --format prefer-lossless
k-downloader --input - --format prefer-lossless
k-downloader <album-url> --output /mnt/music/K-Downloader
```

For the GUI, the first screen contains a multiline album URL input, destination
picker, album queue, discovered-format selector for the selected album, track
table, Download/Cancel controls, and queue/album progress. Show format
availability, chosen formats, and any fallback in the table.
Show queued, resolving, downloading, completed, skipped, failed, and canceled
states. Perform network and filesystem work outside the renderer; expose only
narrow validated IPC operations, with context isolation and no renderer Node
integration. Never load remote site content as privileged application UI.

## Download Engine

- **Album parser:** extract only album track entries, excluding navigation,
  recommendations, artwork, and the site's account-based bulk-download link.
- **Artwork resolver:** identify the album's cover image separately from track
  entries and save it using the shared safe transfer writer.
- **Track resolver:** discover available audio formats from each track page;
  support relative URLs and redirects without guessing filenames or CDN hosts.
- **Optional account adapter:** isolate site authentication and eligible official
  bulk downloads from the public resolver and normalize results to the same jobs.
- **Format policy:** apply the same lossless preference, explicit selection, and
  missing-format rules in the GUI and CLI.
- **Album queue:** validate and deduplicate input, coordinate album jobs, and
  aggregate progress and results without mixing their manifests or format choices.
- **Download queue:** start with one active download and configurable pacing;
  increase concurrency only if site policy and observed behavior allow it.
- **Transfer writer:** stream to a `.part` file and rename after a successful,
  validated transfer. Do not buffer entire audio files in memory.
- **Manifest:** record source album, track identity, format, destination,
  completion state, and available size/checksum evidence. Re-resolve transient
  audio URLs when retrying rather than assuming saved URLs remain valid.
- **Progress events:** keep presentation separate from fetching and storage so
  either a CLI or GUI can consume the same engine.

## Reliability and Safety

- Validate HTTPS album URLs on `downloads.khinsider.com`; reject unrelated input.
- Resolve media redirects cautiously: reject non-HTTPS destinations, credentials
  in URLs, and local/private network targets. Confirm legitimate media hosts in
  the feasibility phase rather than assuming audio is on the album host.
- Sanitize filenames, prevent path traversal, and handle duplicate titles and
  disc numbers without overwriting unrelated files.
- Default to no overwrites. Skip only files supported by completion evidence;
  flag an existing unverified file as a conflict rather than silently trusting it.
- Retry transient network errors with bounded backoff; honor `Retry-After`.
  Stop and explain access-denied responses instead of repeatedly retrying them.
- Use timeouts, cancellation, and clear disk-full/permission-error reporting.
- Reject HTML/error responses posing as audio; check status, content type, and
  available byte-length evidence. Do not impose a minimum audio-file size.
- A rerun can restart incomplete tracks. Byte-range continuation is deferred
  until server range support and source-file identity can be verified.
- Report success only when all selected tracks are verified complete; give the
  CLI a nonzero exit status for failures and distinguish cancellation.
- Never download album audio just to run routine tests; keep live checks small.

## Milestones and Acceptance Checks

### 1. Feasibility Gate

- Review access policy and test the chosen client on the example album.
- Without logging in, identify all 19 advertised track entries and resolve one
  public track page to its audio download URL.
- Verify a minimal permitted media request without downloading the full album.
- If HTTP 403 or other restrictions persist, document the supported access path
  or stop and revisit scope before investing in the application.
- Separately verify supported login, active/inactive bulk eligibility, and bulk
  response structure before committing to an authenticated adapter. Use user
  interaction for secrets; do not include real credentials in test fixtures.

### 2. Single-Album Engine

- Implement discovery, format selection, streaming, naming, and summaries.
- Test parsers with saved permitted HTML fixtures and transfers with a local mock
  server, including redirects, missing formats, and malformed pages.
- Acceptance: the example album yields 19 ordered MP3 jobs; a mocked full run
  produces 19 complete files and no navigation or recommendation downloads.
- Test lossless-only, lossy-only, mixed-availability, and multiple-lossless-format
  fixtures. Verify that explicit format selection never silently falls back.
- Acceptance: prefer-lossless selects lossless where available and previews
  lossy fallback before the first audio transfer. Lossless-only schedules no
  lossy transfers and identifies tracks without lossless sources in advance.

### 3. Recovery and Interface

- Add manifest-based reruns, bounded retries, cancellation, and file conflicts.
- Test interruption, partial transfers, 403/429 responses, duplicate filenames,
  path traversal, HTML-as-audio, and unwritable destinations.
- Acceptance: rerunning does not duplicate verified files; failed tracks remain
  visible and retryable; cancellation never marks a partial file complete.
- Implement both the Electron GUI and scriptable CLI; verify equivalent format
  decisions and download results, including CLI use without a graphical session.
- Test multi-album input with blank lines, duplicates, invalid URLs, differing
  formats, identical album titles, an album failure, and queue cancellation.
- Verify the default root, alternate GUI/CLI destinations, numbered filenames,
  and multi-disc naming. Test available, missing, and failed artwork, plus reruns
  without unintended overwrites or repeated audio transfers.
- Acceptance: GUI paste and CLI list-file/stdin input produce equivalent ordered
  album jobs; each album has separate output and results, no previewed fallback
  is hidden, and cancellation prevents subsequent albums from starting.
- Public mode works without credentials. Test optional account access with mocked
  login failure, expired sessions, active/inactive standing, and bulk-format
  mismatch; verify credential redaction and no cookies sent to unrelated hosts.
- Test "Remember me" opt-in across application restarts, session-only sign-in
  without persistence, saved-authentication removal on logout, and unavailable
  or locked secure storage with no plaintext fallback. Check the secure backend
  in packaged AppImage, `.deb`, and `.rpm` builds on the agreed Linux targets.

### 4. Packaging and Documentation

- Document setup, supported inputs, format rules, limitations, and troubleshooting.
- Produce an AppImage and native Linux packages for the agreed distribution and
  architecture matrix, with consistent K-Downloader naming and versioning.
- Native packages provide a desktop launcher, application icon, and a
  `k-downloader` CLI entry point. Document installation, removal, and dependencies.
- Document AppImage executable permissions, required runtime dependencies, and
  a scriptable invocation. Keep the CLI independent of display-server startup;
  verify that packaged CLI mode works without opening the GUI.
- Test the AppImage and installed native packages, not only development mode:
  GUI launch, desktop integration where applicable, shell-script CLI use,
  default/alternate output paths, and the shared download workflow.
- Acceptance: both distribution types are available and tested on the agreed
  targets. Record any runtime or sandbox limitations; do not rely on disabling
  Electron's sandbox as the normal launch configuration.
- Perform an authorized live album download only after the feasibility gate and
  user agreement; compare the final files against the discovered track list.

## Deferred Features

Collection crawling, byte-range resume, metadata rewriting,
transcoding, cover embedding, automatic updates, and music-player integration are
outside the initial scope. Saving available original cover artwork is in scope;
embedding it in audio files is not.

## Decisions for Discussion

1. Lossless preference: prefer FLAC when multiple lossless formats exist?
2. Queue policy: sequential albums, continuing after album-specific failures?
3. Recovery: is restarting incomplete tracks sufficient for the first version?
4. Account access: final login/session integration depends on verifying the site's
  supported flow; GUI "Remember me" is confirmed.
5. Linux targets: which Debian/Ubuntu and Fedora-compatible distribution versions
  and CPU architectures should be tested?

GUI plus CLI, lossless preference with previewed automatic fallback, a
lossless-only option with explicit skipping of unavailable tracks,
discovered-format options, pasted album lists, Linux-only support, the
K-Downloader name, default and alternate output destinations, numbered filenames,
and saving available cover artwork are confirmed, as are AppImage, `.deb`, and
`.rpm` packages. Logged-out individual-track access, separate-file output, and
optional eligible bulk access and secure GUI "Remember me" are recorded. Stack,
authentication implementation details,
distribution versions, CPU architectures, and remaining policies are proposals.