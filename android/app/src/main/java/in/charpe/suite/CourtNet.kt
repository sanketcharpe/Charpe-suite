package `in`.charpe.suite

import android.util.Base64
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * The phone's own connection to the court sites — what Charpe Helper does on a PC.
 *
 * Each CAPTCHA search on a court site lives in its own "session": the site
 * remembers which CAPTCHA picture it showed by a cookie, so two searches running
 * at once must never share cookies. Exactly like the helper's requests.Session(),
 * every session here gets its own cookie jar, kept only in memory and thrown
 * away after 30 minutes.
 */
class CourtNet {

    private class Jar : CookieJar {
        val store = ConcurrentHashMap<String, Cookie>()
        var used = System.currentTimeMillis()
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            used = System.currentTimeMillis()
            for (c in cookies) store[c.domain + c.path + c.name] = c
        }
        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            used = System.currentTimeMillis()
            val now = System.currentTimeMillis()
            return store.values.filter { it.expiresAt > now && it.matches(url) }
        }
    }

    private val jars = ConcurrentHashMap<String, Jar>()

    /* one shared client (connection pool, threads); each session borrows it with its own jar */
    private val base: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .addNetworkInterceptor { chain ->
            val r = chain.request()
            val b = r.newBuilder()
            if (r.header("User-Agent").isNullOrBlank()) b.header("User-Agent", UA)
            if (r.header("Accept-Language").isNullOrBlank()) b.header("Accept-Language", "en-IN,en;q=0.9")
            if (r.header("Accept").isNullOrBlank()) b.header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            chain.proceed(b.build())
        }
        .build()

    /* Some court sites send an incomplete certificate chain, which Chrome repairs on
       its own and Android does not. For those court addresses only, and only after the
       normal check has failed, the request is tried again accepting their certificate.
       Nothing private is ever sent this way — only case numbers and CAPTCHA answers for
       public court records. */
    private val lenient: OkHttpClient by lazy {
        val tm = object : X509TrustManager {
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String) {}
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }
        val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(tm), SecureRandom()) }
        base.newBuilder()
            .sslSocketFactory(ctx.socketFactory, tm)
            .hostnameVerifier { host, _ -> COURT_HOSTS.any { host == it || host.endsWith(".$it") } }
            .build()
    }

    private fun jar(id: String): Jar {
        sweep()
        return jars.getOrPut(id) { Jar() }
    }

    private fun sweep() {
        val old = System.currentTimeMillis() - 30 * 60 * 1000
        jars.entries.removeIf { it.value.used < old }
    }

    fun drop(id: String) { jars.remove(id) }

    /** One request, described by the page as JSON; the answer goes back as JSON. */
    fun handle(m: JSONObject): JSONObject {
        val out = JSONObject().put("id", m.optString("id"))
        if (m.optString("op") == "drop") { drop(m.optString("sess")); return out.put("ok", true) }
        try {
            val url = m.getString("url")
            val host = android.net.Uri.parse(url).host ?: ""
            if (!url.startsWith("https://") || COURT_HOSTS.none { host == it || host.endsWith(".$it") }) {
                return out.put("ok", false).put("err", "That address is not one the app fetches.")
            }
            val method = m.optString("method", "GET").uppercase()
            val headers = m.optJSONObject("headers") ?: JSONObject()
            var ctype: String? = null
            val rb = Request.Builder().url(url)
            for (k in headers.keys()) {
                val v = headers.optString(k)
                if (k.equals("content-type", true)) ctype = v
                rb.header(k, v)
            }
            if (method == "POST") {
                val body = if (m.isNull("body")) "" else m.optString("body")
                rb.post(body.toByteArray(Charsets.UTF_8).toRequestBody((ctype ?: "application/x-www-form-urlencoded").toMediaTypeOrNull()))
            } else rb.get()
            val timeout = m.optLong("timeout", 60).coerceIn(5, 180)
            val req = rb.build()
            val j = jar(m.optString("sess", "default"))
            val call = { c: OkHttpClient -> c.newBuilder().cookieJar(j).callTimeout(timeout, TimeUnit.SECONDS).build().newCall(req).execute() }
            val resp = try { call(base) } catch (e: SSLException) { call(lenient) }
            resp.use { r ->
                out.put("ok", true).put("status", r.code).put("url", r.request.url.toString())
                    .put("ctype", r.header("Content-Type") ?: "")
                val bytes = r.body?.bytes() ?: ByteArray(0)
                if (m.optBoolean("bin")) out.put("b64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                else {
                    val cs = r.body?.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8
                    out.put("text", String(bytes, cs))
                }
            }
        } catch (e: Exception) {
            out.put("ok", false).put("err", (e.message ?: e.javaClass.simpleName).take(200))
        }
        return out
    }

    companion object {
        const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"

        /** The only sites the app fetches for the page — the same ones Charpe Helper fetches. */
        val COURT_HOSTS = listOf(
            "sci.gov.in",                 // Supreme Court (www., api.)
            "mahaitgov.in",               // MAT data (uatmat.)
            "mat.maharashtra.gov.in",     // MAT site
            "ecourts.gov.in",             // hcservices. and services. (High Court and district courts)
            "bombayhighcourt.gov.in"      // Bombay High Court's own site
        )
    }
}
