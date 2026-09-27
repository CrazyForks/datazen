#!/usr/bin/env bash
# Configure SSH + insteadOf rewrites for the private git drivers (kiwi, superset).
#
# release.yml needs this in more than one job — the driver union warmup and the
# union typecheck both run `resolve-drivers --drivers=all,kiwi,superset`, and
# the git drivers are part of that union. Inlining the block twice risks the two
# copies drifting, and a drifted `insteadOf` is a hard "repository not found"
# rather than a visible diff, so it lives here instead.
#
# Reads KIWI_DEPLOY_KEY and SUPERSET_DEPLOY_KEY from the environment. Either may
# be unset: that driver is then left on its plain https URL, and resolve-drivers
# reports it as unreachable.
#
# Usage:
#   KIWI_DEPLOY_KEY=... SUPERSET_DEPLOY_KEY=... bash scripts/ci-setup-git-drivers.sh

set -euo pipefail

install_deploy_key() {
  # $1 = env var name holding the key, $2 = short alias used in insteadOf
  local var_name="$1"
  local alias="$2"
  local key_file="$HOME/.ssh/datazen_${alias}"

  local key="${!var_name:-}"
  if [ -z "${key}" ]; then
    return 0
  fi

  printf '%s\n' "${key}" > "${key_file}"
  chmod 600 "${key_file}"
  printf '%s\n' \
    "Host github.com-${alias}" \
    '  HostName github.com' \
    '  User git' \
    "  IdentityFile ${key_file}" \
    '  IdentitiesOnly yes' \
    >> "$HOME/.ssh/config"
  git config --global --add "url.git@github.com-${alias}:flyxl/datazen-driver-${alias}.git.insteadOf" \
    "https://github.com/flyxl/datazen-driver-${alias}.git"
  git config --global --add "url.git@github.com-${alias}:flyxl/datazen-driver-${alias}.git.insteadOf" \
    "https://github.com/flyxl/datazen-driver-${alias}"
}

mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keyscan -t ed25519,rsa github.com >> ~/.ssh/known_hosts 2>/dev/null
chmod 644 ~/.ssh/known_hosts

touch ~/.ssh/config
chmod 600 ~/.ssh/config

install_deploy_key KIWI_DEPLOY_KEY kiwi
install_deploy_key SUPERSET_DEPLOY_KEY superset
