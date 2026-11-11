package ru.ilyadasler.sozvon.mobile;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    }

    @Override
    public void onBackPressed() {
        WebView web = getBridge().getWebView();
        if (web == null) {
            super.onBackPressed();
            return;
        }
        // JS закрывает ровно один верхний слой. Только если он вернул false,
        // отдаём событие системе/Capacitor (выход из приложения).
        web.evaluateJavascript(
            "(function(){try{return window.sozvonBack && window.sozvonBack() ? '1' : '0';}catch(e){return '0';}})()",
            value -> {
                if (!"\"1\"".equals(value)) {
                    super.onBackPressed();
                }
            }
        );
    }
}
