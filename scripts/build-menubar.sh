#!/bin/zsh
# Builds "Semester Bar.app" (the menu bar item) from apps/menubar/SemesterBar.swift, on this Mac.
# Needs Apple's command line tools (xcode-select --install). Nothing is downloaded.
set -e
cd "$(dirname "$0")/.."
OUT="apps/menubar/build/Semester Bar.app"
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS"
swiftc -O -framework AppKit -o "$OUT/Contents/MacOS/SemesterBar" apps/menubar/SemesterBar.swift
cat > "$OUT/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Semester Bar</string>
  <key>CFBundleIdentifier</key><string>local.school-dashboard.menubar</string>
  <key>CFBundleExecutable</key><string>SemesterBar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --sign - "$OUT" >/dev/null 2>&1 || true
echo "Built: $OUT"
echo "Open it with:  open \"$OUT\"   (to keep it, drag it to Applications and add it in System Settings → General → Login Items)"
