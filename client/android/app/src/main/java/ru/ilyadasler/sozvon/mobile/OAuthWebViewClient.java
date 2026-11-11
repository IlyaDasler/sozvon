package ru.ilyadasler.sozvon.mobile;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

public class OAuthWebViewClient extends BridgeWebViewClient {
    private final MainActivity activity;

    public OAuthWebViewClient(Bridge bridge, MainActivity activity) {
        super(bridge);
        this.activity = activity;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (activity.isOAuthReturn(uri)) {
            activity.handleOAuthUrl(uri.toString());
            return true;
        }
        return super.shouldOverrideUrlLoading(view, request);
    }
}
