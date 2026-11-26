package com.soundsticker.runtimecheck;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFmpegSession;
import com.arthenica.ffmpegkit.ReturnCode;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Locale;
import java.util.Arrays;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    static { System.loadLibrary("node"); System.loadLibrary("runtimecheck"); }
    private static volatile boolean started = false;
    private static volatile String bootstrapError = null;
    public native int startNode(String[] args);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView status, pairing;
    private EditText phone, start, end;
    private Button send;
    private CropView crop;
    private Uri selected;
    private double duration;
    private boolean linked=false, working=false;
    private String lastState="";
    private File base;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        base=getFilesDir();
        ScrollView scroll=new ScrollView(this);
        scroll.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(0,i.getSystemWindowInsetTop(),0,i.getSystemWindowInsetBottom());return i;});
        LinearLayout col=new LinearLayout(this); col.setOrientation(LinearLayout.VERTICAL); int p=dp(18); col.setPadding(p,p,p,p); col.setBackgroundColor(0xfff2f5f4); scroll.addView(col);
        TextView heading=label("Sound Sticker Studio",24); heading.setTextColor(0xff143c34); col.addView(heading);
        col.addView(label("Select a video and drag over the frame to crop. The sticker is sent to your own WhatsApp chat.",15));
        crop=new CropView(); col.addView(crop,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(280)));
        Button choose=button("Choose gallery video"); choose.setOnClickListener(v->choose()); col.addView(choose);
        LinearLayout times=new LinearLayout(this); times.setOrientation(LinearLayout.HORIZONTAL);
        start=entry("Start seconds", "0"); end=entry("End seconds", ""); times.addView(start,new LinearLayout.LayoutParams(0,-2,1)); times.addView(end,new LinearLayout.LayoutParams(0,-2,1)); col.addView(times);
        Button update=button("Update preview / reset crop"); update.setOnClickListener(v->loadPreview()); col.addView(update);
        phone=entry("Phone number with country code", ""); phone.setInputType(android.text.InputType.TYPE_CLASS_PHONE); col.addView(phone);
        Button connect=button("Link WhatsApp"); connect.setOnClickListener(v->link()); col.addView(connect);
        pairing=label("",18); pairing.setTextIsSelectable(true); col.addView(pairing);
        Button copy=button("Copy pairing code"); copy.setOnClickListener(v->{String c=pairing.getText().toString();if(!c.isEmpty())((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("WhatsApp pairing code",c));}); col.addView(copy);
        send=button("Create and send sound sticker"); send.setEnabled(false); send.setOnClickListener(v->makeSticker()); col.addView(send);
        status=label("Starting phone runtime…",15); col.addView(status);
        col.addView(label("Link using WhatsApp → Linked devices → Link a device → Link with phone number instead. This is an unofficial linked client.",14));
        setContentView(scroll);
        startRuntime(); handler.post(pollState);
        if (getIntent().getBooleanExtra("codec_smoke",false)) codecSmoke();
    }
    private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density+0.5f);}
    private TextView label(String s,int size){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setPadding(0,dp(8),0,dp(8));return t;}
    private Button button(String s){Button b=new Button(this);b.setText(s);return b;}
    private EditText entry(String hint,String value){EditText e=new EditText(this);e.setSingleLine(true);e.setHint(hint);e.setText(value);return e;}
    private void startRuntime(){
        synchronized(MainActivity.class){if(started)return;started=true;}
        new Thread(()->{try{
            File marker=new File(base,"runtime-ready-v4");
            if(!marker.exists()){
                try(ZipInputStream zip=new ZipInputStream(getAssets().open("runtime-v4.zip"))){
                    File canonical=base.getCanonicalFile();
                    for(ZipEntry e;(e=zip.getNextEntry())!=null;){File f=new File(base,e.getName()).getCanonicalFile();if(!f.getPath().startsWith(canonical.getPath()+File.separator))throw new SecurityException("Invalid asset path");if(e.isDirectory()){f.mkdirs();continue;}f.getParentFile().mkdirs();try(FileOutputStream out=new FileOutputStream(f)){byte[] b=new byte[65536];int n;while((n=zip.read(b))!=-1)out.write(b,0,n);}}
                }
                marker.createNewFile();
            }
            int code=startNode(new String[]{"node",new File(base,"sender.cjs").getPath(),base.getPath()});
            bootstrapError="Runtime stopped ("+code+"). Restart the app.";
        }catch(Throwable e){bootstrapError="Runtime failed: "+e.getMessage();}}).start();
    }
    private void choose(){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("video/*");i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivityForResult(i,10);}
    @Override protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);if(req!=10||result!=RESULT_OK||data==null||data.getData()==null)return;selected=data.getData();try(MediaMetadataRetriever m=new MediaMetadataRetriever()){m.setDataSource(this,selected);duration=Double.parseDouble(m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))/1000.0;if(!"yes".equalsIgnoreCase(m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)))throw new IllegalArgumentException("Video has no audio.");start.setText("0");end.setText(String.format(Locale.US,"%.2f",Math.min(duration,10)));loadPreview();}catch(Exception e){selected=null;status.setText("Could not open video: "+e.getMessage());}}
    private void loadPreview(){if(selected==null)return;try{double t=Double.parseDouble(start.getText().toString());if(t<0||t>=duration)throw new IllegalArgumentException("Start must be within video.");try(MediaMetadataRetriever m=new MediaMetadataRetriever()){m.setDataSource(this,selected);Bitmap frame=m.getFrameAtTime((long)(t*1000000),MediaMetadataRetriever.OPTION_CLOSEST_SYNC);if(frame==null)throw new IllegalStateException("No preview frame.");crop.setBitmap(frame);}}catch(Exception e){status.setText("Preview: "+e.getMessage());}}
    private void command(JSONObject data)throws Exception{File tmp=new File(base,"command.tmp"),target=new File(base,"command.json");try(FileOutputStream out=new FileOutputStream(tmp)){out.write(data.toString().getBytes(StandardCharsets.UTF_8));}Files.move(tmp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);}
    private void link(){try{String number=phone.getText().toString().replaceAll("[^0-9]","");if(number.length()<8||number.length()>15)throw new IllegalArgumentException("Enter phone number with country code.");startForegroundService(new Intent(this,LinkService.class));command(new JSONObject().put("type","connect").put("phone",number));status.setText("Connecting to WhatsApp…");}catch(Exception e){stopService(new Intent(this,LinkService.class));status.setText(e.getMessage());}}
    private final Runnable pollState=new Runnable(){@Override public void run(){try{if(bootstrapError!=null)status.setText(bootstrapError);File f=new File(base,"state.json");if(f.exists()){String raw=new String(Files.readAllBytes(f.toPath()),StandardCharsets.UTF_8);if(!raw.equals(lastState)){lastState=raw;JSONObject o=new JSONObject(raw);String s=o.optString("status");if(s.equals("ready")){linked=false;send.setEnabled(false);pairing.setText("");status.setText("Ready. Enter your phone number with country code, then tap Link WhatsApp.");}else if(s.equals("pairing")){pairing.setText(o.optString("code"));status.setText("Copy this code, then enter it in WhatsApp Linked devices.");}else if(s.equals("linked")){stopService(new Intent(MainActivity.this,LinkService.class));linked=true;send.setEnabled(!working);pairing.setText("");status.setText("WhatsApp linked. Choose a video and create a sticker.");}else if(s.equals("sending")){status.setText("Uploading and sending…");}else if(s.equals("sent")){working=false;send.setEnabled(linked);status.setText("Sent. Open your own chat in WhatsApp and test the audio.");}else if(s.equals("error")){stopService(new Intent(MainActivity.this,LinkService.class));working=false;send.setEnabled(linked);status.setText(o.optString("message"));}}}}catch(Exception ignored){}handler.postDelayed(this,800);}};
    private void makeSticker(){
        if(!linked||selected==null){status.setText("Link WhatsApp and choose a video first.");return;}
        final double begin, length;try{begin=Double.parseDouble(start.getText().toString());double stop=Double.parseDouble(end.getText().toString());if(begin<0||stop<=begin||stop>duration+0.02||stop-begin>10)throw new IllegalArgumentException("Select a valid clip up to 10 seconds.");length=Math.min(stop,duration)-begin;}catch(Exception e){status.setText("Check the start and end times.");return;}
        final Uri input=selected;final float[] box=crop.box();working=true;send.setEnabled(false);status.setText("Converting video and audio on your phone…");
        new Thread(()->{try{
            File source=new File(base,"input-video"),webp=new File(base,"sticker.webp"),audio=new File(base,"audio.ogg");
            try(InputStream in=getContentResolver().openInputStream(input);FileOutputStream out=new FileOutputStream(source)){if(in==null)throw new IllegalStateException("Cannot read video.");byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}
            String ss=String.format(Locale.US,"%.3f",begin),len=String.format(Locale.US,"%.3f",length);
            String filter=String.format(Locale.US,"crop=trunc(iw*%.6f/2)*2:trunc(ih*%.6f/2)*2:trunc(iw*%.6f/2)*2:trunc(ih*%.6f/2)*2,fps=10,scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",box[2],box[3],box[0],box[1]);
            File framesDir=new File(base,"frames");framesDir.mkdirs();File[] stale=framesDir.listFiles();if(stale!=null)for(File f:stale)f.delete();
            runFF(new String[]{"-y","-ss",ss,"-i",source.getPath(),"-t",len,"-an","-vf",filter,"-c:v","png",new File(framesDir,"frame_%04d.png").getPath()});
            File[] frames=framesDir.listFiles((d,n)->n.endsWith(".png"));if(frames==null)throw new IllegalStateException("Could not read frames.");Arrays.sort(frames);boolean fits=false;
            for(int q:new int[]{55,35,20,10,3}){AnimatedWebp.encode(frames,webp,q,100);if(webp.length()<=500*1024){fits=true;break;}}
            for(File f:frames)f.delete();framesDir.delete();
            if(!fits)throw new IllegalStateException("Sticker is too large; use a shorter clip.");
            runFF(new String[]{"-y","-ss",ss,"-i",source.getPath(),"-t",len,"-vn","-af","aformat=channel_layouts=mono","-c:a","libopus","-b:a","32k","-ar","48000",audio.getPath()});
            command(new JSONObject().put("type","send").put("webp",webp.getPath()).put("audio",audio.getPath()).put("seconds",Math.max(1,Math.round(length))));
            source.delete();
        }catch(Exception e){runOnUiThread(()->{working=false;send.setEnabled(linked);status.setText("Could not create sticker: "+e.getMessage());});}}).start();
    }
    private void runFF(String[] args){FFmpegSession s=FFmpegKit.executeWithArguments(args);if(!ReturnCode.isSuccess(s.getReturnCode())){String log=s.getAllLogsAsString();throw new IllegalStateException("Video conversion failed: "+(log==null?"no log":log.substring(Math.max(0,log.length()-1200))));}}
    private void codecSmoke(){new Thread(()->{try{
        FFmpegSession encoders=FFmpegKit.executeWithArguments(new String[]{"-hide_banner","-encoders"});
        try(FileOutputStream log=new FileOutputStream(new File(base,"encoders.txt"))){log.write(encoders.getAllLogsAsString().getBytes(StandardCharsets.UTF_8));}
        File src=new File(base,"smoke.mp4"),webp=new File(base,"smoke.webp"),ogg=new File(base,"smoke.ogg");
        runFF(new String[]{"-y","-f","lavfi","-i","testsrc2=s=320x240:r=12:d=1","-f","lavfi","-i","sine=frequency=440:duration=1","-c:v","mpeg4","-c:a","aac","-shortest",src.getPath()});
        File framesDir=new File(base,"smoke-frames");framesDir.mkdirs();
        runFF(new String[]{"-y","-i",src.getPath(),"-vf","crop=160:240:0:0,fps=10,scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000","-an","-c:v","png",new File(framesDir,"frame_%04d.png").getPath()});
        File[] frames=framesDir.listFiles((d,n)->n.endsWith(".png"));if(frames==null)throw new IllegalStateException("Frames missing");Arrays.sort(frames);AnimatedWebp.encode(frames,webp,35,100);for(File f:frames)f.delete();framesDir.delete();
        runFF(new String[]{"-y","-i",src.getPath(),"-vn","-af","aformat=channel_layouts=mono","-c:a","libopus","-b:a","32k","-ar","48000",ogg.getPath()});
        android.graphics.drawable.Drawable decoded=android.graphics.ImageDecoder.decodeDrawable(android.graphics.ImageDecoder.createSource(webp));
        JSONObject result=new JSONObject().put("ok",decoded instanceof android.graphics.drawable.AnimatedImageDrawable&&webp.length()>0&&webp.length()<=500*1024&&ogg.length()>0).put("webpBytes",webp.length()).put("audioBytes",ogg.length()).put("frames",frames.length).put("decoder",decoded.getClass().getSimpleName());
        try(FileOutputStream out=new FileOutputStream(new File(base,"codec-check.json"))){out.write(result.toString().getBytes(StandardCharsets.UTF_8));}
        src.delete();webp.delete();ogg.delete();
    }catch(Exception e){try(FileOutputStream out=new FileOutputStream(new File(base,"codec-check.json"))){out.write(("error: "+e.getMessage()).getBytes(StandardCharsets.UTF_8));}catch(Exception ignored){}}}).start();}
    @Override protected void onDestroy(){handler.removeCallbacks(pollState);super.onDestroy();}

    private final class CropView extends View {
        Bitmap bitmap; final Paint paint=new Paint(3); RectF image=new RectF(); float x=0,y=0,w=1,h=1,downX,downY;
        CropView(){super(MainActivity.this);setBackgroundColor(0xff172824);}
        void setBitmap(Bitmap b){bitmap=b;x=0;y=0;w=1;h=1;invalidate();}
        float[] box(){return new float[]{x,y,w,h};}
        @Override protected void onDraw(Canvas c){super.onDraw(c);if(bitmap==null)return;float scale=Math.min((float)getWidth()/bitmap.getWidth(),(float)getHeight()/bitmap.getHeight());float iw=bitmap.getWidth()*scale,ih=bitmap.getHeight()*scale;image.set((getWidth()-iw)/2,(getHeight()-ih)/2,(getWidth()+iw)/2,(getHeight()+ih)/2);paint.setStyle(Paint.Style.FILL);c.drawBitmap(bitmap,null,image,paint);paint.setColor(0xff30dbab);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(dp(3));c.drawRect(image.left+x*iw,image.top+y*ih,image.left+(x+w)*iw,image.top+(y+h)*ih,paint);paint.setColor(Color.WHITE);}
        @Override public boolean onTouchEvent(MotionEvent e){if(bitmap==null)return false;float a=Math.max(0,Math.min(1,(e.getX()-image.left)/image.width())),b=Math.max(0,Math.min(1,(e.getY()-image.top)/image.height()));if(e.getAction()==MotionEvent.ACTION_DOWN){downX=a;downY=b;return true;}if(e.getAction()==MotionEvent.ACTION_MOVE||e.getAction()==MotionEvent.ACTION_UP){x=Math.min(a,downX);y=Math.min(b,downY);w=Math.abs(a-downX);h=Math.abs(b-downY);if(e.getAction()==MotionEvent.ACTION_UP&&(w<0.03f||h<0.03f)){x=0;y=0;w=1;h=1;}invalidate();return true;}return true;}
    }
}
