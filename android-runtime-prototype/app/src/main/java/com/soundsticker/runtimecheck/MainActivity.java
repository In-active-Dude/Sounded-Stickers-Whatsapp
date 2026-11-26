package com.soundsticker.runtimecheck;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public final class MainActivity extends Activity {
    static { System.loadLibrary("node"); System.loadLibrary("runtimecheck"); }
    public native int startNode(String[] args);
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView text = new TextView(this); text.setText("Checking local runtime…"); setContentView(text);
        new Thread(() -> {
            try {
                File base = getFilesDir().getCanonicalFile();
                try (ZipInputStream zip = new ZipInputStream(getAssets().open("runtime.zip"))) {
                    for (ZipEntry e; (e = zip.getNextEntry()) != null;) {
                        File target = new File(base, e.getName()).getCanonicalFile();
                        if (!target.getPath().startsWith(base.getPath() + File.separator)) throw new SecurityException("Invalid zip path");
                        if (e.isDirectory()) { target.mkdirs(); continue; }
                        target.getParentFile().mkdirs();
                        try (FileOutputStream out = new FileOutputStream(target)) { byte[] b = new byte[65536]; int n; while ((n=zip.read(b))!=-1) out.write(b,0,n); }
                    }
                }
                int result = startNode(new String[]{"node", new File(base,"smoke.cjs").getPath(), base.getPath()});
                runOnUiThread(() -> text.setText("Runtime check exited: " + result));
            } catch (Exception e) { runOnUiThread(() -> text.setText("Runtime check failed: " + e)); }
        }).start();
    }
}
