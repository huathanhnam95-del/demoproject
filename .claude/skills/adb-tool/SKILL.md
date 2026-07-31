---
name: adb-tool
description: Android Debug Bridge (ADB) mastery. Use for controlling Android devices, managing packages, capturing logs (logcat), screen recording, and hardware interaction. High priority for Android development.
---

# ADB Tool Mastery

Master the Android Debug Bridge (ADB) to interact with physical or emulated Android devices.

## Use this skill when

- Checking device connection status (`adb devices`)
- Installing or uninstalling APKs (`adb install`, `adb uninstall`)
- Viewing real-time application logs (`adb logcat`)
- Pushing or pulling files to/from the device (`adb push`, `adb pull`)
- Executing shell commands on the device (`adb shell`)
- Capturing screenshots or screen recordings for verification
- Debugging package-related issues (permisisons, activity starts)

## Commands Reference

### Device Management

- `adb devices -l` (List devices with details)
- `adb -s <serial> <command>` (Target specific device)
- `adb reboot` / `adb reboot recovery`

### Package Management

- `adb shell pm list packages`
- `adb shell pm list packages -3` (Third-party only)
- `adb install -r app.apk` (Reinstall, keeping data)
- `adb shell pm clear <package>` (Clear app data)

### Activity & Intent

- `adb shell am start -n <package>/<activity>`
- `adb shell am force-stop <package>`
- `adb shell am broadcast -a <action>`

### Debugging & Logs

- `adb logcat *:E` (Error logs only)
- `adb logcat | grep <tag>` (Filter by tag)
- `adb shell dumpsys activity <package>` (Deep state inspection)

## Verification Patterns

- Always verify device state before pushing large files.
- Use `logcat -c` to clear logs before a specific test run to reduce noise.
- Check `adb shell getprop ro.build.version.release` for OS version checks.
