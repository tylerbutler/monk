#!/usr/bin/env bash
set -euo pipefail

gleam_version="$(sed -n 's/^gleam = "\([0-9.]*\)"$/\1/p' mise.toml)"
if [[ "$gleam_version" != "1.19.0" ]]; then
  echo "Update the Cloudflare compiler checksum when changing the Gleam pin." >&2
  exit 1
fi

if ! command -v gleam >/dev/null 2>&1; then
  if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
    echo "Install the pinned Gleam compiler with mise on this platform." >&2
    exit 1
  fi
  tool_dir="$PWD/.wrangler/toolchains/gleam-$gleam_version"
  if [[ ! -x "$tool_dir/gleam" ]]; then
    echo "Gleam is missing. Installing the pinned compiler in .wrangler/toolchains."
    mkdir -p "$tool_dir"
    archive="$tool_dir/gleam.tar.gz"
    curl --fail --show-error --silent --location --retry 3 \
      "https://github.com/gleam-lang/gleam/releases/download/v$gleam_version/gleam-v$gleam_version-x86_64-unknown-linux-musl.tar.gz" \
      --output "$archive"
    printf '%s  %s\n' "6083148cb404460810afe35e7878527e58fd2512dd79a76b47d59723815753be" "$archive" | sha256sum --check
    tar -xzf "$archive" -C "$tool_dir" gleam
    rm "$archive"
  fi
  export PATH="$tool_dir:$PATH"
fi

if [[ "$(gleam --version)" != "gleam $gleam_version" ]]; then
  echo "Use Gleam $gleam_version, as specified in mise.toml." >&2
  exit 1
fi

npm run build
