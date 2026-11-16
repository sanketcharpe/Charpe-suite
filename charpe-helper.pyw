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
  High Court     — "Find on High Court": the CNR of a case by its type, number and
                   year (you type the CAPTCHA)
  Bombay HC site — (v13) the High Court's own website bombayhighcourt.gov.in: case
                   details, order PDFs and listing remarks by type / number / year,
                   no CAPTCHA. An extra route; the CAPTCHA route above is unchanged.

Nothing is stored here: what is fetched goes straight back to Charpe Suite,
which keeps the PDFs in your Drive folder as before.

Start: double-click "Install Charpe Helper.bat" once — it also starts with Windows.
Check: open http://127.0.0.1:8770/ in the browser — it says "Charpe helper is running".
"""
import base64, html, json, re, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urlencode, urlparse

VERSION = 14
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


# ------------------------------------------------------------------ Bombay High Court
# The High Court search ("find this case's CNR") from your own connection: Google's
# servers are often turned away by hcservices.ecourts.gov.in ("Address unavailable").
HC_BASE = "https://hcservices.ecourts.gov.in/hcservices/"
HC_QRY = HC_BASE + "cases_qry/index_qry.php?action_code="
HC_BENCH = {"principal": r"appellate side|principal", "original": r"original side", "aurangabad": r"aurangabad",
            "nagpur": r"nagpur", "goa": r"goa", "kolhapur": r"kolhapur"}


def hc_post(s, action, data):
    r = s.post(HC_QRY + action, data=data, timeout=60,
               headers={"Referer": HC_BASE + "main.php", "X-Requested-With": "XMLHttpRequest",
                        "Accept": "application/json, text/javascript, */*; q=0.01",
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"})
    return r.text.lstrip("\ufeff")


def tilde(t):
    out = []
    for p in str(t or "").split("#"):
        a = p.split("~")
        if len(a) > 1 and a[0].strip() and a[0].strip() != "0":
            out.append({"v": a[0].strip(), "t": strip(a[1])})
    return out


def hc_pic(sess):
    p = get(sess["s"], HC_BASE + "securimage/securimage_show.php?" + str(time.time()), HC_BASE + "main.php")
    ctype = p.headers.get("content-type", "image/png").split(";")[0]
    return "data:%s;base64,%s" % (ctype, base64.b64encode(p.content).decode())


def hc_open(b):
    s = new_session()
    get(s, HC_BASE + "main.php")
    benches = tilde(hc_post(s, "fillHCBench", {"state_code": "1", "appFlag": "web"}))
    rx = HC_BENCH.get(b.get("bench") or "nagpur", HC_BENCH["nagpur"])
    bc = next((x for x in benches if re.search(rx, x["t"], re.I)), None)
    if not bc:
        raise RuntimeError("Could not read the list of High Court benches.")
    types = tilde(hc_post(s, "fillCaseType", {"state_code": "1", "court_code": bc["v"], "appFlag": "web"}))
    sid = uuid.uuid4().hex
    sess = {"s": s, "at": time.time(), "bench": bc["v"]}
    SESS[sid] = sess
    return {"ok": True, "sid": sid, "img": hc_pic(sess), "types": types, "bench": bc["t"]}


def hc_sess(b):
    sess = SESS.get(b.get("sid") or "")
    if not sess or time.time() - sess["at"] > 1500 or "bench" not in sess:
        return None
    return sess


def hc_newpic(b):
    sess = hc_sess(b)
    if not sess:
        return {"ok": True, "expired": True}
    return {"ok": True, "sid": b.get("sid"), "img": hc_pic(sess)}


def hc_rows(t):
    out, seen = [], set()

    def add(o):
        cn = str(o.get("cino") or o.get("cnr") or "").upper()
        if not re.match(r"^HC[A-Z]{2}\d{12}$", cn) or cn in seen:
            return
        seen.add(cn)
        no = str(o.get("case_no2") or o.get("reg_no") or o.get("case_no") or "")
        yr = str(o.get("reg_year") or o.get("case_year") or "")
        out.append({"cnr": cn, "case_no": str(o.get("case_no") or ""), "court_code": str(o.get("_court") or ""),
                    "no": strip(" ".join([str(o.get("type_name") or o.get("case_type") or ""), no + ("/" + yr if yr else "")])).strip(),
                    "pet": strip(str(o.get("pet_name") or o.get("petparty_name") or "")),
                    "res": strip(str(o.get("res_name") or o.get("resparty_name") or "")), "court": "Bombay High Court"})

    def walk(x):
        if isinstance(x, str):
            if re.match(r"^\s*[\[{]", x):
                try:
                    walk(json.loads(x))
                except Exception:
                    pass
            return
        if isinstance(x, list):
            for y in x:
                walk(y)
            return
        if isinstance(x, dict):
            if x.get("cino") or x.get("cnr"):
                add(x)
            for y in x.values():
                walk(y)
    try:
        j = json.loads(t)
    except Exception:
        j = t
    # the site's answer: {"con": ["[...cases of bench 1...]", ...], "court_code": [...]}
    if isinstance(j, dict) and isinstance(j.get("con"), list):
        codes = j.get("court_code") or []
        for m, part in enumerate(j["con"]):
            try:
                lst = json.loads(part) if isinstance(part, str) else part
            except Exception:
                continue
            for o in (lst if isinstance(lst, list) else [lst]):
                if isinstance(o, dict):
                    o = dict(o)
                    o["_court"] = codes[m] if isinstance(codes, list) and m < len(codes) else ""
                    add(o)
    walk(j)
    if not out:   # HTML answer: take each CNR with the text of its table row
        for m in re.finditer(r"\b(HC[A-Z]{2}\d{12})\b", t):
            cn = m.group(1)
            if cn in seen:
                continue
            seen.add(cn)
            a = t.rfind("<tr", 0, m.start())
            z = t.find("</tr>", m.end())
            row = strip(t[a if a >= 0 else max(0, m.start() - 600): z if z > 0 else m.end() + 600])
            pp = re.split(r"\s+(?:vs\.?|versus|v/s)\s+", row, maxsplit=1, flags=re.I)
            out.append({"cnr": cn, "no": (re.search(r"[A-Z][A-Za-z.()]*\s*/\s*\d+\s*/\s*\d{4}", row) or re.search(r"\d+\s*/\s*\d{4}", row) or [""])[0],
                        "pet": pp[0][-80:].strip() if len(pp) > 1 else row[:80], "res": pp[1][:80].strip() if len(pp) > 1 else "", "court": "Bombay High Court"})
    return out


def hc_history(sess, row):
    """The case page, as the site's own "View" link opens it (same session, no second CAPTCHA)."""
    r = sess["s"].post(HC_BASE + "cases_qry/o_civil_case_history.php", timeout=60,
                       data={"court_code": row.get("court_code") or sess["bench"], "state_code": "1",
                             "court_complex_code": sess["bench"], "case_no": row.get("case_no") or "",
                             "cino": row.get("cnr") or "", "appFlag": ""},
                       headers={"Referer": HC_BASE + "main.php", "X-Requested-With": "XMLHttpRequest",
                                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"})
    return r.text.lstrip("\ufeff")


def hc_hist(b):
    sess = hc_sess(b)
    if not sess:
        return {"ok": True, "expired": True}
    sess["at"] = time.time()
    row = {"cnr": b.get("cnr"), "case_no": b.get("case_no"), "court_code": b.get("court_code")}
    return {"ok": True, "sid": b.get("sid"), "cnr": row["cnr"], "html": hc_history(sess, row)}


def hc_cnr(b):
    """Search by CNR: the answer is the case page itself."""
    sess = hc_sess(b)
    if not sess:
        return {"ok": True, "expired": True}
    sess["at"] = time.time()
    cnr = re.sub(r"[^A-Z0-9]", "", str(b.get("cnr") or "").upper())
    r = sess["s"].post(HC_BASE + "cases_qry/index_qry.php", timeout=60,
                       data={"captcha": str(b.get("captcha") or "").strip(), "cino": cnr, "appFlag": "web",
                             "action_code": "fetchStateDistCourtNew", "caseStatusSearchType": "CNRNumber"},
                       headers={"Referer": HC_BASE + "main.php", "X-Requested-With": "XMLHttpRequest",
                                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"})
    t = r.text.lstrip("\ufeff")
    if re.search(r"invalid captcha|ERROR_Captcha", t[:600], re.I):
        return {"ok": True, "bad": True, "sid": b.get("sid"), "img": hc_pic(sess)}
    if not t.strip() or re.match(r"^\s*(THERE IS AN ERROR|\{?\s*\"?Error)", t):
        return {"ok": True, "sid": b.get("sid"), "notFound": True, "msg": "The High Court site has no record for CNR " + cnr + " (" + strip(t)[:60] + ")"}
    return {"ok": True, "sid": b.get("sid"), "cnr": cnr, "html": t}


def hc_pdf(b):
    sess = hc_sess(b)
    url = str(b.get("url") or "")
    if not sess:
        return {"ok": True, "missing": True, "msg": "The High Court session ended; fetch the case again"}
    if not url.startswith("http"):
        url = HC_BASE + url.lstrip("./")
    if (urlparse(url).hostname or "") != "hcservices.ecourts.gov.in":
        raise RuntimeError("That address is not one the helper fetches.")
    r = get(sess["s"], url, HC_BASE + "main.php")
    body = r.content
    k = body.find(b"%PDF", 0, 64)          # the site puts an invisible byte-order mark before the PDF
    if r.status_code == 200 and k >= 0:
        return {"ok": True, "b64": base64.b64encode(body[k:]).decode()}
    if r.status_code != 200 or not r.content[:4] == b"%PDF":
        txt = strip(r.content[:2000].decode("utf-8", "ignore"))
        if re.search(r"not uploaded", txt, re.I):
            return {"ok": True, "missing": True, "msg": "not uploaded on eCourts (the Bombay High Court publishes its orders on its own website)"}
        return {"ok": True, "missing": True, "msg": "The High Court PDF could not be downloaded (HTTP %d)" % r.status_code}
    return {"ok": True, "b64": base64.b64encode(r.content).decode()}


def hc_search(b):
    sess = hc_sess(b)
    if not sess:
        return {"ok": True, "expired": True}
    sess["at"] = time.time()
    q = str(b.get("q") or "").strip()
    st = str(b.get("status") or "Both")
    mode = str(b.get("mode") or "cno")
    data = {"court_code": sess["bench"], "state_code": "1", "court_complex_code": sess["bench"],
            "captcha": str(b.get("captcha") or "").strip(), "appFlag": "web"}
    if mode == "party":      # the site's own "Party Name" search (name in part, min. 3 letters; year optional)
        data.update({"caseStatusSearchType": "CSpartyName", "f": st, "petres_name": q, "rgyear": str(b.get("year") or "")})
    elif mode == "adv":      # the site's own "Advocate Name" search
        data.update({"caseStatusSearchType": "CSAdvName", "advocate_name": q, "search_type": "1", "f": st})
    else:
        data.update({"caseStatusSearchType": "CScaseNumber", "case_type": str(b.get("type") or ""), "case_no": str(b.get("no") or ""),
                     "rgyear": str(b.get("year") or ""), "caseNoType": "new", "displayOldCaseNo": "NO"})
    t = hc_post(sess["s"], "showRecords", data)
    if re.search(r"invalid captcha|ERROR_Captcha|captcha.*(wrong|invalid|mismatch)|enter.*captcha", t[:600], re.I):
        return {"ok": True, "bad": True, "sid": b.get("sid"), "img": hc_pic(sess)}
    rows = hc_rows(t)
    out = {"ok": True, "sid": b.get("sid"), "rows": rows[:200],
           "msg": "" if rows else ("Record not found" if re.search(r'"con"\s*:\s*(""|\[\s*\])|totRecords"\s*:\s*"?0', t) else (strip(t)[:160] or "Nothing found"))}
    if len(rows) == 1 and mode == "cno":
        out["cnr"] = rows[0]["cnr"]
        out["html"] = hc_history(sess, rows[0])
    else:
        out["img"] = hc_pic(sess)
    return out


# ------------------------------------------------------------------ district courts (eCourts)
# District, Industrial, Labour and other subordinate courts, by CNR, from your own connection.
EC_BASE = "https://services.ecourts.gov.in/ecourtindia_v6"
EC_HOST = "https://services.ecourts.gov.in"


def ec_token(html):
    for tag in re.findall(r"<input[^>]*app_token[^>]*>", html or "", re.I):
        m = re.search(r"value\s*=\s*[\"']?([^\"'\s>]+)", tag, re.I)
        if m and len(m.group(1)) >= 16:
            return m.group(1)
    m = re.search(r"app_token[\"']?\s*[:=,]\s*[\"']([0-9A-Za-z]{16,})[\"']", html or "")
    return m.group(1) if m else ""


def ec_abs(u):
    u = unent(u).strip()
    if u.startswith("http"):
        return u
    if u.startswith("/"):
        return EC_HOST + u
    return EC_BASE + "/" + u.lstrip("./")


def ec_ajax(sess, page, data):
    h = {"Referer": EC_BASE + "/", "X-Requested-With": "XMLHttpRequest",
         "Accept": "application/json, text/javascript, */*; q=0.01",
         "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
    if sess.get("hv"):
        h["delimeter"] = sess["hv"]
        if sess.get("hk"):
            h[sess["hk"]] = sess["hv"]
    body = (data + "&" if data else "") + "ajax_req=true&app_token=" + quote(sess.get("token") or "")
    r = sess["s"].post(EC_BASE + "/?p=" + page, data=body, headers=h, timeout=60)
    t = r.text.lstrip("\ufeff")
    try:
        j = json.loads(t)
    except Exception:
        parts = t.split("#####")
        if len(parts) > 1 and parts[1].strip():
            sess["token"] = parts[1].strip()
        else:
            m = re.search(r'"app_token":"([^"]+)"', t)
            if m:
                sess["token"] = m.group(1)
        raise RuntimeError(strip(parts[0])[:180] or "eCourts did not answer properly (HTTP %d)" % r.status_code)
    if isinstance(j, dict) and j.get("app_token"):
        sess["token"] = j["app_token"]
    return j if isinstance(j, dict) else {}


def ec_pic(sess):
    src = EC_BASE + "/vendor/securimage/securimage_show.php?" + str(time.time())
    j = ec_ajax(sess, "casestatus/getCaptcha", "")
    if j.get("errormsg") and not j.get("div_captcha"):
        j = ec_ajax(sess, "casestatus/getCaptcha", "")      # a new session sometimes needs a second ask
    m = re.search(r"src=[\"']([^\"']*securimage_show\.php[^\"']*)[\"']", j.get("div_captcha") or "", re.I)
    if m:
        src = ec_abs(m.group(1))
    elif j.get("errormsg"):
        raise RuntimeError(strip(j["errormsg"])[:160])
    p = get(sess["s"], src, EC_BASE + "/")
    ctype = p.headers.get("content-type", "image/png").split(";")[0]
    if p.status_code != 200 or "image" not in ctype:
        raise RuntimeError("eCourts did not give a CAPTCHA picture (HTTP %d)" % p.status_code)
    return "data:%s;base64,%s" % (ctype, base64.b64encode(p.content).decode())


def ec_open():
    s = new_session()
    home = get(s, EC_BASE + "/")
    html = home.text
    sess = {"s": s, "at": time.time(), "token": ec_token(html), "dc": True}
    m = re.search(r"src=[\"']([^\"']*js/components\.js[^\"']*)[\"']", html, re.I)
    js = get(s, ec_abs(m.group(1)) if m else EC_BASE + "/js/components.js", EC_BASE + "/").text
    v = re.search(r"var\s+delimeter\s*=\s*[\"']([^\"']+)[\"']", js)
    k = re.search(r"[\"']?delimeter[\"']?\s*:\s*delimeter\s*,\s*[\"']?([A-Za-z0-9_\-]+)[\"']?\s*:\s*delimeter", js)
    sess["hv"] = v.group(1) if v else ""
    sess["hk"] = k.group(1) if k else ""
    return sess


def dc_start(b):
    rows = []
    for cnr in b.get("cnrs") or []:
        cnr = re.sub(r"[^A-Z0-9]", "", str(cnr).upper())
        row = {"cnr": cnr}
        try:
            if cnr.startswith("HC"):            # High Court CNR: bench code is in the CNR (HCBM04… = 4)
                s = new_session()
                get(s, HC_BASE + "main.php")
                sess = {"s": s, "at": time.time(), "bench": str(int(cnr[4:6] or "0") or 4)}
                row["img"] = hc_pic(sess)
            else:
                sess = ec_open()
                row["img"] = ec_pic(sess)
            sid = uuid.uuid4().hex
            SESS[sid] = sess
            row["sid"] = sid
        except Exception as e:
            row["sid"] = ""
            row["err"] = "The court site did not give a CAPTCHA (" + str(e)[:120] + "). Press Try again."
        rows.append(row)
    return {"ok": True, "rows": rows}


def dc_sess(b):
    sess = SESS.get(b.get("sid") or "")
    if not sess or time.time() - sess["at"] > 1500:
        return None
    sess["at"] = time.time()
    return sess


def dc_captcha(b):
    sess = dc_sess(b)
    if not sess:
        r = dc_start({"cnrs": [b.get("cnr")]})["rows"][0]
        return {"ok": True, "sid": r.get("sid"), "img": r.get("img"), "err": r.get("err")}
    return {"ok": True, "sid": b.get("sid"), "img": hc_pic(sess) if "bench" in sess else ec_pic(sess)}


def dc_search(b):
    sess = dc_sess(b)
    if not sess:
        return {"ok": True, "expired": True}
    cnr = re.sub(r"[^A-Z0-9]", "", str(b.get("cnr") or "").upper())
    cap = str(b.get("captcha") or "").strip()
    if "bench" in sess:                       # High Court by CNR
        r = hc_cnr({"sid": b.get("sid"), "cnr": cnr, "captcha": cap})
        if r.get("html"):
            r["kind"] = "hc"
        return r
    try:
        j = ec_ajax(sess, "cnr_status/searchByCNR/", "cino=" + quote(cnr) + "&fcaptcha_code=" + quote(cap))
    except RuntimeError as e:
        if re.search(r"captcha", str(e), re.I):
            return {"ok": True, "bad": True, "msg": str(e), "img": ec_pic(sess)}
        raise
    html = j.get("casetype_list") or ""
    if str(j.get("status")) == "0" or (not html and (j.get("errormsg") or j.get("div_captcha"))):
        return {"ok": True, "bad": True, "msg": strip(j.get("errormsg") or "")[:120] or "Wrong CAPTCHA", "img": ec_pic(sess)}
    m = re.search(r"id=[\"']sess_dist_code[\"'][^>]*value=[\"']([^\"']*)", html, re.I)
    if m:
        sess["dist"] = m.group(1)
    return {"ok": True, "sid": b.get("sid"), "kind": "dc", "html": html}


def dc_order(b):
    sess = dc_sess(b)
    if not sess:
        return {"ok": True, "expired": True}
    a = b.get("a") or []
    if a and a[0] == "HC":
        return hc_pdf({"sid": b.get("sid"), "url": a[1]})
    g = lambda i: str(a[i]) if len(a) > i and a[i] is not None else ""
    j = ec_ajax(sess, "home/display_pdf", "normal_v=" + quote(g(0)) + "&case_val=" + quote(g(1)) + "&court_code=" + quote(g(2)) +
                "&filename=" + quote(g(3)) + "&appFlag=" + quote(g(4)))
    if not j.get("order"):
        return {"ok": True, "missing": True, "msg": strip(j.get("errormsg") or "")[:120] or "eCourts has no PDF for this order"}
    r = get(sess["s"], ec_abs(str(j["order"])), EC_BASE + "/")
    k = r.content.find(b"%PDF", 0, 64)
    if r.status_code != 200 or k < 0:
        return {"ok": True, "missing": True, "msg": "The PDF could not be downloaded (HTTP %d)" % r.status_code}
    return {"ok": True, "b64": base64.b64encode(r.content[k:]).decode()}


def dc_biz(b):
    sess = dc_sess(b)
    if not sess:
        return {"ok": True, "expired": True}
    if "bench" in sess:
        return {"ok": True, "text": ""}
    a = b.get("a") or []
    g = lambda i: str(a[i]) if len(a) > i and a[i] is not None else ""
    data = ("court_code=" + quote(g(0)) + "&state_code=" + quote(g(4)) + "&dist_code=" + quote(sess.get("dist") or g(1)) +
            "&nextdate1=" + quote(g(2)) + "&case_number1=" + quote(g(3)) + "&state_code=" + quote(g(4)) +
            "&disposal_flag=" + quote(g(5)) + "&businessDate=" + quote(g(6)) + "&national_court_code=" + quote(g(8)) +
            "&court_no=" + quote(g(7)) + "&search_by=" + quote(g(9) or "cnr") + "&srno=" + quote(g(10)))
    j = ec_ajax(sess, "home/viewBusiness", data)
    t = strip(j.get("data_list") or "")
    m = re.search(r"Business\s*:?\s*([\s\S]*?)(?:\n\s*Next Purpose|\n\s*Next Hearing Date|$)", t, re.I)
    txt = re.sub(r"\s+", " ", (m.group(1) if m and m.group(1) else t)).strip()
    return {"ok": True, "text": txt[:700]}


# ---- find a district case by its type, number and year (one CAPTCHA) ----
def ec_opts(h):
    out = []
    # the site writes value='x', value="x" or plain value=x
    for m in re.finditer(r"<option[^>]*?value\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)</option>", str(h or ""), re.I):
        m = (m, m.group(1) if m.group(1) is not None else (m.group(2) if m.group(2) is not None else m.group(3)), m.group(4))
        v, t = m[1], strip(m[2])
        if v and v != "0" and t and not re.match(r"^select", t, re.I):
            out.append({"v": v, "t": t})
    return out


def first_str(x, rx):
    if isinstance(x, str):
        return x if re.search(rx, x, re.I) else ""
    if isinstance(x, dict):
        x = list(x.values())
    if isinstance(x, list):
        for y in x:
            r = first_str(y, rx)
            if r:
                return r
    return ""


def dc_open(b):
    sess = ec_open()
    img = ec_pic(sess)
    lists = {"est": []}
    note = ""
    try:
        dj = ec_ajax(sess, "casestatus/fillDistrict", "state_code=1")
        want = str(b.get("district") or "Nagpur")
        dists = ec_opts(first_str(dj, r"<option"))
        dn = next((x for x in dists if re.search(want, x["t"], re.I)), None)
        # Industrial & Labour, Family, School Tribunal, Co-op Appellate courts are listed under their own
        # state-wide "districts" on eCourts: take the courts of this city from each of them too
        special = [x for x in dists if re.search(r"industrial|labou?r|family|school|co.?op", x["t"], re.I)]
        for dd in ([dn] if dn else []) + special:
            cj = ec_ajax(sess, "casestatus/fillcomplex", "state_code=1&dist_code=" + quote(dd["v"]))
            for o in ec_opts(first_str(cj, r"<option")):
                if not (dd is dn or re.search(want, o["t"], re.I)):
                    continue
                parts = o["v"].split("@")
                ests = (parts[1] if len(parts) > 1 else "").split(",")
                if len(ests) > 1:
                    # one complex, several courts (e.g. 9 = Industrial Court, 10 = Labour Court): list each court
                    try:
                        ej = ec_ajax(sess, "casestatus/fillCourtEstablishment", "state_code=1&dist_code=" + quote(dd["v"]) + "&court_complex_code=" + quote(parts[0]))
                        named = ec_opts(first_str(ej, r"<option"))
                    except Exception:
                        named = []
                    if named:
                        for e in named:
                            lists["est"].append({"v": dd["v"] + "|" + parts[0] + "@" + e["v"] + "@" + (parts[2] if len(parts) > 2 else "N"), "t": e["t"]})
                        continue
                    for e in ests:
                        lists["est"].append({"v": dd["v"] + "|" + parts[0] + "@" + e + "@" + (parts[2] if len(parts) > 2 else "N"), "t": o["t"] + " (court " + e + ")"})
                    continue
                lists["est"].append({"v": dd["v"] + "|" + o["v"], "t": o["t"]})
    except Exception as e:
        note = "Could not read the list of courts: " + str(e)[:120]
    sid = uuid.uuid4().hex
    SESS[sid] = sess
    return {"ok": True, "sid": sid, "img": img, "lists": lists, "note": "" if lists["est"] else (note or "Could not read the list of courts")}


def split_est(v, sess=None):
    v = str(v or "")
    if "|" in v:                      # "district|complex@est@flag"
        d, v = v.split("|", 1)
        if sess is not None:
            sess["dist"] = d
    p = v.split("@")
    return (p[0] if p else ""), (p[1] if len(p) > 1 else "")


def dc_types(b):
    sess = dc_sess(b)
    if not sess:
        return {"ok": True, "expired": True}
    cx, est = split_est(b.get("est"), sess)
    j = ec_ajax(sess, "casestatus/fillCaseType", "state_code=1&dist_code=" + quote(sess.get("dist") or "") +
                "&court_complex_code=" + quote(cx) + "&est_code=" + quote(est) + "&search_type=c_no")
    return {"ok": True, "types": ec_opts(first_str(j, r"<option"))}


def dc_rows(h):
    out, seen, court = [], set(), ""
    for rows in tables(str(h or "")):
        for r in rows:
            raw = " ".join(c["raw"] for c in r)
            txt = [c["t"] for c in r]
            if len(r) == 1 and "viewHistory" not in raw:
                court = txt[0]
                continue
            m = re.search(r"\b([A-Z]{4}\d{12})\b", raw)
            if not m or m.group(1) in seen:
                continue
            cn = m.group(1)
            seen.add(cn)
            par = next((t for t in txt if re.search(r"\b(vs\.?|versus|v/s)\b", t, re.I)), "")
            pp = re.split(r"\s+(?:vs\.?|versus|v/s)\s+", par, maxsplit=1, flags=re.I)
            no = next((t for t in txt if re.search(r"/\s*\d{4}", t) and t != par), "")
            out.append({"cnr": cn, "no": re.sub(r"\s+", " ", no), "pet": (pp[0] if pp else "").strip(),
                        "res": (pp[1] if len(pp) > 1 else "").strip(), "court": court})
    return out


def dc_find(b):
    sess = dc_sess(b)
    if not sess:
        return {"ok": True, "expired": True}
    cx, est = split_est(b.get("est"), sess)
    base = "&state_code=1&dist_code=" + quote(sess.get("dist") or "") + "&court_complex_code=" + quote(cx) + "&est_code=" + quote(est)
    try:
        j = ec_ajax(sess, "casestatus/submitCaseNo", "case_type=" + quote(str(b.get("type") or "")) + "&search_case_no=" + quote(str(b.get("no") or "")) + "&case_no=" + quote(str(b.get("no") or "")) +
                    "&rgyear=" + quote(str(b.get("year") or "")) + "&case_captcha_code=" + quote(str(b.get("captcha") or "").strip()) + base)
    except RuntimeError as e:
        if re.search(r"captcha", str(e), re.I):
            return {"ok": True, "bad": True, "sid": b.get("sid"), "img": ec_pic(sess)}
        raise
    # every answer carries the next CAPTCHA picture, so only the site's own error text decides "wrong CAPTCHA"
    err = strip(j.get("errormsg") or "")
    if re.search(r"captcha|invalid\s*code|code\s*mismatch", err, re.I):
        return {"ok": True, "bad": True, "sid": b.get("sid"), "img": ec_pic(sess)}
    h = str(j.get("case_data") or "") or first_str({k: v for k, v in j.items() if k != "div_captcha"}, r"viewHistory|<table|<tr")
    rows = dc_rows(h)
    msg = ""
    if not rows:
        msg = err or strip(h)[:160] or "No case with this type, number and year in this court"
    return {"ok": True, "sid": b.get("sid"), "rows": rows[:200], "img": ec_pic(sess), "msg": msg}


def dc_srch(b):
    """Search Courts for district courts: by advocate name, party name or case number, in one court (establishment)."""
    mode = str(b.get("mode") or "cno")
    if mode == "cno":
        return dc_find(b)
    sess = dc_sess(b)
    if not sess:
        return {"ok": True, "expired": True}
    cx, est = split_est(b.get("est"), sess)
    base = "&state_code=1&dist_code=" + quote(sess.get("dist") or "") + "&court_complex_code=" + quote(cx) + "&est_code=" + quote(est)
    st = str(b.get("status") or "Pending")
    cap = str(b.get("captcha") or "").strip()
    q = str(b.get("q") or "").strip()
    if mode == "adv":
        page, data = "casestatus/submitAdvName", ("radAdvt=1&advocate_name=" + quote(q) + "&adv_bar_state=&adv_bar_code=&adv_bar_year=&case_status=" + quote(st) +
                                                  "&caselist_date=&adv_captcha_code=" + quote(cap) + base)
    else:
        page, data = "casestatus/submitPartyName", ("petres_name=" + quote(q) + "&rgyearP=" + quote(str(b.get("year") or "")) + "&case_status=" + quote(st) +
                                                    "&fcaptcha_code=" + quote(cap) + base)
    try:
        j = ec_ajax(sess, page, data)
    except RuntimeError as e:
        if re.search(r"captcha", str(e), re.I):
            return {"ok": True, "bad": True, "sid": b.get("sid"), "img": ec_pic(sess)}
        raise
    err = strip(j.get("errormsg") or "")
    if re.search(r"captcha|invalid\s*code|code\s*mismatch", err, re.I):
        return {"ok": True, "bad": True, "sid": b.get("sid"), "img": ec_pic(sess)}
    h = ""
    for k in ("case_data", "party_data", "adv_data", "con", "case_list"):
        if j.get(k):
            h = str(j.get(k))
            break
    if not h:
        h = first_str({k: v for k, v in j.items() if k != "div_captcha"}, r"viewHistory|<table|<tr")
    rows = dc_rows(h)
    return {"ok": True, "sid": b.get("sid"), "rows": rows[:200], "more": len(rows) > 200, "img": ec_pic(sess),
            "msg": "" if rows else (err or strip(h)[:160] or "Nothing found")}


# ------------------------------------------------------------------ hand-over to Excerpt Desk
# Charpe Suite leaves the PDFs here; your own Excerpt Desk window (whatever Chrome profile
# or browser it runs in) picks them up and asks which of YOUR matters they go into.
import os
XBOX = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "CharpeHelper", "inbox")


def xsafe(i):
    i = re.sub(r"[^A-Za-z0-9_-]", "", str(i or ""))[:40]
    if not i:
        raise RuntimeError("Bad id")
    return i


def x_put(b):
    it = b.get("item") or {}
    it["id"] = xsafe(it.get("id"))
    os.makedirs(XBOX, exist_ok=True)
    with open(os.path.join(XBOX, it["id"] + ".json"), "w", encoding="utf-8") as f:
        json.dump(it, f)
    return {"ok": True, "id": it["id"]}


def x_list(b):
    out = []
    if os.path.isdir(XBOX):
        for n in sorted(os.listdir(XBOX)):
            if not n.endswith(".json"):
                continue
            try:
                with open(os.path.join(XBOX, n), encoding="utf-8") as f:
                    it = json.load(f)
                out.append({"id": it.get("id"), "title": it.get("title"), "cn": it.get("cn"), "court": it.get("court"), "at": it.get("at"),
                            "files": [{"name": x.get("name"), "slot": x.get("slot")} for x in it.get("files") or []]})
            except Exception:
                pass
    return {"ok": True, "items": out}


def x_get(b):
    p = os.path.join(XBOX, xsafe(b.get("id")) + ".json")
    if not os.path.exists(p):
        return {"ok": True, "missing": True}
    with open(p, encoding="utf-8") as f:
        return {"ok": True, "item": json.load(f)}


def x_del(b):
    p = os.path.join(XBOX, xsafe(b.get("id")) + ".json")
    if os.path.exists(p):
        os.remove(p)
    return {"ok": True}


def any_pdf(b):
    url = str(b.get("url") or "")
    host = urlparse(url).hostname or ""
    if not url.startswith("https://") or host not in PDF_HOSTS:
        raise RuntimeError("That address is not one the helper fetches.")
    return fetch_pdf(url, SCI_BASE + "/" if "sci.gov.in" in host else "https://mat.maharashtra.gov.in/")



# ------------------------------------------------------------------ Bombay High Court's own website (no CAPTCHA) — added v13, 31 Oct 2026
# An ALTERNATE route only: the eCourts (hcservices) CAPTCHA route above is unchanged.
# bombayhighcourt.gov.in/bhc answers a search by case number (type / number / year) without a CAPTCHA and gives
# the case details, every order as a direct PDF link, and the listing remarks for each date.
BHC_BASE = "https://bombayhighcourt.gov.in/bhc/"
BHC_BENCH = {"nagpur": "N", "aurangabad": "A", "goa": "G", "principal": "B"}
BHC_S = {}


def bhc_session(bench):
    code = BHC_BENCH.get(str(bench or "nagpur").lower(), "N")
    with LOCK:
        e = BHC_S.get(code)
        if e and time.time() - e["at"] < 1200:
            return e["s"]
    s = new_session()
    get(s, BHC_BASE + "bench/change?bench=" + code, BHC_BASE)
    with LOCK:
        BHC_S[code] = {"s": s, "at": time.time()}
    return s


def bhc_form(s):
    """the case-number search form: fresh tokens and the list of case types"""
    r = get(s, BHC_BASE + "casestatus/casenumber", BHC_BASE)
    h = r.text
    i = h.find('id="getCaseByCaseNo"')
    if i < 0:
        raise RuntimeError("The Bombay High Court site did not show its case-status form.")
    f = h[i:h.find("</form>", i)]
    def val(name):
        m = re.search(r'name="%s"[^>]*value="([^"]*)"' % name, f) or re.search(r'value="([^"]*)"[^>]*name="%s"' % name, f)
        return m.group(1) if m else ""
    sel = re.search(r'name="case_type"[\s\S]*?</select>', f)
    types = [{"v": v, "t": strip(t)} for v, t in re.findall(r'<option[^>]*value="([^"]+)"[^>]*>([\s\S]*?)</option>', sel.group(0) if sel else "")]
    bench = (re.search(r">\s*(NAGPUR|AURANGABAD|GOA|BOMBAY)\s*<", h) or [None, ""])[1]
    side = "side" in re.findall(r'name="(\w+)"', f)
    return {"token": val("_token"), "secret": val("form_secret"), "types": types, "bench": bench, "side": side}


def bhc_types(b):
    s = bhc_session(b.get("bench"))
    f = bhc_form(s)
    return {"ok": True, "types": f["types"], "bench": f["bench"]}


def bhc_find(b):
    s = bhc_session(b.get("bench"))
    f = bhc_form(s)
    data = {"_token": f["token"], "form_secret": f["secret"], "stampreg": b.get("stampreg") or "R",
            "case_type": str(b.get("type") or ""), "case_no": str(b.get("no") or ""), "year": str(b.get("year") or "")}
    if f["side"]:
        data["side"] = b.get("side") or "AS"
    url = BHC_BASE + "casestatus/casenumber"
    last = None
    for attempt in range(2):
        try:
            r = s.post(url, data=data, headers={"Referer": url, "Origin": "https://bombayhighcourt.gov.in"}, timeout=60)
            break
        except Exception as e:
            last = e
            time.sleep(1 + attempt)
    else:
        raise RuntimeError("The Bombay High Court site could not be reached just now (%s). Please try again." % str(last)[:80])
    try:
        j = r.json()
    except Exception:
        return {"ok": True, "found": False, "msg": "The site did not answer as expected (HTTP %d)." % r.status_code, "bench": f["bench"]}
    page = j.get("page") or ""
    found = 'id="cn_CaseNoUpdates"' in page
    return {"ok": True, "found": found, "page": page if found else "", "bench": f["bench"],
            "msg": "" if found else strip(j.get("message") or j.get("msg") or "No case with that number on the Bombay High Court site.")[:200]}


def bhc_pdf(b):
    url = str(b.get("url") or "")
    u = urlparse(url)
    if u.scheme != "https" or (u.hostname or "") != "bombayhighcourt.gov.in" or not u.path.startswith("/bhc/casestatus/order-pdf/"):
        raise RuntimeError("That address is not one the helper fetches.")
    s = bhc_session(b.get("bench"))
    r = get(s, url, BHC_BASE + "casestatus/casenumber")
    body = r.content
    k = body.find(b"%PDF", 0, 64)
    if r.status_code == 200 and k >= 0:
        return {"ok": True, "b64": base64.b64encode(body[k:]).decode()}
    return {"ok": True, "missing": True, "msg": "The Bombay High Court site did not give the PDF (HTTP %d)" % r.status_code}



# ---- plain page fetching for the day board (Nov 2026, v14) ----
# The board's "court positions" button reads the District Court pages (judges, leave, cause lists),
# the High Court's PDF cause lists, the CAT list and the MAT boards. Charpe Suite reads what comes back;
# the helper only fetches, from this PC's own connection, and only from these court sites.
WEB_HOSTS = ("dcourts.gov.in", "bombayhighcourt.gov.in", "cgat.gov.in", "mahaitgov.in", "mat.maharashtra.gov.in", "ecourts.gov.in")
WEB = {}           # open fetching sessions (cookies kept between calls)


def web_ok(url):
    host = (urlparse(url).hostname or "").lower()
    return url.startswith("https://") and any(host == h or host.endswith("." + h) for h in WEB_HOSTS)


def web_sess(b):
    sid = str(b.get("wid") or "")
    now = time.time()
    for k in [k for k, v in WEB.items() if now - v["at"] > 1800]:
        WEB.pop(k, None)
    if sid and sid in WEB:
        WEB[sid]["at"] = now
        return sid, WEB[sid]["s"]
    sid = uuid.uuid4().hex
    WEB[sid] = {"s": new_session(), "at": now}
    return sid, WEB[sid]["s"]


def web_answer(sid, r, binary):
    out = {"ok": True, "wid": sid, "status": r.status_code, "ctype": r.headers.get("Content-Type") or "", "url": str(getattr(r, "url", "") or "")}
    if binary:
        out["b64"] = base64.b64encode(r.content or b"").decode()
    else:
        try:
            out["text"] = r.content.decode(r.encoding or "utf-8", "replace") if r.content is not None else ""
        except Exception:
            out["text"] = (r.content or b"").decode("utf-8", "replace")
    return out


def web_get(b):
    url = str(b.get("url") or "")
    if not web_ok(url):
        raise RuntimeError("That address is not one the helper fetches.")
    sid, s = web_sess(b)
    h = {"Referer": str(b.get("referer") or url)}
    if b.get("xhr"):
        h.update({"Accept": "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest"})
    h.update({str(k): str(v) for k, v in (b.get("headers") or {}).items()})
    last = None
    for attempt in range(3):
        try:
            r = s.get(url, headers=h, timeout=int(b.get("timeout") or 60))
            return web_answer(sid, r, bool(b.get("bin")))
        except Exception as e:
            last = e
            time.sleep(1 + attempt)
    raise RuntimeError("The site could not be reached just now (%s). Please try again." % str(last)[:80])


def web_post(b):
    url = str(b.get("url") or "")
    if not web_ok(url):
        raise RuntimeError("That address is not one the helper fetches.")
    sid, s = web_sess(b)
    h = {"Referer": str(b.get("referer") or url)}
    if b.get("xhr"):
        h.update({"Accept": "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest"})
    h.update({str(k): str(v) for k, v in (b.get("headers") or {}).items()})
    kw = {"headers": h, "timeout": int(b.get("timeout") or 90)}
    if b.get("multipart"):                    # sent as multipart/form-data (as a page's FormData would be)
        bd = "----CharpeForm" + uuid.uuid4().hex[:16]
        parts = []
        for k, v in (b.get("form") or {}).items():
            parts.append("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (bd, str(k), str(v)))
        parts.append("--%s--\r\n" % bd)
        h["Content-Type"] = "multipart/form-data; boundary=" + bd
        kw["data"] = "".join(parts).encode("utf-8")
    elif isinstance(b.get("pairs"), list):    # repeated names (files[]=a&files[]=b)
        h.setdefault("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
        kw["data"] = urlencode([(str(p[0]), str(p[1])) for p in b.get("pairs") if isinstance(p, list) and len(p) == 2])
    else:
        h.setdefault("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
        kw["data"] = urlencode({str(k): str(v) for k, v in (b.get("form") or {}).items()})
    r = s.post(url, **kw)
    return web_answer(sid, r, bool(b.get("bin")))


def web_drop(b):
    WEB.pop(str(b.get("wid") or ""), None)
    return {"ok": True}


ACTIONS = {"sci": sci_case, "scopen": sci_open, "scsearch": sci_search, "mat": mat_list, "matdays": mat_days,
           "matpdf": mat_pdf, "pdf": any_pdf, "hcopen": hc_open, "hcpic": hc_newpic, "hcsearch": hc_search, "hchist": hc_hist, "hccnr": hc_cnr, "hcpdf": hc_pdf,
           "xput": x_put, "xlist": x_list, "xget": x_get, "xdel": x_del,
           "dcstart": dc_start, "dccaptcha": dc_captcha, "dcsearch": dc_search, "dcorder": dc_order, "dcbiz": dc_biz,
           "bhctypes": bhc_types, "bhcfind": bhc_find, "bhcpdf": bhc_pdf, "dcopen": dc_open, "dctypes": dc_types, "dcfind": dc_find, "dcsrch": dc_srch,
           "wget": web_get, "wpost": web_post, "wdrop": web_drop, "ping": lambda b: {"ok": True, "helper": VERSION, "engine": ENGINE}}


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
