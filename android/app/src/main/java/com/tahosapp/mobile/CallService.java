package com.tahosapp.mobile;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.ResultReceiver;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/** Keeps an existing WebRTC microphone session eligible for background audio. */
public class CallService extends Service {
    static final String EXTRA_TITLE = "callTitle";
    static final String EXTRA_RESULT = "callResult";
    static final int RESULT_STARTED = 1;
    static final int RESULT_FAILED = 0;
    private static final String CHANNEL_ID = "tahosapp_voice_calls";
    private static final int NOTIFICATION_ID = 7101;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // A killed WebView cannot restore its WebRTC session. Never restart a
        // microphone service without a new, visible user-initiated voice session.
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        ResultReceiver receiver = readReceiver(intent);
        try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                throw new SecurityException("Microphone permission is required.");
            }
            createNotificationChannel();
            int serviceType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID,
                createNotification(intent.getStringExtra(EXTRA_TITLE)), serviceType);
            if (receiver != null) receiver.send(RESULT_STARTED, Bundle.EMPTY);
        } catch (RuntimeException error) {
            // Permission can change between the plugin check and service start.
            // Report denial to the app instead of crashing or claiming success.
            if (receiver != null) {
                Bundle result = new Bundle();
                result.putString("error", "The background voice service could not start.");
                receiver.send(RESULT_FAILED, result);
            }
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
                "Sesli görüşmeler", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Devam eden tahosapp sesli görüşmeleri");
            channel.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private Notification createNotification(String title) {
        String safeTitle = title == null ? "" : title.trim();
        if (safeTitle.isEmpty()) safeTitle = "tahosapp sesli görüşme";
        if (safeTitle.length() > 100) safeTitle = safeTitle.substring(0, 100);
        Intent openApp = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // The notification returns to the existing app task. Ending a call is
        // handled there, so native service state and WebRTC state stay in sync.
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle(safeTitle)
            .setContentText("Sesli görüşme sürüyor. Uygulamaya dönmek için dokun.")
            .setContentIntent(contentIntent)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build();
    }

    @SuppressWarnings("deprecation")
    private ResultReceiver readReceiver(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(EXTRA_RESULT, ResultReceiver.class);
        }
        return intent.getParcelableExtra(EXTRA_RESULT);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
