"""
Charpe Suite — PC helper                                                  Oct 2026
---------------------------------------------------------------------------------
The Supreme Court site turns away requests from Google's servers, and the MAT
site cannot be reached from them at all. This small helper runs on the office
PC and fetches those two sites for Charpe Suite from YOUR internet connection,
exactly as your own browser does. It listens only on this computer
(127.0.0.1:8770) and only answers Charpe Suite's own web address.

  Supreme Court  — case details, listing dates, orders/judgments by diary number;
                   the one-time CAPTCHA search by case number (you type the answer)
  MAT Nagpur     — the judgments list, the Order calendar and each day's PDF

Nothing is stored here: what is fetched goes straight back to Charpe Suite,
which keeps the PDFs in your Drive folder as before.

Start: double-click "Install Charpe Helper.bat" once — it also starts with Windows.
Check: open http://127.0.0.1:8770/ in the browser — it says "Charpe helper is running".
"""
import base64, html, json, re, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urlencode, urlparse

VERSION = 1
PORT = 8770
ALLOWED_ORIGINS = ("https://sanketcharpe.github.io", "http://127.0.0.1", "http://localhost")
PDF_HOSTS = ("api.sci.gov.in", "www.sci.gov.in", "sci.gov.in", "uatmat.mahaitgov.in", "mat.maharashtra.gov.in")

SCI_BASE = "https://www.sci.gov.in"
SCI_AJAX = SCI_BASE + "/wp-admin/admin-ajax.php"
MAT_FEED = "https://uatmat.mahaitgov.in/api/final-judgments/2"
MAT_PAGE = "https://mat.maharashtra.gov.in/nagpur"
MAT_FILES = "https://uatmat.mahaitgov.in/storage/finalord/"
MAT_DAYS = "https://uatmat.mahaitgov.in/api/day-status/2"
MAT_ORDERS = "https://uatmat.mahaitgov.in/storage/orders/"

# ------------------------------------------------------------------ http
try:
    from curl_cffi import requests as creq   # looks like real Chrome to the site's firewall
    def new_session():
        return creq.Session(impersonate="chrome")
    ENGINE = "chrome"
except Exception:                             # plain requests as a fallback
    import requests as creq
    def new_session():
        s = creq.Session()
        s.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
                          "Accept-Language": "en-IN,en;q=0.9"})
        return s
    ENGINE = "requests"

LOCK = threading.Lock()
SCI_S = {"s": None, "at": 0}
SESS = {}          # CAPTCHA searches in progress


def sci_session(force=False):
    with LOCK:
        if force or SCI_S["s"] is None or time.time() - SCI_S["at"] > 900:
            s = new_session()
            try:
                s.get(SCI_BASE + "/case-status-diary-no/", timeout=40)
            except Exception:
                pass
            SCI_S.update(s=s, at=time.time())
        return SCI_S["s"]


def get(s, url, referer=None, xhr=False, **kw):
    h = {"Referer": referer or url}
    if xhr:
        h.update({"Accept": "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest"})
    last = None
    for attempt in range(3):
        try:
            return s.get(url, headers=h, timeout=60, **kw)
        except Exception as e:
            last = e
            time.sleep(1 + attempt)
    raise RuntimeError("The site could not be reached just now (%s). Please try again." % str(last)[:80])


# ------------------------------------------------------------------ text helpers (same as the backend)
def unent(h):
    return html.unescape(str(h or "").replace("&nbsp", " ").replace("\xa0", " "))


def strip(h):
    h = str(h or "")
    h = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", h, flags=re.I)
    h = re.sub(r"<br\s*/?>", "\n", h, flags=re.I)
    h = re.sub(r"</(p|div|tr|li|h\d)>", "\n", h, flags=re.I)
    h = unent(re.sub(r"<[^>]+>", " ", h))
    h = re.sub(r"[ \t\r\f\v]+", " ", h)
    h = re.sub(r" *\n *", "\n", h)
    return re.sub(r"\n{2,}", "\n", h).strip()


def norm(s):
    return re.sub(r"[^a-z]", "", str(s or "").lower())


MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def iso(s):
    s = str(s or "")
    m = re.search(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", s)
    if m:
        return "%s-%02d-%02d" % (m.group(3), int(m.group(2)), int(m.group(1)))
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,})\.?,?[\s-]+(\d{4})", s)
    if m and m.group(2)[:3].lower() in MON:
        return "%s-%02d-%02d" % (m.group(3), MON.index(m.group(2)[:3].lower()) + 1, int(m.group(1)))
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    return m.group(0) if m else ""


def tables(h):
    out = []
    for m in re.finditer(r"<table([^>]*)>([\s\S]*?)</table>", h, flags=re.I):
        rows = []
        for r in re.finditer(r"<tr[^>]*>([\s\S]*?)</tr>", m.group(2), flags=re.I):
            cells = [{"raw": unent(c.group(2) + " " + c.group(3)), "t": strip(c.group(3))}
                     for c in re.finditer(r"<t([dh])([^>]*)>([\s\S]*?)</t[dh]>", r.group(1), flags=re.I)]
            if cells:
                rows.append(cells)
        out.append(rows)
    return out


def header_index(row, words):
    for i, c in enumerate(row):
        t = norm(c["t"])
        if any(w in t for w in words):
            return i
    return -1


def md5k(t):
    import hashlib
    return hashlib.md5(str(t).encode()).hexdigest()[:14]


# ------------------------------------------------------------------ SUPREME COURT
def sci_get(dn, dy, tab=""):
    q = urlencode({"diary_no": dn, "diary_year": dy, "tab_name": tab or "", "action": "get_case_details", "es_ajax_request": 1, "language": "en"})
    s = sci_session()
    r = get(s, SCI_AJAX + "?" + q, SCI_BASE + "/case-status-diary-no/", xhr=True)
    if r.status_code == 403:
        s = sci_session(True)
        r = get(s, SCI_AJAX + "?" + q, SCI_BASE + "/case-status-diary-no/", xhr=True)
    try:
        j = r.json()
    except Exception:
        raise RuntimeError("The Supreme Court site did not answer properly (HTTP %s)." % r.status_code)
    if not j.get("success"):
        try:
            msg = json.loads(j.get("data") or "{}").get("message")
        except Exception:
            msg = strip(j.get("data"))
        return {"none": msg or "Nothing found"}
    return {"html": str(j.get("data") or "")}


def sci_diary(b):
    m = re.match(r"^(\d{1,7})/(\d{4})$", re.sub(r"\s", "", str(b.get("diary") or "")))
    if m:
        return str(int(m.group(1))), m.group(2)
    c = re.sub(r"[^A-Z0-9]", "", str(b.get("cnr") or "").upper())
    n = re.match(r"^SCIN\d{2}(\d{6})(\d{4})$", c)
    if n:
        return str(int(n.group(1))), n.group(2)
    if b.get("no") and b.get("year"):
        return str(int(b["no"])), str(b["year"])
    return None


