package com.soundsticker.runtimecheck;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.IBinder;

/** Keeps the connection process active while the user switches to WhatsApp. */
public final class LinkService extends Service {
    private static final String CHANNEL="sticker_link";
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL,"WhatsApp linking",NotificationManager.IMPORTANCE_LOW));
        Notification notification=new Notification.Builder(this,CHANNEL)
            .setContentTitle("Sound Sticker Studio")
            .setContentText("Keeping WhatsApp linking active")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true).build();
        if(android.os.Build.VERSION.SDK_INT>=34)startForeground(73,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(73,notification);
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent){return null;}
}
