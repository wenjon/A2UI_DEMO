package com.example.a2uidemo

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * 车机预览页：把 demo 网页（?fit=1 全屏模式）直接铺满模拟器屏幕。
 *
 * 先把端口反代到本机：
 *   adb -s <device> reverse tcp:5173 tcp:5173
 *
 * 打开默认车机画面：
 *   adb shell am start -n com.example.a2uidemo/.HmiViewerActivity
 * 指定某个示例或某次生成结果：
 *   adb shell am start -n com.example.a2uidemo/.HmiViewerActivity --es url "http://127.0.0.1:5173/?example=41_hmi-navigation-2d.json&fit=1"
 */
class HmiViewerActivity : Activity() {

    companion object {
        private const val TAG = "A2uiHmi"
        private const val DEFAULT_URL = "http://127.0.0.1:5173/?fit=1"
    }

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val url = intent.getStringExtra("url") ?: DEFAULT_URL

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.i(TAG, "console: ${message.message()} @ ${message.sourceId()}:${message.lineNumber()}")
                    return true
                }
            }
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError,
                ) {
                    if (request.isForMainFrame) {
                        Log.e(TAG, "load failed: ${error.description} (${request.url})")
                    }
                }
                override fun onPageFinished(view: WebView, finishedUrl: String) {
                    Log.i(TAG, "page ready: $finishedUrl")
                }
            }
        }

        setContentView(webView)
        Log.i(TAG, "loading $url")
        webView.loadUrl(url)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
    }

    override fun onPause() {
        webView.pauseTimers()
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