def sci_case(b):
    di = sci_diary(b)
    if not di:
        raise RuntimeError("Give the Supreme Court diary number as 12345/2025 (or the CNR beginning SCIN).")
    dn, dy = di
    main = sci_get(dn, dy)
    if "none" in main:
        return {"ok": True, "notFound": True, "msg": "Supreme Court: " + main["none"]}
    h = main["html"]
    kv = {}
    for tb in tables(h):
        for r in tb:
            if len(r) >= 2:
                k = norm(r[0]["t"])
                if k and k not in kv:
                    kv[k] = r[1]["t"]

    def g(rx):
        for k, v in kv.items():
            if re.search(rx, k):
                return v
        return ""
    tm = re.search(r"<h4[^>]*>([\s\S]*?)</h4>", h, flags=re.I)
    title = strip(tm.group(1)) if tm else ""
    pp = re.split(r"\s+vs\.?\s+", title, flags=re.I)
    status, last, tent = g(r"^statusstage"), g(r"^presentlastlistedon"), g(r"^tentatively")
    d = {"found": True, "court": "Supreme Court of India", "hist": [], "orders": []}
    cm = re.search(r"SCIN\d{12}", g(r"^cnrnumber"))
    d["cnr"] = cm.group(0) if cm else ""
    d["diary"] = dn + "/" + dy
    d["reg"] = re.sub(r"\s+", " ", g(r"^casenumber"))[:200]
    ct = re.match(r"^([A-Za-z.() ]+?)\s*No", d["reg"])
    d["ctype"] = ct.group(1) if ct else ""
    d["pet"] = re.sub(r"^\d+\s+", "", g(r"^petitioners?$") or (pp[0] if pp else ""))[:600]
    d["res"] = re.sub(r"^\d+\s+", "", g(r"^respondents?$") or (pp[1] if len(pp) > 1 else ""))[:600]
    d["status"] = status[:300]
    st = re.search(r"\(([^()]*(?:\([^()]*\))?[^()]*)\)", status)
    d["stage"] = st.group(1) if st else ""
    jm = re.search(r"\[([^\]]+)\]", last)
    d["judge"] = re.sub(r"([A-Z.])and ", r"\1 and ", jm.group(1)).strip() if jm else ""
    d["lastListed"] = iso(last)
    d["next"] = iso(tent)
    if d["next"]:
        d["purpose"] = "Tentatively listed (computer generated)"
    fx = re.search(r"List On \(Date\)\s*\((\d{2}-\d{2}-\d{4})\)", status, flags=re.I)
    if fx and iso(fx.group(1)) >= (d["next"] or ""):
        d["next"] = iso(fx.group(1))
        d["purpose"] = "List on (date) fixed by the Court"
    d["disposed"] = bool(re.match(r"^\s*disposed", status, flags=re.I))
    if d["disposed"]:
        dm = re.search(r"Disposal Date:\s*([\d-]+)", status, flags=re.I)
        d["decision"] = iso(dm.group(1)) if dm else ""
        d["disposal"] = g(r"^disptype")
        d["next"] = ""
    try:
        ld = sci_get(dn, dy, "listing_dates")
        for tb in tables(ld.get("html", "")):
            head = tb[0] if tb else []
            iD, iS, iJ, iR = header_index(head, ["cldate"]), header_index(head, ["stage"]), header_index(head, ["judges"]), header_index(head, ["remarks"])
            if iD < 0:
                continue
            for r in tb[1:]:
                dd = iso(r[iD]["t"]) if len(r) > iD else ""
                if not dd:
                    continue
                p = " — ".join(x for x in [r[iS]["t"] if 0 <= iS < len(r) else "", r[iR]["t"] if 0 <= iR < len(r) else ""] if x)
                d["hist"].append({"d": dd, "bd": dd, "p": p, "j": r[iJ]["t"] if 0 <= iJ < len(r) else "", "a": None})
        d["hist"].sort(key=lambda x: x["d"])
    except Exception:
        pass
    jo = sci_get(dn, dy, "judgement_orders")
    seen = set()
    for m in re.finditer(r"<a[^>]+href=[\"']([^\"']+\.pdf)[\"'][^>]*>([\s\S]*?)</a>([\s\S]*?)(?=<a|</td>)", jo.get("html", ""), flags=re.I):
        url = unent(m.group(1))
        if url in seen:
            continue
        seen.add(url)
        lab = strip(m.group(3)).strip(" []&;")
        fm = re.search(r"_(\d{2}-[A-Za-z]{3}-\d{4})\.pdf$", url)
        od = iso(strip(m.group(2))) or (iso(fm.group(1)) if fm else "")
        kind = "Judgment" if re.search(r"judg", url + " " + lab, flags=re.I) else "Order"
        d["orders"].append({"key": md5k(url), "no": "", "d": od, "title": kind + (" (ROP)" if "ROP" in lab else ""), "a": ["SCI", url]})
    return {"ok": True, "data": d}


