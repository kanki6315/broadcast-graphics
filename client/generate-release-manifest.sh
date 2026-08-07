#!/usr/bin/env bash
set -euo pipefail

project_path="${1:?TelemetryClient project path is required}"
release_root="${2:?Release output directory is required}"
executable_name="BroadcastGraphicsClient.exe"
executable_path="$release_root/$executable_name"

version="$(dotnet msbuild "$project_path" -nologo -getProperty:Version | tr -d '\r' | tail -n 1)"
sha256="$(sha256sum "$executable_path" | cut -d ' ' -f 1)"
size="$(stat -c '%s' "$executable_path")"

case "$version" in
  ''|*[!0-9.]*) echo "Invalid client version: $version" >&2; exit 1 ;;
esac

printf '{\n  "version": "%s",\n  "url": "/api/client/download",\n  "sha256": "%s",\n  "size": %s\n}\n' \
  "$version" "$sha256" "$size" > "$release_root/latest.json"

printf '%s  %s\n' "$sha256" "$executable_name" > "$release_root/$executable_name.sha256"
