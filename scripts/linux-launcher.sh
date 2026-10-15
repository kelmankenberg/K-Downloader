#!/bin/sh
set -eu
APP_DIR=$(dirname "$(readlink -f "$0")")
export KHINSIDER_DOWNLOADER_CHROMIUM_PATH="$APP_DIR/resources/chromium/chrome"
case "${1:-}" in
  inspect|download|--help|help)
    export ELECTRON_RUN_AS_NODE=1
    exec "$APP_DIR/khinsider-downloader-bin" "$APP_DIR/resources/app.asar/dist/cli.cjs" "$@"
    ;;
  *)
    unset ELECTRON_RUN_AS_NODE
    exec "$APP_DIR/khinsider-downloader-bin" "$@"
    ;;
esac