def sci_form(sess):
    r = get(sess["s"], SCI_BASE + "/case-status-case-no/", SCI_BASE + "/")
    h = r.text
    fm = re.search(r"<form[^>]*id=[\"']sciapi-services-case-status-case-no[\"'][\s\S]*?</form>", h, flags=re.I)
    if not fm:
        raise RuntimeError("The Supreme Court search form could not be read.")
    f = fm.group(0)
    fields = {}
    for t in re.findall(r"<input[^>]*>", f, flags=re.I):
        n = re.search(r"name=[\"']([^\"']+)[\"']", t, flags=re.I)
        v = re.search(r"value=[\"']([^\"']*)[\"']", t, flags=re.I)
        ty = re.search(r"type=[\"']([^\"']+)[\"']", t, flags=re.I)
        if n and v and re.search(r"hidden|submit", ty.group(1) if ty else "text", flags=re.I):
            fields[n.group(1)] = unent(v.group(1))
    sess["fields"] = fields
    im = re.search(r"<img[^>]*id=[\"']siwp_captcha_image_0[\"'][^>]*src=[\"']([^\"']+)[\"']", f, flags=re.I) or \
        re.search(r"src=[\"']([^\"']*_siwp_captcha[^\"']*)[\"']", f, flags=re.I)
    img = unent(im.group(1)) if im else SCI_BASE + "/?_siwp_captcha&id=" + fields.get("scid", "")
    if not img.startswith("http"):
        img = SCI_BASE + ("" if img.startswith("/") else "/") + img
    p = get(sess["s"], img, SCI_BASE + "/case-status-case-no/")
    ctype = p.headers.get("content-type", "image/png").split(";")[0]
    return "data:%s;base64,%s" % (ctype, base64.b64encode(p.content).decode())


def sci_open(b):
    sid = uuid.uuid4().hex
    sess = {"s": new_session(), "at": time.time()}
    img = sci_form(sess)
    SESS[sid] = sess
    return {"ok": True, "sid": sid, "img": img}


def sci_search(b):
    sess = SESS.get(b.get("sid") or "")
    if not sess or time.time() - sess["at"] > 1500:
        return {"ok": True, "expired": True}
    data = dict(sess.get("fields") or {})
    data.update({"case_type": b.get("type"), "case_no": b.get("no"), "year": b.get("year"),
                 "siwp_captcha_value": str(b.get("captcha") or "").strip(), "action": "get_case_status_case_no", "language": "en"})
    r = sess["s"].post(SCI_AJAX, data=data, timeout=60, headers={"Referer": SCI_BASE + "/case-status-case-no/",
                       "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01"})
    try:
        j = r.json()
    except Exception:
        raise RuntimeError("The Supreme Court site did not answer properly (HTTP %s)." % r.status_code)
    if not j.get("success"):
        try:
            msg = json.loads(j.get("data") or "{}").get("message")
        except Exception:
            msg = strip(j.get("data"))
        img = sci_form(sess)
        return {"ok": True, "bad": bool(re.search("captcha", msg or "", flags=re.I)), "msg": msg or "Nothing found", "img": img}
    data = j.get("data")
    h = str(data.get("resultsHtml") if isinstance(data, dict) and "resultsHtml" in data else data or "")
    rows, seen = [], set()
    for part in re.split(r"<tr\b", h, flags=re.I):
        a = re.search(r"data-diary-no=[\"'](\d+)[\"']", part, flags=re.I)
        y = re.search(r"data-diary-year=[\"'](\d+)[\"']", part, flags=re.I)
        if not a or not y:
            continue
        k = a.group(1) + "/" + y.group(1)
        if k in seen:
            continue
        seen.add(k)
        cells = [re.sub(r"\s+", " ", strip(c)) for c in re.findall(r"<td[^>]*>([\s\S]*?)</td>", part, flags=re.I)]
        rows.append({"diary": k, "text": " · ".join(c for c in cells if c)[:400]})
    if not rows:
        m = re.search(r"Diary No\.?\s*-?\s*(\d+)\s*/\s*(\d{4})", h, flags=re.I)
        if m:
            rows.append({"diary": m.group(1) + "/" + m.group(2), "text": strip(h)[:300]})
    return {"ok": True, "rows": rows, "msg": "" if rows else "No case found with that number."}


# ------------------------------------------------------------------ MAT NAGPUR
MAT_S = {"s": None}


def mat_session():
    if MAT_S["s"] is None:
        MAT_S["s"] = new_session()
    return MAT_S["s"]


