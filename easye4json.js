module.exports = function (RED) {
    "use strict";
    const http = require("http");
    const https = require("https");
    const EventEmitter = require("events");
    const crypto = require("crypto");
    const L = require("./lib/easye4json-lib.js");

    const _ = (key, args) => RED._("easye4json." + key, args);
    // Fehler aus der Bibliothek in die eingestellte Sprache übersetzen
    function errText(err, tr) {
        tr = tr || _;
        if (err && err.e4) return tr("errors." + err.e4.key, err.e4.args);
        return err && err.message ? err.message : String(err);
    }
    function short(s) {
        s = String(s);
        return s.length > 40 ? s.slice(0, 37) + "..." : s;
    }
    function codeText(code) {
        return L.ERROR_CODES.includes(code) ? _("apiError." + code) : _("apiError.unknown", { code });
    }

    const MAX_QUEUE = 100;

    // ================================================================================ Gerät (Konfiguration)

    // ================================================================================ gemeinsame Warteschlange je Gerät
    // - nie mehr als eine Anfrage gleichzeitig an dieselbe easyE4
    // - Mindestpause zwischen Anfragen (gap)
    // - nach einem Verbindungsfehler wachsende Pause (1 s, 2 s, 4 s ... max. 10 s), damit eine gestörte easyE4
    //   nicht weiter bombardiert wird
    // - Aufträge mit gleichem Schlüssel werden zusammengefasst (neuester Wert gewinnt)
    const schedulers = new Map();
    function getScheduler(id) {
        let s = schedulers.get(id);
        if (s) return s;
        const queue = [];
        let busy = false;
        let lastEnd = 0;
        let backoff = 0;
        let timer = null;
        s = {
            gaps: new Map(),
            get gap() { let g = 0; s.gaps.forEach((v) => { g = Math.max(g, v); }); return g; },
            add(job) {
                return new Promise((resolve, reject) => {
                    if (job.key) {
                        const waiting = queue.find((j) => j.key === job.key);
                        if (waiting) {
                            waiting.path = job.path;
                            waiting.waiters.push({ resolve, reject });
                            return;
                        }
                    }
                    if (queue.length >= MAX_QUEUE) return reject(Object.assign(new Error("queue"), { queueFull: true }));
                    Object.assign(job, { waiters: [{ resolve, reject }] });
                    // Verbindungstest aus dem Editor: vorne einreihen, ohne Fehlerpause
                    if (job.urgent) queue.unshift(job);
                    else queue.push(job);
                    pump();
                });
            },
            drop(filter, err) {
                for (let i = queue.length - 1; i >= 0; i--) {
                    if (filter(queue[i])) queue.splice(i, 1)[0].waiters.forEach((w) => w.reject(err));
                }
            },
            get length() { return queue.length; },
        };
        function pump() {
            if (busy || queue.length === 0) return;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            const wait = Math.max(0, lastEnd + s.gap + (queue[0].urgent ? 0 : backoff) - Date.now());
            if (wait > 0) {
                timer = setTimeout(() => { timer = null; pump(); }, wait);
                return;
            }
            busy = true;
            const job = queue.shift();
            job.run(job.path)
                .then((res) => {
                    backoff = 0;
                    job.waiters.forEach((w) => w.resolve(res));
                }, (err) => {
                    if (err.network) backoff = Math.min(backoff ? backoff * 2 : 1000, 10000);
                    job.waiters.forEach((w) => w.reject(err));
                })
                .finally(() => {
                    busy = false;
                    lastEnd = Date.now();
                    pump();
                });
        }
        schedulers.set(id, s);
        return s;
    }

    // Gemeinsame HTTP(S)-Agents: eine Verbindung je Gerät, ruhende Verbindung wird nach 15 s geschlossen
    const agents = new Map();
    function getAgent(key, protocol, verifyCert) {
        let a = agents.get(key);
        if (!a) {
            const base = { keepAlive: true, maxSockets: 1, maxFreeSockets: 1, timeout: 15000 };
            const agent = protocol === "https"
                ? new https.Agent(Object.assign(base, verifyCert
                    ? { rejectUnauthorized: true }
                    // Ältere easyE4 sprechen nur TLS 1.0/1.1 mit alten Verfahren, die Node.js sonst ablehnt (EPROTO)
                    : { rejectUnauthorized: false, minVersion: "TLSv1", ciphers: "DEFAULT:@SECLEVEL=0",
                        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }))
                : new http.Agent(base);
            a = { agent, users: 0 };
            agents.set(key, a);
        }
        a.users++;
        return a.agent;
    }
    function releaseAgent(key) {
        const a = agents.get(key);
        if (!a) return;
        a.users--;
        if (a.users <= 0) {
            a.agent.destroy();
            agents.delete(key);
        }
    }

    // Baut die Verbindung auf "dev" auf (Konfigurationsknoten oder ein EventEmitter für den Verbindungstest)
    function setupDevice(dev, config, cred, tr) {
        tr = tr || _;

        dev.host = String(config.host || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
        dev.protocol = config.protocol === "https" ? "https" : "http";
        dev.port = parseInt(config.port, 10) || (dev.protocol === "https" ? 443 : 80);
        dev.auth = ["none", "basic", "bearer"].includes(config.auth) ? config.auth : "basic";
        dev.user = String(cred.user || "").trim();
        dev.timeout = Math.max(500, parseInt(config.timeout, 10) || 3000);
        dev.verifyCert = config.verifyCert === true || config.verifyCert === "true";
        // Mindestpause zwischen zwei Anfragen, damit der Webserver der easyE4 Luft hat
        const gap = parseInt(config.gap, 10);
        dev.gap = Number.isFinite(gap) ? Math.min(Math.max(gap, 0), 5000) : 50;
        // Lesepfad: /api/get/adm für den Administrator, sonst /api/get/data (wie Eatons eigener Knoten)
        dev.readPath = config.readPath === "adm" || config.readPath === "data" ? config.readPath
            : (dev.auth === "basic" && dev.user.toLowerCase() === "admin" ? "adm" : "data");

        dev.problem = null;
        if (!dev.host) dev.problem = tr("errors.noHost");
        else if (dev.auth === "basic" && !dev.user) dev.problem = tr("errors.noUser");
        else if (dev.auth === "bearer" && !cred.apikey) dev.problem = tr("errors.noApiKey");

        const headers = { Accept: "application/json" };
        if (dev.auth === "basic") {
            headers.Authorization = "Basic " + Buffer.from(dev.user + ":" + (cred.password || "")).toString("base64");
        } else if (dev.auth === "bearer") {
            headers.Authorization = "Bearer " + String(cred.apikey || "").trim();
        }
        // Eine gemeinsame Verbindung je Gerät (auch bei mehreren Steuerungs-Einträgen mit derselben Adresse)
        const agentKey = [dev.protocol, dev.host, dev.port, dev.verifyCert].join("|");
        const agent = getAgent(agentKey, dev.protocol, dev.verifyCert);

        // ---- Zustand für die Statusanzeige: unknown | online | offline | auth
        dev.state = "unknown";
        dev.watchers = new Set();
        function setState(s) {
            if (dev.state === s) return;
            dev.state = s;
            dev.watchers.forEach((fn) => fn());
        }

        // Alle Anfragen an dieselbe easyE4 (Adresse + Port) laufen über EINE gemeinsame Warteschlange –
        // auch wenn mehrere Steuerungs-Einträge auf dasselbe Gerät zeigen. Siehe getScheduler().
        const sched = getScheduler(dev.host + ":" + dev.port);
        const gapToken = {};
        sched.gaps.set(gapToken, dev.gap);
        let closed = false;

        function rawRequest(path) {
            return new Promise((resolve, reject) => {
                const lib = dev.protocol === "https" ? https : http;
                const req = lib.request(
                    { host: dev.host, port: dev.port, path, method: "GET", headers, agent, timeout: dev.timeout },
                    (res) => {
                        const chunks = [];
                        res.on("data", (c) => chunks.push(c));
                        res.on("end", () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
                        res.on("error", reject);
                    }
                );
                req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
                req.on("error", (err) => {
                    err.reused = req.reusedSocket;
                    reject(err);
                });
                req.end();
            });
        }

        // Eine Anfrage ausführen (wird vom Scheduler aufgerufen, immer nur eine gleichzeitig)
        function execute(path) {
            return rawRequest(path)
                .catch((err) => {
                    // Die easyE4 hat eine ruhende Keep-Alive-Verbindung geschlossen: einmal neu verbinden
                    if (err.reused && (err.code === "ECONNRESET" || err.code === "EPIPE" || /socket hang up/i.test(err.message))) {
                        return rawRequest(path);
                    }
                    throw err;
                })
                .then((res) => {
                    // 401 beim Lesen = Anmeldung falsch. 401 bei Schreib-/Admin-Befehlen = nur fehlende Rechte
                    // für diesen Befehl; die Verbindung selbst ist dann in Ordnung.
                    setState(res.statusCode === 401 && path.startsWith("/api/get/") ? "auth" : "online");
                    return res;
                }, (err) => {
                    setState("offline");
                    const code = String(err.code || "");
                    const tls = dev.protocol === "https" && (code === "EPROTO" || code.startsWith("ERR_SSL") || /SSL|TLS|certificate/i.test(err.message || ""));
                    const e = new Error(tr(tls ? "errors.tls" : "errors.network", { host: dev.host, msg: err.code || err.message }));
                    e.network = true;
                    throw e;
                });
        }

        // Anfrage stellen; Ergebnis {statusCode, body, json}. HTTP-Fehler werden zu Exceptions.
        // opts.key: gleicher Schlüssel = gleiches Ziel (z. B. "MW5"). Wartet schon ein Auftrag für dieses Ziel,
        // wird nur dessen Wert ersetzt (der neueste gewinnt) – so überflutet ein Schieberegler die easyE4 nicht.
        dev.request = function (path, opts) {
            if (dev.problem) return Promise.reject(new Error(dev.problem));
            if (closed) return Promise.reject(new Error(tr("errors.closed")));
            const key = opts && opts.key ? dev.id + "|" + opts.key : null;
            const enqueue = () => sched.add({ path, key, run: execute, urgent: !!config.urgent }).catch((err) => {
                if (err.queueFull) throw new Error(tr("errors.queueFull"));
                throw err;
            });
            // 503 = vorübergehend ausgelastet: einmal nach kurzer Pause wiederholen
            return enqueue().then((res) => res.statusCode === 503
                ? new Promise((r) => setTimeout(r, 500)).then(enqueue)
                : res
            ).then((res) => {
                let json;
                if (res.body && res.body.trim()) {
                    try {
                        json = JSON.parse(res.body);
                    } catch (e) {
                        json = undefined;
                    }
                }
                res.json = json;
                if (res.statusCode !== 200 && res.statusCode !== 204) {
                    let key = [400, 401, 403, 404, 501, 503].includes(res.statusCode) ? "http." + res.statusCode : "http.other";
                    if (res.statusCode === 401 && path.startsWith("/api/set/adm")) key = "http.401adm";
                    else if (res.statusCode === 401 && path.startsWith("/api/set/")) key = "http.401set";
                    const e = new Error(tr(key, { code: res.statusCode }));
                    e.statusCode = res.statusCode;
                    e.response = res;
                    throw e;
                }
                return res;
            });
        };

        // Elemente lesen (ggf. auf mehrere Anfragen verteilt, max. 256 Zeichen pro URL)
        dev.read = function (elements) {
            const paths = L.chunkElements(elements, "/api/get/" + dev.readPath + "?elm=");
            const results = [];
            return paths
                .reduce((p, path) => p.then(() => dev.request(path).then((res) => {
                    results.push({ path, json: res.json, parsed: L.parseResponse(res.json) });
                })), Promise.resolve())
                .then(() => ({
                    parsed: L.mergeParsed(results.map((r) => r.parsed)),
                    raw: results.length === 1 ? results[0].json : results.map((r) => r.json),
                    paths,
                }));
        };

        dev.url = function (path) {
            const def = dev.protocol === "https" ? 443 : 80;
            return dev.protocol + "://" + dev.host + (dev.port !== def ? ":" + dev.port : "") + path;
        };

        dev.on("close", function (done) {
            closed = true;
            sched.drop((job) => job.run === execute, new Error(tr("errors.closed")));
            sched.gaps.delete(gapToken);
            releaseAgent(agentKey);
            done();
        });
    }
    function EasyE4JsonDeviceNode(config) {
        RED.nodes.createNode(this, config);
        setupDevice(this, config, this.credentials || {});
    }
    RED.nodes.registerType("easye4json-device", EasyE4JsonDeviceNode, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" },
            apikey: { type: "password" },
        },
    });

    // "Verbindung testen" im Gerätedialog: liest Firmware, Betriebsart und Gerätename
    RED.httpAdmin.post("/easye4json/test", RED.auth.needsPermission("flows.write"), function (req, res) {
        const b = req.body || {};
        let password = b.password;
        let apikey = b.apikey;
        // Unveränderte Kennwörter schickt der Editor nicht im Klartext; dann die gespeicherten verwenden
        if (b.id) {
            const saved = RED.nodes.getCredentials(b.id) || {};
            if (password === "__PWRD__" || password === undefined) password = saved.password;
            if (apikey === "__PWRD__" || apikey === undefined) apikey = saved.apikey;
        }
        // Meldungen in der Sprache des Editors (die Laufzeit kann eine andere Sprache haben)
        const lng = typeof b.lang === "string" && /^[A-Za-z-]{2,10}$/.test(b.lang) ? b.lang : undefined;
        const tr = (key, args) => RED._("easye4json." + key, Object.assign({}, args, lng ? { lng } : {}));
        const tmp = new EventEmitter();
        setupDevice(tmp, {
            host: b.host, protocol: b.protocol, port: b.port, auth: b.auth, timeout: b.timeout,
            verifyCert: b.verifyCert, readPath: b.readPath, gap: b.gap, urgent: true,
        }, { user: b.user, password, apikey }, tr);
        if (tmp.problem) return res.json({ ok: false, text: tmp.problem });
        tmp.read([L.sys("VERSION"), L.sys("STATE"), L.sys("DEVNAME")])
            .then((r) => {
                const v = r.parsed.values;
                res.json({
                    ok: true,
                    text: tr("test.ok", {
                        name: v.DEVNAME !== undefined ? v.DEVNAME : "?",
                        version: v.VERS !== undefined ? v.VERS + (v.BUILD !== undefined ? " (Build " + v.BUILD + ")" : "") : "?",
                        state: v.STATE !== undefined ? v.STATE : "?",
                    }),
                });
            })
            .catch((err) => res.json({ ok: false, text: errText(err, tr) }))
            .finally(() => tmp.emit("close", () => {}));
    });

    // ================================================================================ gemeinsame Teile der Knoten

    function attach(node, config) {
        const dev = RED.nodes.getNode(config.device);
        if (!dev || dev.problem) {
            const p = !dev ? _("errors.noDevice") : dev.problem;
            node.status({ fill: "red", shape: "ring", text: short(p) });
            node.error(p);
            return null;
        }
        node.e4Text = null; // eigener Text (Wert oder Fehler)
        node.e4Fill = null;
        function render() {
            if (node.e4Fill === "red") return node.status({ fill: "red", shape: "ring", text: short(node.e4Text) });
            if (dev.state === "offline") return node.status({ fill: "red", shape: "ring", text: _("status.offline") });
            if (dev.state === "auth") return node.status({ fill: "red", shape: "ring", text: _("status.auth") });
            if (node.e4Text !== null) return node.status({ fill: node.e4Fill || "green", shape: "dot", text: short(node.e4Text) });
            if (dev.state === "online") return node.status({ fill: "green", shape: "dot", text: _("status.online") });
            node.status({ fill: "grey", shape: "ring", text: _("status.unknown") });
        }
        node.e4Show = function (fill, text) {
            node.e4Fill = fill;
            node.e4Text = text;
            render();
        };
        dev.watchers.add(render);
        node.on("close", function () { dev.watchers.delete(render); });
        render();
        return dev;
    }

    function isPlainObject(v) {
        return v !== null && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v) && !(v instanceof Date);
    }

    // Lese-Elemente aus der Knotenkonfiguration; null = aus der Nachricht
    function readElements(config) {
        const mode = config.mode || "operand";
        const int = (v) => parseInt(String(v === undefined ? "" : v).trim(), 10);
        const net = () => int(config.netId || 0);
        switch (mode) {
            case "operand": {
                const t = L.apiType(config.opType || "M");
                return [L.single(t, int(config.index), L.OPS[t] && L.OPS[t].net ? net() : undefined)];
            }
            case "range": {
                const t = L.apiType(config.opType || "M");
                return [L.range(t, int(config.index), int(config.rangeEnd), L.OPS[t] && L.OPS[t].net ? net() : undefined)];
            }
            case "all":
                return [L.all(config.allType || "I")];
            case "sys":
                return [L.sys(config.sys || "STATE")];
            case "fb":
                return [L.fb(config.fbName, int(config.fbInst), int(config.fbPinType), int(config.fbPin))];
            case "list":
                return L.parseList(config.list);
            case "msg":
                return null;
            default:
                throw new Error("mode " + mode);
        }
    }

    // ================================================================================ easyE4 JSON lesen

    function EasyE4JsonReadNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        let fixed;
        try {
            fixed = readElements(config);
        } catch (err) {
            const t = errText(err);
            node.status({ fill: "red", shape: "ring", text: short(t) });
            node.error(t);
            return;
        }
        const dev = attach(node, config);
        if (!dev) return;

        const onlyChange = config.onlyChange === true || config.onlyChange === "true";
        // Abfrageintervall: 0 = aus, sonst mindestens 0,5 s (schont den Webserver der easyE4)
        const iv = Number(String(config.interval === undefined ? "" : config.interval).replace(",", ".")) || 0;
        const interval = iv > 0 ? Math.max(0.5, iv) : 0;
        const last = new Map();
        let running = false;
        let closing = false; // beim Neu-Deployen keine Fehlermeldungen mehr für abgebrochene Abfragen
        let timer = null;

        // Ergebnis für die Ausgabe zusammenstellen
        function build(elements, r) {
            const missing = [];
            const out = {};
            for (const e of elements) {
                const v = L.pick(e, r.parsed);
                if (v === undefined) missing.push(e.elm);
                if (e.kind === "range" || e.kind === "all") Object.assign(out, v);
                else out[e.keys[0]] = v;
            }
            if (elements.length === 1 && (elements[0].kind === "single" || elements[0].kind === "fb" || elements[0].kind === "sys")) {
                const e = elements[0];
                return { single: true, topic: e.keys[0], payload: out[e.keys[0]], missing };
            }
            return { single: false, topic: elements.map((e) => e.elm).join("+"), payload: out, missing };
        }

        function changed(res) {
            if (!onlyChange) return true;
            const s = JSON.stringify(res.payload);
            if (last.get(res.topic) === s) return false;
            last.set(res.topic, s);
            return true;
        }

        function run(msg, elements, send, done) {
            running = true;
            dev.read(elements)
                .then((r) => {
                    const res = build(elements, r);
                    const errors = r.parsed.errors.map((e) => ({ element: e.key, code: e.code, text: codeText(e.code) }));
                    if (errors.length) {
                        node.e4Show("red", errors[0].element + ": " + errors[0].text);
                        const e = new Error(errors.map((x) => x.element + ": " + x.text + " (" + x.code + ")").join("; "));
                        if (done) done(e); else node.error(e.message, msg);
                        return;
                    }
                    if (res.missing.length) {
                        const t = _("errors.noValue", { elm: res.missing.join(", ") });
                        node.e4Show("red", t);
                        if (done) done(new Error(t)); else node.error(t, msg);
                        return;
                    }
                    node.e4Show("green", res.single
                        ? String(isPlainObject(res.payload) ? JSON.stringify(res.payload) : res.payload)
                        : _("status.values", { n: Object.keys(res.payload).length }));
                    if (changed(res)) {
                        const out = msg ? msg : {};
                        out.topic = res.topic;
                        out.payload = res.payload;
                        out.raw = r.raw;
                        if (res.single && r.parsed.extra[res.topic]) out.time = r.parsed.extra[res.topic];
                        send(out);
                    }
                    if (done) done();
                })
                .catch((err) => {
                    if (closing) return;
                    const t = errText(err);
                    if (!err.network && err.statusCode !== 401) node.e4Show("red", t);
                    else node.e4Show(null, null);
                    if (done) done(err); else node.error(t, msg);
                })
                .finally(() => { running = false; });
        }

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) node.error(err, msg); };
            let elements = fixed;
            try {
                if (!elements) {
                    const src = typeof msg.topic === "string" && msg.topic.trim() ? msg.topic
                        : typeof msg.payload === "string" || Array.isArray(msg.payload) ? msg.payload : null;
                    if (src === null) throw new Error(_("errors.noElementInMsg"));
                    elements = L.parseList(src);
                }
            } catch (err) {
                return done(new Error(errText(err)));
            }
            run(msg, elements, send, done);
        });

        if (interval > 0 && fixed) {
            const tick = () => {
                if (!running) run(null, fixed, (m) => node.send(m), null);
            };
            timer = setInterval(tick, interval * 1000);
            setTimeout(tick, 200);
        }
        node.on("close", function () {
            closing = true;
            if (timer) clearInterval(timer);
        });
    }
    RED.nodes.registerType("easye4json-read", EasyE4JsonReadNode);

    // ================================================================================ easyE4 JSON schreiben

    // Schreibaufträge: [{path, label, fb: bool}]
    function writeJobs(config, msg) {
        const mode = config.mode || "operand";
        const int = (v) => parseInt(String(v === undefined ? "" : v).trim(), 10);
        if (mode === "operand") {
            if (msg.payload === undefined) throw new Error(_("errors.payloadMissing"));
            const t = L.apiType(config.opType || "M");
            const net = L.OPS[t] && L.OPS[t].net ? int(config.netId || 0) : undefined;
            return [{ path: L.writeOperandPath(t, int(config.index), net, msg.payload), label: L.keyOf(t, int(config.index), net) }];
        }
        if (mode === "fb") {
            if (msg.payload === undefined) throw new Error(_("errors.payloadMissing"));
            const p = L.fbWriteParam(config.fbName, int(config.fbInst), int(config.fbPinType), int(config.fbPin), msg.payload);
            return [{ path: L.fbWritePaths([p])[0], label: p, fb: true }];
        }
        // aus der Nachricht
        let entries;
        if (isPlainObject(msg.payload)) {
            entries = Object.entries(msg.payload);
        } else if (typeof msg.topic === "string" && msg.topic.trim()) {
            if (msg.payload === undefined) throw new Error(_("errors.payloadMissing"));
            entries = [[msg.topic, msg.payload]];
        } else {
            throw new Error(_("errors.noWriteTarget"));
        }
        if (entries.length === 0) throw new Error(_("errors.noOperands"));
        const jobs = [];
        const fbParams = [];
        for (const [k, v] of entries) {
            const w = L.parseWriteKey(k, v);
            if (w.kind === "fb") fbParams.push(w.param);
            else jobs.push({ path: w.path, label: w.key });
        }
        L.fbWritePaths(fbParams).forEach((p) => jobs.push({ path: p, label: "FB", fb: true }));
        return jobs;
    }

    function EasyE4JsonWriteNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const dev = attach(node, config);
        if (!dev) return;

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) node.error(err, msg); };
            let jobs;
            try {
                jobs = writeJobs(config, msg);
            } catch (err) {
                const t = errText(err);
                node.e4Show("red", t);
                return done(new Error(t));
            }
            const results = [];
            jobs.reduce((p, job) => p.then(() => dev.request(job.path, { key: job.fb ? null : job.label }).then((res) => {
                const errs = job.fb ? L.parseSetParResponse(res.json) : [];
                results.push({ path: job.path, statusCode: res.statusCode, response: res.json });
                if (errs.length) {
                    const e = new Error(errs.map((x) => x.key + ": " + codeText(x.code) + " (" + x.code + ")").join("; "));
                    e.short = errs[0].key + ": " + codeText(errs[0].code);
                    throw e;
                }
            })), Promise.resolve())
                .then(() => {
                    const shown = jobs.length === 1 && config.mode !== "fb"
                        ? jobs[0].label + " = " + (isPlainObject(msg.payload) ? Object.values(msg.payload)[0] : String(msg.payload))
                        : _("status.written", { n: jobs.length });
                    node.e4Show("green", shown);
                    msg.success = true;
                    msg.results = results;
                    send(msg);
                    done();
                })
                .catch((err) => {
                    const t = err.e4 ? errText(err) : err.message;
                    if (!err.network && !(err.statusCode === 401 && dev.state === "auth")) node.e4Show("red", err.short || t);
                    else node.e4Show(null, null);
                    if (err.statusCode === 403) msg.statusCode = 403;
                    done(new Error(t));
                });
        });
    }
    RED.nodes.registerType("easye4json-write", EasyE4JsonWriteNode);

    // ================================================================================ easyE4 JSON aktion

    const ACTIONS = ["run", "stop", "saveFB", "setClock", "setDate", "setTime", "setName", "request"];

    function actionPaths(action, config, msg) {
        switch (action) {
            case "run":
                return ["/api/set/mode?op=state&v1=RUN"];
            case "stop":
                return ["/api/set/mode?op=state&v1=STOP"];
            case "saveFB":
                return ["/api/set/par?op=SAVE"];
            case "setClock": {
                const d = L.toDate(msg.payload);
                return [L.datePath(d), L.timePath(d)];
            }
            case "setDate":
                return [L.datePath(L.toDate(msg.payload))];
            case "setTime":
                return [L.timePath(L.toDate(msg.payload))];
            case "setName": {
                const n = typeof msg.payload === "string" && msg.payload.trim() ? msg.payload.trim() : String(config.devName || "").trim();
                if (!n) throw new Error(_("errors.nameMissing"));
                return ["/api/set/adm?op=devname&v1=" + encodeURIComponent(n)];
            }
            case "request": {
                const p = typeof msg.payload === "string" ? msg.payload.trim() : "";
                if (!/^\/api\/[a-z]+\/[a-z]+\?/i.test(p)) throw new Error(_("errors.badRequestPath"));
                return [p];
            }
        }
        throw new Error(_("errors.unknownAction", { action, list: ACTIONS.join(", ") }));
    }

    function EasyE4JsonActionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const fixed = config.action && config.action !== "msg" ? String(config.action) : null;
        if (fixed && !ACTIONS.includes(fixed)) {
            node.status({ fill: "red", shape: "ring", text: short(_("errors.unknownAction", { action: fixed, list: ACTIONS.join(", ") })) });
            return;
        }
        const dev = attach(node, config);
        if (!dev) return;

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) node.error(err, msg); };
            let action;
            let paths;
            try {
                action = fixed || (typeof msg.action === "string" ? msg.action.trim() : "");
                if (!action) throw new Error(_("errors.noAction", { list: ACTIONS.join(", ") }));
                const found = ACTIONS.find((a) => a.toLowerCase() === action.toLowerCase());
                if (!found) throw new Error(_("errors.unknownAction", { action, list: ACTIONS.join(", ") }));
                action = found;
                paths = actionPaths(action, config, msg);
            } catch (err) {
                return done(new Error(errText(err)));
            }
            const responses = [];
            paths.reduce((p, path) => p.then(() => dev.request(path).then((res) => {
                responses.push(res.json !== undefined ? res.json : res.body || null);
                if (action === "saveFB" || /\/api\/set\/par/.test(path)) {
                    const errs = L.parseSetParResponse(res.json);
                    if (errs.length) throw new Error(errs.map((x) => codeText(x.code) + " (" + x.code + ")").join("; "));
                }
            })), Promise.resolve())
                .then(() => {
                    node.e4Show("green", _("action.label." + action) + " ✓");
                    msg.action = action;
                    msg.success = true;
                    msg.payload = responses.length === 1 ? responses[0] : responses;
                    send(msg);
                    done();
                })
                .catch((err) => {
                    let t = err.message;
                    if (err.statusCode === 403 && ["setClock", "setDate", "setTime", "setName"].includes(action)) {
                        t = _("errors.needStop");
                    }
                    if (!err.network && !(err.statusCode === 401 && dev.state === "auth")) node.e4Show("red", t);
                    else node.e4Show(null, null);
                    msg.action = action;
                    msg.success = false;
                    msg.statusCode = err.statusCode;
                    msg.errorMsg = t;
                    // Fehler auch am Ausgang melden, damit ein Flow darauf reagieren kann
                    send(msg);
                    done(new Error(t));
                });
        });
    }
    RED.nodes.registerType("easye4json-action", EasyE4JsonActionNode);
};
