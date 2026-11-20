package com.cybernode.console;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.URISyntaxException;

public final class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(9, 14, 22));
        getWindow().setNavigationBarColor(Color.rgb(9, 14, 22));
        getWindow().getDecorView().setSystemUiVisibility(0);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(9, 14, 22));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isAppUrl(uri)) {
                    return false;
                }
                openExternalUri(uri);
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (isAppUrl(uri)) {
                    return false;
                }
                openExternalUri(uri);
                return true;
            }
        });
        setContentView(webView);

        String appLink = appLinkUrl(getIntent());
        boolean restored = savedInstanceState != null && webView.restoreState(savedInstanceState) != null;
        if (appLink != null) {
            webView.loadUrl(appLink);
        } else if (!restored) {
            webView.loadUrl(BuildConfig.APP_URL);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String appLink = appLinkUrl(intent);
        if (webView != null && appLink != null) {
            webView.loadUrl(appLink);
        }
    }

    private String appLinkUrl(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        return uri != null && isAppUrl(uri) ? uri.toString() : null;
    }

    private boolean isAppUrl(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme())
            && BuildConfig.APP_HOST.equalsIgnoreCase(uri.getHost());
    }

    private void openExternalUri(Uri uri) {
        try {
            Intent intent;
            if ("intent".equalsIgnoreCase(uri.getScheme())) {
                intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                if (intent.resolveActivity(getPackageManager()) == null && intent.getData() == null) {
                    return;
                }
            } else {
                intent = new Intent(Intent.ACTION_VIEW, uri);
            }
            startActivity(intent);
        } catch (ActivityNotFoundException | URISyntaxException ignored) {
            // External wallets and browsers are optional; keep the app open if none can handle a link.
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) {
            webView.saveState(outState);
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
