package __PACKAGE_ID__;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The whole native half of the app: a full-screen WebView on the deployed origin.
 *
 * There is no bundled web code and no browser hand-off. The site's own service
 * worker, Access cookies and updates socket all live inside this WebView, so the
 * PWA opens in the app whatever the reader's default browser is.
 */
public final class MainActivity extends Activity {
    private static final int AUDIO_REQUEST = 1;
    private static final int FILE_REQUEST = 2;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingAudio;
    private OnBackInvokedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        keepBelowSystemBars();

        webView = new WebView(this);
        setContentView(webView);

        // Apps targeting SDK 36 are no longer called back through
        // onBackPressed on Android 16, so the gesture is registered with the
        // platform dispatcher. The onBackPressed override stays as the
        // API 24-32 path.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        // Attachments come from the native picker below, which grants this app
        // a read permission for each chosen URI. The WebView itself only loads
        // the deployed https origin, so it never needs to load content:// URLs.
        settings.setAllowContentAccess(false);

        // Access runs on the origin itself, but its login round trip may involve
        // another Cloudflare host. Both need cookies to survive inside WebView.
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                String[] audio = { PermissionRequest.RESOURCE_AUDIO_CAPTURE };
                if (!Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(audio);
                    return;
                }
                pendingAudio = request;
                requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, AUDIO_REQUEST);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                Intent picker = params.createIntent();
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(picker, getString(R.string.choose_files)), FILE_REQUEST);
                } catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                }
                return true;
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String disposition, String mimeType, long contentLength) {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.setType(mimeType == null || mimeType.isEmpty() ? "*/*" : mimeType);
                try {
                    startActivity(intent);
                } catch (ActivityNotFoundException ignored) {
                    // Nothing on the device can open this type; stay in the app.
                }
            }
        });

        webView.loadUrl(getString(R.string.start_url));
    }

    /** In-scope pages stay in the WebView; other schemes go to the system. */
    private boolean handleNavigation(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme != null && (scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
            return false;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // No handler for a tg:/mailto: link is a dead end, not a crash.
        }
        return true;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_REQUEST || fileCallback == null) {
            return;
        }
        List<Uri> picked = new ArrayList<>();
        if (resultCode == RESULT_OK && data != null) {
            Uri single = data.getData();
            if (single != null) {
                picked.add(single);
            }
            if (data.getClipData() != null) {
                for (int index = 0; index < data.getClipData().getItemCount(); index += 1) {
                    Uri uri = data.getClipData().getItemAt(index).getUri();
                    if (!picked.contains(uri)) {
                        picked.add(uri);
                    }
                }
            }
            for (Uri uri : picked) {
                try {
                    getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (SecurityException ignored) {
                    // A single-shot URI is still readable for this upload.
                }
            }
        }
        fileCallback.onReceiveValue(picked.toArray(new Uri[0]));
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != AUDIO_REQUEST || pendingAudio == null) {
            return;
        }
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            pendingAudio.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        } else {
            pendingAudio.deny();
        }
        pendingAudio = null;
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    /**
     * The page owns in-app navigation, so back asks it first. The SPA's
     * `window.__pigeongramBack` is the same traversal as its own back button:
     * it answers 1 when it moved, 0 when the chat list is the root, and is
     * absent on the login screen or a web build older than the seam.
     */
    private void handleBack() {
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript(
                "(window.__pigeongramBack ? (window.__pigeongramBack() ? 1 : 0) : -1)",
                value -> {
                    if ("1".equals(value)) {
                        return;
                    }
                    if ("0".equals(value)) {
                        finish();
                        return;
                    }
                    goBackInHistory();
                });
    }

    /**
     * The fallback when the page cannot answer. canGoBack() and goBack() go
     * stale for entries the SPA seeds with back-to-back replaceState and
     * pushState, so the back-forward list gates the step and the page's own
     * history performs it.
     */
    private void goBackInHistory() {
        if (webView.copyBackForwardList().getCurrentIndex() > 0) {
            webView.evaluateJavascript("history.back()", null);
            return;
        }
        finish();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        backCallback = null;
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
        }
        fileCallback = null;
        super.onDestroy();
    }

    // Android 15+ draws under the system bars. Padding the decor view keeps the
    // WebView below them without consuming the insets `adjustResize` needs.
    @SuppressWarnings("deprecation")
    private void keepBelowSystemBars() {
        getWindow().getDecorView().setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(
                    insets.getSystemWindowInsetLeft(),
                    insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(),
                    insets.getSystemWindowInsetBottom());
            return insets;
        });
    }
}
