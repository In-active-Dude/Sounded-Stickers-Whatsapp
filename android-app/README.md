# Sound Sticker Companion for Android

This Android Studio project is intended for the Galaxy S24 Ultra. It picks an MP4, previews it, copies it into the phone's Movies/SoundStickerCompanion album, and opens WhatsApp. You then create the sound sticker in WhatsApp's own sticker creator. The app does **not** encode or send a sound-sticker message itself, and opening WhatsApp does not automatically import the video. WhatsApp's sound-sticker creator must be available on your account; its rollout and editing options can vary.

## Build and install

1. Install Android Studio, Android SDK Platform 35 and JDK 17. Open this `android-app` folder as a project.
2. Use Gradle 9.6 with Android Gradle Plugin 9.4.0. This source project does not include a Gradle wrapper; configure a compatible local Gradle distribution in Android Studio, or generate a wrapper with a trusted Gradle installation.
3. Sync the project and build a debug APK. Install it on your S24 Ultra using Android Studio or transfer the APK to the phone.

A debug APK has been built and placed at `../apk build/Sound Sticker Companion.apk`. Its APK signature has been verified, but it has not yet been installed or tested on a device. It is a debug build, not a production-signed release.

## Make a sound sticker

1. Pick an MP4 containing audio and preview it.
2. Tap **Save video to gallery**. A copy is created in Movies/SoundStickerCompanion; the original is not modified.
3. Tap **Open WhatsApp**, open your own chat, then open the sticker picker and choose **Create**. Pick the saved video, crop or trim if your WhatsApp version offers those controls, retain the original sound, and finish creating the sticker.
4. Send it to your own chat and add it to favorites in WhatsApp.

The companion uses Android's system file picker; it does not need broad gallery permission, a WhatsApp linked-device session, or a third-party server. It saves a copy to shared media storage only when you tap the save button. WhatsApp handles its own sticker creation and upload.
