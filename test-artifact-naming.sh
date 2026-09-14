#!/usr/bin/env bash
set -euo pipefail

# ── Simulates the release.yml rename logic and validates output ──

VERSION="0.2.0"
PASS=0
FAIL=0

assert_name() {
  local got="$1" expect="$2"
  if [ "$got" = "$expect" ]; then
    echo "  ✓ $got"
    PASS=$((PASS + 1))
  else
    echo "  ✗ got:      $got"
    echo "    expected: $expect"
    FAIL=$((FAIL + 1))
  fi
}

# ── Shared functions (copied from release.yml) ──

installer_type() {
  local name="$1"
  case "$name" in
    *.app.tar.gz) echo "tar" ;;
    *.tar.gz)     echo "tar" ;;
    *.dmg)        echo "dmg" ;;
    *.exe)        echo "nsis" ;;
    *.AppImage)   echo "appimage" ;;
    *.deb)        echo "deb" ;;
    *.rpm)        echo "rpm" ;;
    *)            echo "" ;;
  esac
}

file_ext() {
  local name="$1"
  case "$name" in
    *.app.tar.gz) echo "tar.gz" ;;
    *.tar.gz)     echo "tar.gz" ;;
    *.dmg)        echo "dmg" ;;
    *.exe)        echo "exe" ;;
    *.AppImage)   echo "AppImage" ;;
    *.deb)        echo "deb" ;;
    *.rpm)        echo "rpm" ;;
    *)            echo "" ;;
  esac
}

canonical_name() {
  local ext="$1"
  if [ -n "$VARIANT" ]; then
    echo "DataZen-${VERSION}-${PLATFORM}-${ARCH}-${VARIANT}.${ext}"
  else
    echo "DataZen-${VERSION}-${PLATFORM}-${ARCH}.${ext}"
  fi
}

# ── Test matrix ──

run_case() {
  local platform="$1" arch="$2" variant="$3" input_file="$4" expected="$5"
  PLATFORM="$platform"
  ARCH="$arch"
  VARIANT="${variant#-}"

  local base ext type
  base=$(basename "$input_file")
  type=$(installer_type "$base")
  ext=$(file_ext "$base")

  local got
  got=$(canonical_name "$ext")
  assert_name "$got" "$expected"
}

echo "=== macOS arm64 basic ==="
run_case "macos" "arm64" "" "DataZen-0.2.0-aarch64-apple-darwin.dmg"              "DataZen-0.2.0-macos-arm64.dmg"
run_case "macos" "arm64" "" "DataZen-0.2.0-aarch64-apple-darwin.tar.gz"           "DataZen-0.2.0-macos-arm64.tar.gz"
run_case "macos" "arm64" "" "DataZen-0.2.0-aarch64-apple-darwin.app.tar.gz"       "DataZen-0.2.0-macos-arm64.tar.gz"

echo ""
echo "=== macOS x64 basic ==="
run_case "macos" "x64" "" "DataZen-0.2.0-x86_64-apple-darwin.dmg"                "DataZen-0.2.0-macos-x64.dmg"
run_case "macos" "x64" "" "DataZen-0.2.0-x86_64-apple-darwin.tar.gz"             "DataZen-0.2.0-macos-x64.tar.gz"

echo ""
echo "=== macOS arm64-all ==="
run_case "macos" "arm64" "-all" "DataZen-0.2.0-aarch64-apple-darwin.dmg"          "DataZen-0.2.0-macos-arm64-all.dmg"

echo ""
echo "=== macOS x64-akulaku ==="
run_case "macos" "x64" "-akulaku" "DataZen-0.2.0-x86_64-apple-darwin.dmg"        "DataZen-0.2.0-macos-x64-akulaku.dmg"

echo ""
echo "=== Windows x64 basic ==="
run_case "windows" "x64" "" "DataZen-0.2.0-x86_64-pc-windows-msvc.exe"           "DataZen-0.2.0-windows-x64.exe"
# Windows sig: tested in "Sig name" section below

echo ""
echo "=== Windows x64-all ==="
run_case "windows" "x64" "-all" "DataZen-0.2.0-x86_64-pc-windows-msvc.exe"       "DataZen-0.2.0-windows-x64-all.exe"

echo ""
echo "=== Windows x64-akulaku ==="
run_case "windows" "x64" "-akulaku" "DataZen-0.2.0-x86_64-pc-windows-msvc.exe"   "DataZen-0.2.0-windows-x64-akulaku.exe"

echo ""
echo "=== Linux x64 basic ==="
run_case "linux" "x64" "" "DataZen-0.2.0-x86_64-unknown-linux-gnu.AppImage"      "DataZen-0.2.0-linux-x64.AppImage"
run_case "linux" "x64" "" "DataZen-0.2.0-x86_64-unknown-linux-gnu.deb"           "DataZen-0.2.0-linux-x64.deb"
run_case "linux" "x64" "" "DataZen-0.2.0-x86_64-unknown-linux-gnu.rpm"           "DataZen-0.2.0-linux-x64.rpm"

echo ""
echo "=== Linux x64-all ==="
run_case "linux" "x64" "-all" "DataZen-0.2.0-x86_64-unknown-linux-gnu.deb"       "DataZen-0.2.0-linux-x64-all.deb"

echo ""
echo "=== Sig name (mimics the loop) ==="
# Sig loop: sigstem = base minus .sig; lookup mapping; if missing → canonical_name + .sig
# For appimage sig: DataZen-0.2.0-x86_64-unknown-linux-gnu.AppImage.sig → sigstem=...AppImage → ext=AppImage
PLATFORM="linux"; ARCH="x64"; VARIANT=""
sig_base="DataZen-0.2.0-x86_64-unknown-linux-gnu.AppImage.sig"
sigstem="${sig_base%.sig}"
sig_ext=$(file_ext "$sigstem")
sig_name="$(canonical_name "$sig_ext").sig"
assert_name "$sig_name" "DataZen-0.2.0-linux-x64.AppImage.sig"

PLATFORM="macos"; ARCH="arm64"; VARIANT=""
sig_base2="DataZen-0.2.0-aarch64-apple-darwin.tar.gz.sig"
sigstem2="${sig_base2%.sig}"
sig_ext2=$(file_ext "$sigstem2")
sig_name2="$(canonical_name "$sig_ext2").sig"
assert_name "$sig_name2" "DataZen-0.2.0-macos-arm64.tar.gz.sig"

PLATFORM="windows"; ARCH="x64"; VARIANT=""
sig_base3="DataZen-0.2.0-x86_64-pc-windows-msvc.exe.sig"
sigstem3="${sig_base3%.sig}"
sig_ext3=$(file_ext "$sigstem3")
sig_name3="$(canonical_name "$sig_ext3").sig"
assert_name "$sig_name3" "DataZen-0.2.0-windows-x64.exe.sig"

echo ""
echo "=== Summary ==="
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ] && echo "🎉 All tests passed!" || echo "❌ Some tests failed"
exit "$FAIL"
