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
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;
import org.json.JSONArray;

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
        col.addView(label("Select a video, then drag a crop box. Move it from the middle or resize it from a corner.",15));
        crop=new CropView(); col.addView(crop,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(280)));
        LinearLayout cropButtons=new LinearLayout(this);cropButtons.setOrientation(LinearLayout.HORIZONTAL);
        Button square=button("Square crop");square.setOnClickListener(v->crop.square());cropButtons.addView(square,new LinearLayout.LayoutParams(0,-2,1));
        Button full=button("Full frame");full.setOnClickListener(v->crop.reset());cropButtons.addView(full,new LinearLayout.LayoutParams(0,-2,1));col.addView(cropButtons);
        Button choose=button("Choose gallery video"); choose.setOnClickListener(v->choose()); col.addView(choose);
        LinearLayout times=new LinearLayout(this); times.setOrientation(LinearLayout.HORIZONTAL);
        start=entry("Start seconds", "0"); end=entry("End seconds", ""); times.addView(start,new LinearLayout.LayoutParams(0,-2,1)); times.addView(end,new LinearLayout.LayoutParams(0,-2,1)); col.addView(times);
        Button update=button("Preview start frame"); update.setOnClickListener(v->loadPreview()); col.addView(update);
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
        cleanupAfterRestart();
        new Thread(()->{try{
            File marker=new File(base,"runtime-ready-v8");
            if(!marker.exists()){
                deleteTree(new File(base,"node_modules"));
                try(ZipInputStream zip=new ZipInputStream(getAssets().open("runtime-v8.zip"))){
                    File canonical=base.getCanonicalFile();
                    for(ZipEntry e;(e=zip.getNextEntry())!=null;){File f=new File(base,e.getName()).getCanonicalFile();if(!f.getPath().startsWith(canonical.getPath()+File.separator))throw new SecurityException("Invalid asset path");if(e.isDirectory()){f.mkdirs();continue;}f.getParentFile().mkdirs();try(FileOutputStream out=new FileOutputStream(f)){byte[] b=new byte[65536];int n;while((n=zip.read(b))!=-1)out.write(b,0,n);}}
                }
                marker.createNewFile();
            }
            int code=startNode(new String[]{"node",new File(base,"sender.cjs").getPath(),base.getPath(),getCacheDir().getPath()});
            bootstrapError="Runtime stopped ("+code+"). Restart the app.";
        }catch(Throwable e){bootstrapError="Runtime failed: "+e.getMessage();}}).start();
    }
    private static void deleteTree(File file){if(file==null||!file.exists())return;if(Files.isSymbolicLink(file.toPath())){file.delete();return;}if(file.isDirectory()){File[] children=file.listFiles();if(children!=null)for(File child:children)deleteTree(child);}file.delete();}
    private void cleanupAfterRestart(){
        File[] jobs=getCacheDir().listFiles((dir,name)->name.startsWith("sticker-job-"));if(jobs!=null)for(File job:jobs)deleteTree(job);
        for(String name:new String[]{"input-video","sticker.webp","audio.ogg","audio-clean.wav","audio-waveform.pcm","frames","smoke.mp4","smoke.webp","smoke.ogg","smoke.wav","smoke.pcm","smoke-frames","encoders.txt","codec-check.json","result.json","command.json","command.tmp","state.json"})deleteTree(new File(base,name));
    }
    private void choose(){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("video/*");i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivityForResult(i,10);}
    @Override protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);if(req!=10||result!=RESULT_OK||data==null||data.getData()==null)return;selected=data.getData();try(MediaMetadataRetriever m=new MediaMetadataRetriever()){m.setDataSource(this,selected);duration=Double.parseDouble(m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))/1000.0;if(!"yes".equalsIgnoreCase(m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)))throw new IllegalArgumentException("Video has no audio.");start.setText("0");end.setText(String.format(Locale.US,"%.2f",Math.min(duration,10)));crop.reset();loadPreview();}catch(Exception e){selected=null;status.setText("Could not open video: "+e.getMessage());}}
    private void loadPreview(){if(selected==null)return;try{double t=Double.parseDouble(start.getText().toString());if(t<0||t>=duration)throw new IllegalArgumentException("Start must be within video.");try(MediaMetadataRetriever m=new MediaMetadataRetriever()){m.setDataSource(this,selected);Bitmap frame=m.getFrameAtTime((long)(t*1000000),MediaMetadataRetriever.OPTION_CLOSEST);if(frame==null)throw new IllegalStateException("No preview frame.");crop.setBitmap(frame);}}catch(Exception e){status.setText("Preview: "+e.getMessage());}}
    private void command(JSONObject data)throws Exception{File tmp=new File(base,"command.tmp"),target=new File(base,"command.json");try(FileOutputStream out=new FileOutputStream(tmp)){out.write(data.toString().getBytes(StandardCharsets.UTF_8));}Files.move(tmp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);}
    private void link(){try{String number=phone.getText().toString().replaceAll("[^0-9]","");if(number.length()<8||number.length()>15)throw new IllegalArgumentException("Enter phone number with country code.");startForegroundService(new Intent(this,LinkService.class));command(new JSONObject().put("type","connect").put("phone",number));status.setText("Connecting to WhatsApp…");}catch(Exception e){stopService(new Intent(this,LinkService.class));status.setText(e.getMessage());}}
    private final Runnable pollState=new Runnable(){@Override public void run(){try{if(bootstrapError!=null)status.setText(bootstrapError);File f=new File(base,"state.json");if(f.exists()){String raw=new String(Files.readAllBytes(f.toPath()),StandardCharsets.UTF_8);if(!raw.equals(lastState)){lastState=raw;JSONObject o=new JSONObject(raw);String s=o.optString("status");if(s.equals("connecting")){linked=false;send.setEnabled(false);status.setText("Reconnecting to WhatsApp…");}else if(s.equals("ready")){linked=false;send.setEnabled(false);pairing.setText("");status.setText("Ready. Enter your phone number with country code, then tap Link WhatsApp.");}else if(s.equals("pairing")){pairing.setText(o.optString("code"));status.setText("Copy this code, then enter it in WhatsApp Linked devices.");}else if(s.equals("linked")){stopService(new Intent(MainActivity.this,LinkService.class));linked=true;send.setEnabled(!working);pairing.setText("");status.setText("WhatsApp linked. Choose a video and create a sticker.");}else if(s.equals("sending")){status.setText("Uploading and sending…");}else if(s.equals("sent")){working=false;send.setEnabled(linked);status.setText("Sent. Open your own chat in WhatsApp and test the audio.");}else if(s.equals("error")){stopService(new Intent(MainActivity.this,LinkService.class));working=false;send.setEnabled(linked);status.setText(o.optString("message"));}}}}catch(Exception ignored){}handler.postDelayed(this,800);}};
    private void makeSticker(){
        if(!linked||selected==null){status.setText("Link WhatsApp and choose a video first.");return;}
        final double begin, length;try{begin=Double.parseDouble(start.getText().toString());double stop=Double.parseDouble(end.getText().toString());if(begin<0||stop<=begin||stop>duration+0.02||stop-begin>10)throw new IllegalArgumentException("Select a valid clip up to 10 seconds.");length=Math.min(stop,duration)-begin;}catch(Exception e){status.setText("Check the start and end times.");return;}
        final Uri input=selected;final float[] box=crop.box();working=true;send.setEnabled(false);status.setText("Converting video and audio on your phone…");
        new Thread(()->{File job=new File(getCacheDir(),"sticker-job-"+UUID.randomUUID());boolean handedOff=false;try{
            if(!job.mkdir())throw new IllegalStateException("Could not create temporary workspace.");
            File source=new File(job,"input-video"),webp=new File(job,"sticker.webp"),audio=new File(job,"audio.ogg");
            try(InputStream in=getContentResolver().openInputStream(input);FileOutputStream out=new FileOutputStream(source)){if(in==null)throw new IllegalStateException("Cannot read video.");byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}
            String ss=String.format(Locale.US,"%.3f",begin),len=String.format(Locale.US,"%.3f",length);
            String filter=String.format(Locale.US,"crop=trunc(iw*%.6f/2)*2:trunc(ih*%.6f/2)*2:trunc(iw*%.6f/2)*2:trunc(ih*%.6f/2)*2,fps=10,scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",box[2],box[3],box[0],box[1]);
            File framesDir=new File(job,"frames");framesDir.mkdirs();
            runFF(new String[]{"-y","-ss",ss,"-i",source.getPath(),"-t",len,"-an","-vf",filter,"-c:v","png",new File(framesDir,"frame_%04d.png").getPath()});
            File[] frames=framesDir.listFiles((d,n)->n.endsWith(".png"));if(frames==null)throw new IllegalStateException("Could not read frames.");Arrays.sort(frames);boolean fits=false;
            for(int q:new int[]{55,35,20,10,3}){AnimatedWebp.encode(frames,webp,q,100);if(webp.length()<=500*1024){fits=true;break;}}
            for(File f:frames)f.delete();framesDir.delete();
            if(!fits)throw new IllegalStateException("Sticker is too large; use a shorter clip.");
            String exact=String.format(Locale.US,"%.3f",frames.length/10.0);
            File wav=new File(job,"audio-clean.wav"),pcm=new File(job,"audio-waveform.pcm");
            runFF(new String[]{"-y","-ss",ss,"-i",source.getPath(),"-vn","-af","aresample=48000:first_pts=0,apad=whole_dur="+exact+",aformat=channel_layouts=mono","-c:a","pcm_s16le","-t",exact,wav.getPath()});
            runFF(new String[]{"-y","-i",wav.getPath(),"-c:a","libopus","-b:a","32k","-map_metadata","-1",audio.getPath()});
            runFF(new String[]{"-y","-i",audio.getPath(),"-vn","-af","aresample=8000,aformat=channel_layouts=mono","-f","s16le",pcm.getPath()});
            JSONArray waveform=waveform(Files.readAllBytes(pcm.toPath()));wav.delete();pcm.delete();
            command(new JSONObject().put("type","send").put("job",job.getPath()).put("webp",webp.getPath()).put("audio",audio.getPath()).put("seconds",Math.max(1,Math.round(frames.length/10.0f))).put("waveform",waveform));
            handedOff=true;
        }catch(Exception e){runOnUiThread(()->{working=false;send.setEnabled(linked);status.setText("Could not create sticker: "+e.getMessage());});}
        finally{if(!handedOff)deleteTree(job);else{deleteTree(new File(job,"input-video"));deleteTree(new File(job,"audio-clean.wav"));deleteTree(new File(job,"audio-waveform.pcm"));deleteTree(new File(job,"frames"));}}}).start();
    }
    private void runFF(String[] args){FFmpegSession s=FFmpegKit.executeWithArguments(args);if(!ReturnCode.isSuccess(s.getReturnCode())){String log=s.getAllLogsAsString();throw new IllegalStateException("Video conversion failed: "+(log==null?"no log":log.substring(Math.max(0,log.length()-1200))));}}
    private JSONArray waveform(byte[] pcm){int samples=pcm.length/2;int[] levels=new int[64];int peak=0;for(int i=0;i<64;i++){int from=i*samples/64,to=(i+1)*samples/64;long sum=0;for(int j=from;j<to;j++){int value=(short)((pcm[j*2]&255)|(pcm[j*2+1]<<8));sum+=Math.abs(value);}levels[i]=to>from?(int)(sum/(to-from)):0;peak=Math.max(peak,levels[i]);}JSONArray out=new JSONArray();for(int n:levels)out.put(peak==0?0:Math.round(100f*n/peak));return out;}
    private void codecSmoke(){new Thread(()->{try{
        FFmpegSession encoders=FFmpegKit.executeWithArguments(new String[]{"-hide_banner","-encoders"});
        try(FileOutputStream log=new FileOutputStream(new File(base,"encoders.txt"))){log.write(encoders.getAllLogsAsString().getBytes(StandardCharsets.UTF_8));}
        File src=new File(base,"smoke.mp4"),webp=new File(base,"smoke.webp"),ogg=new File(base,"smoke.ogg");
        runFF(new String[]{"-y","-f","lavfi","-i","testsrc2=s=320x240:r=12:d=1","-f","lavfi","-i","sine=frequency=440:duration=1","-c:v","mpeg4","-c:a","aac","-shortest",src.getPath()});
        File framesDir=new File(base,"smoke-frames");framesDir.mkdirs();
        runFF(new String[]{"-y","-i",src.getPath(),"-vf","crop=160:240:0:0,fps=10,scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000","-an","-c:v","png",new File(framesDir,"frame_%04d.png").getPath()});
        File[] frames=framesDir.listFiles((d,n)->n.endsWith(".png"));if(frames==null)throw new IllegalStateException("Frames missing");Arrays.sort(frames);AnimatedWebp.encode(frames,webp,35,100);for(File f:frames)f.delete();framesDir.delete();
        File wav=new File(base,"smoke.wav"),pcm=new File(base,"smoke.pcm");String exact=String.format(Locale.US,"%.3f",frames.length/10.0);
        runFF(new String[]{"-y","-i",src.getPath(),"-vn","-af","aresample=48000:first_pts=0,apad=whole_dur="+exact+",aformat=channel_layouts=mono","-c:a","pcm_s16le","-t",exact,wav.getPath()});
        runFF(new String[]{"-y","-i",wav.getPath(),"-c:a","libopus","-b:a","32k","-map_metadata","-1",ogg.getPath()});
        runFF(new String[]{"-y","-i",ogg.getPath(),"-vn","-af","aresample=8000,aformat=channel_layouts=mono","-f","s16le",pcm.getPath()});
        JSONArray wave=waveform(Files.readAllBytes(pcm.toPath()));int peak=0;for(int i=0;i<wave.length();i++)peak=Math.max(peak,wave.getInt(i));
        android.graphics.drawable.Drawable decoded=android.graphics.ImageDecoder.decodeDrawable(android.graphics.ImageDecoder.createSource(webp));
        JSONObject result=new JSONObject().put("ok",decoded instanceof android.graphics.drawable.AnimatedImageDrawable&&webp.length()>0&&webp.length()<=500*1024&&ogg.length()>0&&peak>0).put("webpBytes",webp.length()).put("audioBytes",ogg.length()).put("frames",frames.length).put("waveformPeak",peak).put("decoder",decoded.getClass().getSimpleName());
        try(FileOutputStream out=new FileOutputStream(new File(base,"codec-check.json"))){out.write(result.toString().getBytes(StandardCharsets.UTF_8));}
        src.delete();webp.delete();ogg.delete();wav.delete();pcm.delete();
    }catch(Exception e){try(FileOutputStream out=new FileOutputStream(new File(base,"codec-check.json"))){out.write(("error: "+e.getMessage()).getBytes(StandardCharsets.UTF_8));}catch(Exception ignored){}}}).start();}
    @Override protected void onDestroy(){handler.removeCallbacks(pollState);super.onDestroy();}

    private final class CropView extends View {
        Bitmap bitmap; final Paint paint=new Paint(3); final RectF image=new RectF();
        float x=0,y=0,w=1,h=1,downX,downY,originX,originY,anchorX,anchorY;
        int mode=0; // 1: new box or corner resize; 2: move selection
        CropView(){super(MainActivity.this);setBackgroundColor(0xff172824);setContentDescription("Video crop preview. Drag a box, drag a corner to resize, or drag inside to move.");}
        void setBitmap(Bitmap b){bitmap=b;invalidate();}
        void reset(){x=0;y=0;w=1;h=1;invalidate();}
        void square(){if(bitmap==null)return;float side=Math.min(bitmap.getWidth(),bitmap.getHeight());w=side/bitmap.getWidth();h=side/bitmap.getHeight();x=(1-w)/2;y=(1-h)/2;invalidate();}
        float[] box(){return new float[]{x,y,w,h};}
        float clamp(float n){return Math.max(0,Math.min(1,n));}
        @Override protected void onDraw(Canvas c){
            super.onDraw(c);if(bitmap==null)return;
            float scale=Math.min((float)getWidth()/bitmap.getWidth(),(float)getHeight()/bitmap.getHeight());float iw=bitmap.getWidth()*scale,ih=bitmap.getHeight()*scale;
            image.set((getWidth()-iw)/2,(getHeight()-ih)/2,(getWidth()+iw)/2,(getHeight()+ih)/2);
            paint.setStyle(Paint.Style.FILL);paint.setColor(Color.WHITE);c.drawBitmap(bitmap,null,image,paint);
            float l=image.left+x*iw,t=image.top+y*ih,r=image.left+(x+w)*iw,b=image.top+(y+h)*ih;
            paint.setColor(0x99000000);c.drawRect(image.left,image.top,image.right,t,paint);c.drawRect(image.left,b,image.right,image.bottom,paint);c.drawRect(image.left,t,l,b,paint);c.drawRect(r,t,image.right,b,paint);
            paint.setColor(0xff30dbab);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(dp(2));c.drawRect(l,t,r,b,paint);
            paint.setStyle(Paint.Style.FILL);paint.setColor(Color.WHITE);float radius=dp(6);c.drawCircle(l,t,radius,paint);c.drawCircle(r,t,radius,paint);c.drawCircle(l,b,radius,paint);c.drawCircle(r,b,radius,paint);
        }
        @Override public boolean onTouchEvent(MotionEvent e){
            if(bitmap==null||image.width()<=0||image.height()<=0)return false;
            float a=clamp((e.getX()-image.left)/image.width()),b=clamp((e.getY()-image.top)/image.height());
            if(e.getActionMasked()==MotionEvent.ACTION_DOWN){
                getParent().requestDisallowInterceptTouchEvent(true);downX=a;downY=b;originX=x;originY=y;
                float px=e.getX(),py=e.getY(),left=image.left+x*image.width(),right=image.left+(x+w)*image.width(),top=image.top+y*image.height(),bottom=image.top+(y+h)*image.height();
                float tolerance=dp(28);boolean nearLeft=Math.abs(px-left)<tolerance,nearRight=Math.abs(px-right)<tolerance,nearTop=Math.abs(py-top)<tolerance,nearBottom=Math.abs(py-bottom)<tolerance;
                if((nearLeft||nearRight)&&(nearTop||nearBottom)){mode=1;anchorX=nearLeft?x+w:x;anchorY=nearTop?y+h:y;}
                else if((w<0.999f||h<0.999f)&&a>=x&&a<=x+w&&b>=y&&b<=y+h){mode=2;}
                else{mode=1;anchorX=a;anchorY=b;}
                return true;
            }
            if(e.getActionMasked()==MotionEvent.ACTION_MOVE||e.getActionMasked()==MotionEvent.ACTION_UP){
                if(mode==2){x=Math.max(0,Math.min(1-w,originX+a-downX));y=Math.max(0,Math.min(1-h,originY+b-downY));}
                else if(mode==1){x=Math.min(a,anchorX);y=Math.min(b,anchorY);w=Math.abs(a-anchorX);h=Math.abs(b-anchorY);}
                if(e.getActionMasked()==MotionEvent.ACTION_UP){if(w<0.03f||h<0.03f)reset();mode=0;getParent().requestDisallowInterceptTouchEvent(false);performClick();}invalidate();return true;
            }
            if(e.getActionMasked()==MotionEvent.ACTION_CANCEL){mode=0;getParent().requestDisallowInterceptTouchEvent(false);return true;}return true;
        }
        @Override public boolean performClick(){super.performClick();return true;}
    }
}
