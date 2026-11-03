package eu.m4xim.stockpilot;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * StockPilot pour Android : vue sécurisée du site de production.
 * La session reste dans les cookies WebView et les opérations utilisent
 * directement les API du NAS (aucune base de stock locale).
 */
public class MainActivity extends Activity {
    private static final String HOST = "stockpilot.m4xim.eu";
    private static final String HOME = "https://" + HOST + "/";
    private static final int CAMERA_PERMISSION_REQUEST = 4102;

    private WebView browser;
    private PermissionRequest pendingCamera;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(7, 27, 34));
        getWindow().setNavigationBarColor(Color.rgb(7, 27, 34));

        browser = new WebView(this);
        browser.setBackgroundColor(Color.rgb(7, 27, 34));
        setContentView(browser);

        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        WebView.setWebContentsDebuggingEnabled(false);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false);

        browser.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equalsIgnoreCase(uri.getScheme()) &&
                    HOST.equalsIgnoreCase(uri.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "Lien indisponible", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    Toast.makeText(MainActivity.this,
                        "Connexion au serveur StockPilot indisponible", Toast.LENGTH_LONG).show();
                }
            }
        });

        browser.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleCameraRequest(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (pendingCamera == request) pendingCamera = null;
                });
            }
        });

        if (savedInstanceState != null) {
            browser.restoreState(savedInstanceState);
        } else {
            browser.loadUrl(HOME);
        }
    }

    private void handleCameraRequest(PermissionRequest request) {
        Uri origin = request.getOrigin();
        boolean fromStockPilot = origin != null &&
            "https".equalsIgnoreCase(origin.getScheme()) &&
            HOST.equalsIgnoreCase(origin.getHost());
        boolean videoRequested = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                videoRequested = true;
            }
        }
        if (!fromStockPilot || !videoRequested) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
        } else {
            if (pendingCamera != null) pendingCamera.deny();
            pendingCamera = request;
            requestPermissions(new String[] { Manifest.permission.CAMERA }, CAMERA_PERMISSION_REQUEST);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != CAMERA_PERMISSION_REQUEST || pendingCamera == null) return;
        PermissionRequest request = pendingCamera;
        pendingCamera = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
        } else {
            request.deny();
            Toast.makeText(this, "Autorisez la caméra pour scanner les étiquettes",
                Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        browser.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (browser != null && browser.canGoBack()) browser.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (pendingCamera != null) {
            pendingCamera.deny();
            pendingCamera = null;
        }
        if (browser != null) {
            browser.destroy();
            browser = null;
        }
        super.onDestroy();
    }
}
