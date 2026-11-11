package ru.ilyadasler.sozvon.mobile;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private SharedPreferences sessionPrefs;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sessionPrefs = getSharedPreferences("sozvon_session", MODE_PRIVATE);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        registerSessionBridge();
        WebView web = getBridge().getWebView();
        if (web != null) web.setWebViewClient(new OAuthWebViewClient(getBridge(), this));
        handleOAuthIntent(getIntent());
    }

    @Override
    public void onStart() {
        super.onStart();
        registerSessionBridge();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOAuthIntent(intent);
    }

    public boolean isOAuthReturn(Uri uri) {
        if (uri == null) return false;
        if ("sozvon".equals(uri.getScheme()) && "oauth".equals(uri.getHost())) return true;
        return "https".equals(uri.getScheme())
            && "localhost".equals(uri.getHost())
            && "/index.html".equals(uri.getPath())
            && (uri.getQueryParameter("oauth_code") != null || uri.getQueryParameter("oauth_error") != null);
    }

    public void handleOAuthUrl(String url) {
        WebView web = getBridge().getWebView();
        if (web == null) return;
        web.postDelayed(
            () -> web.evaluateJavascript(
                "window.handleOAuthReturn && window.handleOAuthReturn(" + JSONObject.quote(url) + ")",
                null
            ),
            300
        );
    }

    private void handleOAuthIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null || !"sozvon".equals(data.getScheme()) || !"oauth".equals(data.getHost())) return;
        WebView web = getBridge().getWebView();
        if (web == null) return;
        handleOAuthUrl(data.toString());
    }

    private void registerSessionBridge() {
        WebView web = getBridge().getWebView();
        if (web != null) {
            web.removeJavascriptInterface("NativeSession");
            web.addJavascriptInterface(new NativeSession(), "NativeSession");
        }
    }

    private final class NativeSession {
        @JavascriptInterface
        public void save(String value) {
            try {
                JSONObject parsed = new JSONObject(value);
                if (parsed.optString("token").isEmpty()) {
                    sessionPrefs.edit().remove("session").apply();
                } else {
                    sessionPrefs.edit().putString("session", value).apply();
                }
            } catch (Exception ignored) {
                sessionPrefs.edit().remove("session").apply();
            }
        }

        @JavascriptInterface
        public String load() {
            return sessionPrefs.getString("session", "");
        }

        @JavascriptInterface
        public void clear() {
            sessionPrefs.edit().remove("session").apply();
        }
    }

    @Override
    public void onBackPressed() {
        WebView web = getBridge().getWebView();
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
            "(function(){try{return window.sozvonBack && window.sozvonBack() ? '1' : '0';}catch(e){return '0';}})()",
            value -> {
                if (!"\"1\"".equals(value)) super.onBackPressed();
            }
        );
    }
}
