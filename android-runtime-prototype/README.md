# Sound Sticker Studio for Android

This Android app selects a video, previews and crops it, converts the selected clip on the phone, then sends a sound sticker to the linked WhatsApp account's own chat. It is separate from the Windows desktop app.

## Download

[Download the Android APK](https://github.com/In-active-Dude/Sounded-Stickers-Whatsapp/raw/refs/heads/main/android-runtime-prototype/downloads/Sound-Sticker-Studio-Android.apk). This debug-signed build requires Android 10+ on an ARM64 device. Android may ask you to allow installation from your browser or file manager.

## Requirements

- Android 10 (API 29) or newer; the current build targets `arm64-v8a`.
- WhatsApp installed, an internet connection, and an account that can link devices.
- Android Studio or Gradle 9.6, JDK 17, Android SDK Platform 35, NDK `27.2.12479018`, and CMake 3.22.1.
- Git LFS to fetch the embedded Android Node library.

## Build

Clone the repository with Git LFS enabled, or run `git lfs pull` after cloning. Open `android-runtime-prototype` in Android Studio and sync Gradle, then build the `app` debug variant. Alternatively, from this directory run:

```powershell
gradle :app:assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`. The source project does not include a Gradle wrapper. Debug APKs are for testing and are not production-signed.

## Use

1. Choose a video with an audio track using the Android file picker.
2. Set the start and end times (up to 10 seconds), update the preview, and drag over the frame to crop. Tap **Update preview / reset crop** without drawing a crop to use the whole frame.
3. Enter the phone number with country code and tap **Link WhatsApp**.
4. In WhatsApp on the phone, open **Linked devices → Link a device → Link with phone number instead**, then enter the pairing code shown in the app.
5. After linking, create and send the sticker. Open your own chat to verify it and add it to favorites if desired.

Conversion happens locally. The app keeps the embedded runtime, temporary media, and linked-device credentials in app-private storage. The sticker and audio are uploaded to WhatsApp to send. This is an unofficial Baileys-based client; WhatsApp behavior and sound-sticker support can change. Revoke the linked device in WhatsApp's **Linked devices** settings.

The launcher uses a custom adaptive icon. The current Android project is still a test build: device-specific WhatsApp compatibility and a production-signed release have not been verified.
