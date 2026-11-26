package com.soundsticker.runtimecheck;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;

/** Builds a 512px animated WebP from Android-encoded still WebP frames. */
final class AnimatedWebp {
    private static void le(ByteArrayOutputStream out, int n, int count){for(int i=0;i<count;i++)out.write((n >>> (i*8))&255);}
    private static void tag(ByteArrayOutputStream out,String text){byte[] b=text.getBytes(StandardCharsets.US_ASCII);out.write(b,0,b.length);}
    private static void chunk(ByteArrayOutputStream out,String name,byte[] data){tag(out,name);le(out,data.length,4);out.write(data,0,data.length);if((data.length&1)!=0)out.write(0);}
    private static int readInt(byte[] b,int p){return (b[p]&255)|((b[p+1]&255)<<8)|((b[p+2]&255)<<16)|((b[p+3]&255)<<24);}
    private static byte[] framePayload(File input,int quality)throws Exception{
        Bitmap bitmap=BitmapFactory.decodeFile(input.getPath());if(bitmap==null)throw new IllegalStateException("Could not decode a video frame.");
        ByteArrayOutputStream still=new ByteArrayOutputStream();
        boolean ok=bitmap.compress(Bitmap.CompressFormat.WEBP,quality,still);bitmap.recycle();if(!ok)throw new IllegalStateException("WebP encoding failed.");
        byte[] b=still.toByteArray();if(b.length<20||!new String(b,0,4,StandardCharsets.US_ASCII).equals("RIFF")||!new String(b,8,4,StandardCharsets.US_ASCII).equals("WEBP"))throw new IllegalStateException("Invalid WebP frame.");
        ByteArrayOutputStream payload=new ByteArrayOutputStream();boolean image=false;
        for(int p=12;p+8<=b.length;){String name=new String(b,p,4,StandardCharsets.US_ASCII);int n=readInt(b,p+4);if(n<0||p+8L+n>b.length)throw new IllegalStateException("Invalid WebP chunk.");if(name.equals("ALPH")||name.equals("VP8 ")||name.equals("VP8L")){chunk(payload,name,Arrays.copyOfRange(b,p+8,p+8+n));if(name.equals("VP8 ")||name.equals("VP8L"))image=true;}p+=8+n+(n&1);}
        if(!image)throw new IllegalStateException("WebP image chunk missing.");return payload.toByteArray();
    }
    static void encode(File[] frames,File output,int quality,int frameMs)throws Exception{
        if(frames.length<2)throw new IllegalStateException("The selected clip is too short.");
        ByteArrayOutputStream body=new ByteArrayOutputStream();
        ByteArrayOutputStream vp8x=new ByteArrayOutputStream();vp8x.write(0x12);le(vp8x,0,3);le(vp8x,511,3);le(vp8x,511,3);chunk(body,"VP8X",vp8x.toByteArray());
        chunk(body,"ANIM",new byte[]{0,0,0,0,0,0});
        for(File frame:frames){ByteArrayOutputStream anmf=new ByteArrayOutputStream();le(anmf,0,3);le(anmf,0,3);le(anmf,511,3);le(anmf,511,3);le(anmf,frameMs,3);anmf.write(2);byte[] image=framePayload(frame,quality);anmf.write(image);chunk(body,"ANMF",anmf.toByteArray());}
        try(FileOutputStream out=new FileOutputStream(output)){out.write("RIFF".getBytes(StandardCharsets.US_ASCII));int size=body.size()+4;for(int i=0;i<4;i++)out.write((size >>> (i*8))&255);out.write("WEBP".getBytes(StandardCharsets.US_ASCII));body.writeTo(out);}
    }
}
