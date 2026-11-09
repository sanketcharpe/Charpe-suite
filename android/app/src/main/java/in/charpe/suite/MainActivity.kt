package `in`.charpe.suite

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.print.PrintManager
import android.util.Base64
import android.webkit.*
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

/**
 * Charpe Suite — the Android app.
 *
 * It opens the live Charpe Suite (the same pages the laptop and the office PCs
 * use), so every change published to GitHub reaches the phone without a new
 * install. What the app adds is what a browser cannot do:
 *
 *  · it fetches the court sites itself, from the phone's own connection — the
 *    job Charpe Helper does on a PC (CourtNet + assets/charpe-wrap.js);
 *  · it hands generated bills and PDFs to Android's share sheet and printer.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val net = CourtNet()
    private val pool = Executors.newFixedThreadPool(6)

    private val filePicker = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        cb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadsImagesAutomatically = true
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = true
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = true
        }
        CookieManager.getInstance().setAcceptCookie(true)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        installCourtFetching()

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.scheme == "https" && url.host == SITE_HOST) return false   // our own pages stay inside
                return try { startActivity(Intent(Intent.ACTION_VIEW, url)); true } catch (e: Exception) { true }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    view.loadDataWithBaseURL(null, OFFLINE_PAGE, "text/html", "utf-8", null)
                }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try { filePicker.launch(params.createIntent()); true } catch (e: Exception) { fileCallback = null; false }
            }
        }

        web.addJavascriptInterface(Bridge(), "AndroidBridge")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
        })

        if (savedInstanceState == null) web.loadUrl(START_URL) else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    /**
     * Two pieces, both limited to Charpe Suite's own address:
     *  1. a small script put into every page and frame before the page's own code
     *     runs (assets/charpe-wrap.js): whatever the page sends to Charpe Helper at
     *     127.0.0.1:8770 goes to the phone's engine instead;
     *  2. "CharpeNet", the channel through which that engine asks the app to
     *     fetch a court page — each frame gets its own answers.
     */
    private fun installCourtFetching() {
        val origins = setOf("https://$SITE_HOST")
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Toast.makeText(this, "Court fetching needs a newer \"Android System WebView\". Update it from the Play Store.", Toast.LENGTH_LONG).show()
            return
        }
        WebViewCompat.addWebMessageListener(web, "CharpeNet", origins) { _, message, sourceOrigin, _, reply ->
            if (sourceOrigin.host != SITE_HOST) return@addWebMessageListener
            val text = message.data ?: return@addWebMessageListener
            pool.execute {
                val answer = try { net.handle(JSONObject(text)).toString() }
                             catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "error").toString() }
                runOnUiThread { try { reply.postMessage(answer) } catch (e: Exception) { } }
            }
        }
        val wrap = assets.open("charpe-wrap.js").bufferedReader().use { it.readText() }
        WebViewCompat.addDocumentStartJavaScript(web, wrap, origins)
    }

    /** What the web side can ask the phone to do. */
    inner class Bridge {
        /** Save a generated file (a bill PDF, an Excel export) and offer it to the share sheet. */
        @JavascriptInterface
        fun saveFile(name: String, mime: String, b64: String) {
            runOnUiThread {
                try {
                    val safe = name.replace(Regex("[\\\\/:*?\"<>|]+"), "-").substringAfterLast('/').ifBlank { "charpe-file" }
                    val dir = File(cacheDir, "shared").apply { mkdirs() }
                    val out = File(dir, safe)
                    FileOutputStream(out).use { it.write(Base64.decode(b64, Base64.DEFAULT)) }
                    val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", out)
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = mime.ifBlank { "application/octet-stream" }
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(send, safe))
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Could not save $name", Toast.LENGTH_LONG).show()
                }
            }
        }

        @JavascriptInterface
        fun print(title: String) {
            runOnUiThread {
                try {
                    val pm = getSystemService(PRINT_SERVICE) as PrintManager
                    val job = title.ifBlank { "Charpe Suite" }
                    pm.print(job, web.createPrintDocumentAdapter(job), null)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "No printer service available", Toast.LENGTH_LONG).show()
                }
            }
        }

        @JavascriptInterface
        fun toast(msg: String) { runOnUiThread { Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show() } }

        /** Lets the page tell that it is inside the app, and which version. */
        @JavascriptInterface
        fun appVersion(): String = BuildConfig.VERSION_NAME

        /** "Reload" from the offline page. */
        @JavascriptInterface
        fun retry() { runOnUiThread { web.loadUrl(START_URL) } }
    }

    override fun onDestroy() {
        pool.shutdownNow()
        super.onDestroy()
    }

    companion object {
        const val SITE_HOST = "sanketcharpe.github.io"
        const val START_URL = "https://sanketcharpe.github.io/Charpe-suite/"
        val OFFLINE_PAGE = """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font-family:sans-serif;background:#eef0f4;color:#151d2b;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
            button{margin-top:18px;padding:12px 26px;border:0;border-radius:8px;background:#1668e3;color:#fff;font-size:16px}</style></head>
            <body><div><h2>No internet just now</h2><p>Charpe Suite opens once the phone is online.<br>Your data on this phone is safe.</p>
            <button onclick="AndroidBridge.retry()">Try again</button></div></body></html>
        """.trimIndent()
    }
}