def mat_list(b):
    out, why = [], []
    try:
        j = get(mat_session(), MAT_FEED, MAT_PAGE, xhr=True).json()
        for x in (j if isinstance(j, list) else j.get("data") or []):
            out.append({"c": str(x.get("oa_num") or ""), "ap": str(x.get("applicant_name") or ""),
                        "di": (x.get("districts") or {}).get("name") or "", "adv": str(x.get("applicants_adv") or ""),
                        "rs": str(x.get("respondents_details") or "")[:160], "sj": (x.get("bsubjects") or {}).get("board_subject") or "",
                        "dt": str(x.get("decision_date") or ""), "dc": str(x.get("decision") or "")[:160],
                        "u": MAT_FILES + str(x["file_name"]) if x.get("file_name") else ""})
    except Exception as e:
        why.append("feed: %s" % e)
    if b.get("old"):
        try:
            h = get(mat_session(), MAT_PAGE).text
            for tb in tables(h):
                for r in tb:
                    if len(r) < 10:
                        continue
                    um = re.search(r"href=[\"']([^\"']+)[\"']", " ".join(c["raw"] for c in r), flags=re.I)
                    u = um.group(1) if um else ""
                    if u and not u.startswith("http"):
                        u = "https://mat.maharashtra.gov.in/" + re.sub(r"^[./]+", "", u)
                    out.append({"c": r[0]["t"], "ap": r[1]["t"], "di": r[2]["t"], "adv": r[3]["t"], "rs": r[4]["t"][:160],
                                "sj": r[6]["t"], "dt": r[7]["t"], "dc": r[8]["t"][:160], "u": unent(u)})
        except Exception as e:
            why.append("page: %s" % e)
    return {"ok": True, "rows": out, "note": "; ".join(why)}


def mat_days(b):
    j = get(mat_session(), MAT_DAYS, "https://mat.maharashtra.gov.in/nagpur_calendar_2026.html", xhr=True).json()
    days, hol = [], []
    for x in j:
        d = str(x.get("order_date") or "")[:10]
        if x.get("order_file_name"):
            days.append({"d": d, "f": str(x["order_file_name"])})
        elif x.get("is_holiday"):
            hol.append({"d": d, "t": str(x.get("holiday_title") or "")})
    return {"ok": True, "days": days, "holidays": hol}


def fetch_pdf(url, referer):
    s = sci_session() if "sci.gov.in" in url else mat_session()
    r = get(s, url, referer)
    if r.content[:4] != b"%PDF":
        return {"ok": True, "missing": True, "msg": "The PDF could not be downloaded (HTTP %s)." % r.status_code}
    return {"ok": True, "b64": base64.b64encode(r.content).decode(), "size": len(r.content)}


def mat_pdf(b):
    f = str(b.get("f") or "")
    if not f or "/" in f or "\\" in f or ".." in f:
        raise RuntimeError("Bad file name")
    return fetch_pdf(MAT_ORDERS + quote(f), "https://mat.maharashtra.gov.in/")


def any_pdf(b):
    url = str(b.get("url") or "")
    host = urlparse(url).hostname or ""
    if not url.startswith("https://") or host not in PDF_HOSTS:
        raise RuntimeError("That address is not one the helper fetches.")
    return fetch_pdf(url, SCI_BASE + "/" if "sci.gov.in" in host else "https://mat.maharashtra.gov.in/")


ACTIONS = {"sci": sci_case, "scopen": sci_open, "scsearch": sci_search, "mat": mat_list, "matdays": mat_days,
           "matpdf": mat_pdf, "pdf": any_pdf, "ping": lambda b: {"ok": True, "helper": VERSION, "engine": ENGINE}}


# ------------------------------------------------------------------ server
class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def cors(self):
        o = self.headers.get("Origin") or ""
        if any(o.startswith(x) for x in ALLOWED_ORIGINS):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self.send(200, "Charpe helper is running (version %d, %s). You can close this tab." % (VERSION, ENGINE), "text/plain")

    def do_POST(self):
        o = self.headers.get("Origin") or ""
        if o and not any(o.startswith(x) for x in ALLOWED_ORIGINS):
            return self.send(403, json.dumps({"ok": False, "error": "Not allowed"}))
        try:
            n = int(self.headers.get("Content-Length") or 0)
            b = json.loads(self.rfile.read(n) or b"{}")
            fn = ACTIONS.get(b.get("action"))
            if not fn:
                return self.send(200, json.dumps({"ok": False, "error": "Unknown action"}))
            return self.send(200, json.dumps(fn(b)))
        except Exception as e:
            return self.send(200, json.dumps({"ok": False, "error": str(e)[:300]}))


def main():
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    except OSError:
        sys.exit(0)            # already running
    srv.serve_forever()


if __name__ == "__main__":
    main()
