package com.tahosapp.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** This plugin never requests a microphone permission or opens a microphone. */
@CapacitorPlugin(name = "CallSession")
public class CallSessionPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            if (getActivity() == null || getActivity().isFinishing()
                    || !getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
                call.reject("Open the app before starting background voice audio.", "APP_NOT_FOREGROUND");
                return;
            }
            // Android 14+ also enforces the while-in-use permission at service
            // creation time; a grant by itself does not allow a background start.
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                call.reject("Join a voice conversation and allow microphone access first.", "MICROPHONE_PERMISSION_REQUIRED");
                return;
            }

            ResultReceiver receiver = new ResultReceiver(new Handler(Looper.getMainLooper())) {
                @Override
                protected void onReceiveResult(int resultCode, Bundle resultData) {
                    if (resultCode == CallService.RESULT_STARTED) {
                        JSObject result = new JSObject();
                        result.put("active", true);
                        call.resolve(result);
                    } else {
                        call.reject("The background voice service could not start.", "CALL_SERVICE_UNAVAILABLE");
                    }
                }
            };
            Intent intent = new Intent(getContext(), CallService.class)
                .putExtra(CallService.EXTRA_TITLE, call.getString("title", "tahosapp sesli görüşme"))
                .putExtra(CallService.EXTRA_RESULT, receiver);
            try {
                ContextCompat.startForegroundService(getContext(), intent);
            } catch (RuntimeException error) {
                call.reject("The background voice service could not start.", "CALL_SERVICE_UNAVAILABLE", error);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            getContext().stopService(new Intent(getContext(), CallService.class));
            JSObject result = new JSObject();
            result.put("active", false);
            call.resolve(result);
        });
    }

    @Override
    protected void handleOnDestroy() {
        // Once the bridge is destroyed the WebRTC session no longer exists.
        getContext().stopService(new Intent(getContext(), CallService.class));
    }
}
