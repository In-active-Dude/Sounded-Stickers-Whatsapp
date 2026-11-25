package com.soundsticker.companion;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.MediaController;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.VideoView;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Prepares a gallery copy for WhatsApp's native sticker editor. */
public final class MainActivity extends Activity {
    private static final int PICK_VIDEO = 100;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private Uri videoUri;
    private TextView status;
    private VideoView preview;
    private Button saveButton;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        content.setPadding(pad, pad, pad, pad);
        content.setBackgroundColor(0xfff2f5f4);
        scroll.addView(content);
        TextView title = new TextView(this);
        title.setText("Sound Sticker Companion");
        title.setTextSize(26);
        title.setTextColor(0xff143c34);
        content.addView(title);
        TextView instructions = new TextView(this);
        instructions.setText("Choose an MP4 with sound, save a copy, then create the sticker in WhatsApp. WhatsApp must support sound stickers on your account.");
        instructions.setTextSize(16);
        instructions.setPadding(0, dp(12), 0, dp(12));
        content.addView(instructions);
        preview = new VideoView(this);
        preview.setBackgroundColor(0xff172824);
        content.addView(preview, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(260)));
        MediaController controller = new MediaController(this);
        controller.setAnchorView(preview);
        preview.setMediaController(controller);
        Button choose = new Button(this);
        choose.setText("Choose MP4 video");
        choose.setOnClickListener(v -> chooseVideo());
        content.addView(choose);
        saveButton = new Button(this);
        saveButton.setText("Save video to gallery");
        saveButton.setEnabled(false);
        saveButton.setOnClickListener(v -> saveVideo());
        content.addView(saveButton);
        Button open = new Button(this);
        open.setText("Open WhatsApp");
        open.setOnClickListener(v -> openWhatsApp());
        content.addView(open);
        status = new TextView(this);
        status.setTextSize(15);
        status.setGravity(Gravity.START);
        status.setPadding(0, dp(12), 0, dp(12));
        status.setText("Choose a video to begin.");
        content.addView(status);
        TextView steps = new TextView(this);
        steps.setText("In WhatsApp: open your own chat → sticker picker → Create → select the saved video → keep the original sound. Crop or trim if those controls are available.");
        steps.setTextSize(15);
        content.addView(steps);
        setContentView(scroll);
        if (state != null && state.getString("video") != null) {
            videoUri = Uri.parse(state.getString("video"));
            showVideo();
        }
    }

    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density + 0.5f); }

    private void chooseVideo() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("video/mp4");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, PICK_VIDEO);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_VIDEO || result != RESULT_OK || data == null || data.getData() == null) return;
        videoUri = data.getData();
        try {
            getContentResolver().takePersistableUriPermission(videoUri, data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // Some providers only grant temporary access; it remains usable for this session.
        }
        showVideo();
    }

    private void showVideo() {
        preview.setVideoURI(videoUri);
        preview.setOnPreparedListener(player -> { player.seekTo(1); preview.setBackgroundColor(0x00000000); });
        preview.setOnErrorListener((player, what, extra) -> {
            status.setText("This video could not be previewed. Try another MP4.");
            saveButton.setEnabled(false);
            return true;
        });
        saveButton.setEnabled(true);
        status.setText("Video selected. Tap the preview to play it, then save a copy to your gallery.");
    }

    private void saveVideo() {
        if (videoUri == null) return;
        Uri source = videoUri;
        saveButton.setEnabled(false);
        status.setText("Saving a gallery copy…");
        executor.execute(() -> {
            Uri output = null;
            try {
                try (MediaMetadataRetriever metadata = new MediaMetadataRetriever()) {
                    metadata.setDataSource(this, source);
                    if (!"yes".equalsIgnoreCase(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO))) {
                        throw new IllegalArgumentException("The selected video has no detectable audio track.");
                    }
                }
                ContentValues values = new ContentValues();
                String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(new Date());
                values.put(MediaStore.Video.Media.DISPLAY_NAME, "sticker_" + stamp + ".mp4");
                values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
                values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/SoundStickerCompanion");
                values.put(MediaStore.Video.Media.IS_PENDING, 1);
                output = getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
                if (output == null) throw new IllegalStateException("Could not create a gallery file.");
                try (InputStream in = getContentResolver().openInputStream(source);
                     OutputStream out = getContentResolver().openOutputStream(output)) {
                    if (in == null || out == null) throw new IllegalStateException("Could not open the video.");
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                }
                ContentValues ready = new ContentValues();
                ready.put(MediaStore.Video.Media.IS_PENDING, 0);
                if (getContentResolver().update(output, ready, null, null) != 1) throw new IllegalStateException("Could not publish the gallery copy.");
                runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) {
                    saveButton.setEnabled(true);
                    status.setText("Saved in Movies/SoundStickerCompanion. Open WhatsApp and choose this video in its sticker creator.");
                }});
            } catch (Exception error) {
                if (output != null) getContentResolver().delete(output, null, null);
                final String message = error.getMessage() == null ? "Please try another video." : error.getMessage();
                runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) {
                    saveButton.setEnabled(true); status.setText("Could not save: " + message);
                }});
            }
        });
    }

    private void openWhatsApp() {
        Intent launch = getPackageManager().getLaunchIntentForPackage("com.whatsapp");
        if (launch == null) launch = getPackageManager().getLaunchIntentForPackage("com.whatsapp.w4b");
        if (launch == null) status.setText("WhatsApp is not installed or is unavailable on this phone.");
        else startActivity(launch);
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (videoUri != null) state.putString("video", videoUri.toString());
    }

    @Override protected void onDestroy() {
        preview.stopPlayback();
        executor.shutdown();
        super.onDestroy();
    }
}
