# KHInsider public-access feasibility probe

This probe checks whether Node.js's built-in `fetch` can read a public KHInsider
album page, find its numbered track-page links, and find an audio/download link
on one track page. An optional bounded request checks whether that link returns
audio data. It does not log in, use cookies, download a complete track, or retry
failed requests.

This is a feasibility probe, not the downloader. It tests Node `fetch`; if the
application later uses a different HTTP client, repeat the check with that
client before treating the result as proof for the implementation.

## Run

Requirements: Node.js 18.17 or newer and npm.

From the repository root:

```sh
cd scripts
npm install
node verify-khinsider-access.mjs
```

The default URL is the Unreal II example from the project plan. To use another
album, pass its URL. Add `--expected-tracks N` to require a known count:

```sh
node verify-khinsider-access.mjs 'https://downloads.khinsider.com/game-soundtracks/album/example' --expected-tracks 12
```

The first run checks the album and one track page but does not request the audio
URL. To also test the audio endpoint, explicitly add `--probe-media`:

```sh
node verify-khinsider-access.mjs --probe-media
```

The media check sends `Range: bytes=0-0`. If the server honors ranges, it reads
at most one byte. If the server ignores the range, the script reads at most
65,536 bytes and cancels the response. That ceiling can be lowered, but not
raised:

```sh
node verify-khinsider-access.mjs --probe-media --max-media-bytes 8192
```

To test a media URL copied from the browser without requesting the album page,
quote the URL and pass it to `--media-url`:

```sh
node verify-khinsider-access.mjs --media-url 'https://lambda.vgmtreasurechest.com/path/from/the/browser/01%20-%20Intro.mp3'
```

Replace the example URL with the exact request URL shown in DevTools. The direct
mode performs the same bounded range check and validates HTTPS, redirects, and
public host addresses. It does not send browser cookies. Query strings are
redacted in printed output in case the URL contains a temporary token.

For site operator contact details, optionally set a truthful user-agent suffix:

```sh
KHINSIDER_DOWNLOADER_CONTACT='contact: you@example.org' node verify-khinsider-access.mjs
```

Review KHInsider's applicable terms and request guidance before running it. Run
it once, manually, and stop if it reports HTTP 403, a login requirement, or a
challenge. Do not add credentials, browser cookies, impersonation headers,
challenge-solving, or retry loops to make the probe pass.

## Interpreting results

- `PASS` means the checks actually run succeeded. Without `--probe-media`, it
  proves only that the pages and an audio link were discoverable.
- A pass with `--probe-media` additionally confirms a bounded response with an
  audio or generic-binary content type. Generic binary is weaker evidence; the
  script warns if the link does not also identify an audio format.
- `FAIL` includes page access denied, unexpected track-link counts, a missing
  track/audio link, an unsafe redirect, or a non-audio response. Treat access
  denial or a challenge as a feasibility stop, not as a signal to evade it.

The script prints discovered public URLs to the terminal. Avoid sharing output
if it contains information you do not want to disclose.