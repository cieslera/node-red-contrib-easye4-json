"use strict";
// Hilfsfunktionen für die JSON-API der easyE4 (ohne Node-RED-Abhängigkeit, damit sie einzeln testbar sind).
// Quelle: Eaton Online-Dokumentation "JSON API" sowie Eatons Knoten node-red-contrib-eaton-easye4 (2021).

// Operanden: Breite der Werte in BASE64-Bereichen, Höchstindex laut Doku (0 = abhängig vom Gerät),
// ob es "alle lesen" gibt, ob es ein NET-Operand ist (mit NET-ID) und ob er beschreibbar ist.
const OPS = {
    I: { width: "bit", max: 0, all: true, net: false, write: false },
    O: { width: "bit", max: 0, all: true, net: false, write: false }, // in easySoft "Q"
    AI: { width: "i32", max: 0, all: true, net: false, write: false },
    AO: { width: "i32", max: 0, all: true, net: false, write: false },
    ID: { width: "bit", max: 96, all: false, net: false, write: false },
    M: { width: "bit", max: 512, all: true, net: false, write: true },
    MB: { width: "u8", max: 512, all: false, net: false, write: true },
    MW: { width: "u16", max: 512, all: false, net: false, write: true },
    MD: { width: "i32", max: 256, all: false, net: false, write: true },
    N: { width: "bit", max: 512, all: false, net: true, write: true },
    NB: { width: "u8", max: 64, all: false, net: true, write: true },
    NW: { width: "u16", max: 32, all: false, net: true, write: true },
    ND: { width: "i32", max: 16, all: false, net: true, write: true },
};
const OP_RE = "AI|AO|ID|MB|MW|MD|NB|NW|ND|I|O|Q|M|N";
const MAX_INDEX = 999; // Grenze für Operanden, deren Höchstindex vom Gerät abhängt

// Systeminformationen, die über /api/get/... gelesen werden können
const SYSINFO = ["STATE", "VERSION", "DEVNAME", "DEVLANG", "DEVLOCATION", "DEVID", "DATE", "TIME", "IPSET",
    "CYC", "DIAG", "EXTSTATE", "PROGNAME", "EMAIL", "EMAILGROUPS"];

// Fehlercodes laut Eaton (ERROR im Antworttext)
const ERROR_CODES = [3, 4, 5, 6, 7, 8, 9, 10, 32, 33, 34, 35, 36, 37];

const URL_LIMIT = 256; // laut Doku max. URL-Länge

function apiType(t) {
    const u = String(t).toUpperCase();
    return u === "Q" ? "O" : u;
}
function userType(t) {
    return t === "O" ? "Q" : t;
}

// Schlüssel, unter dem ein Wert ausgegeben wird: "MW3", "Q1", NET-Operanden "N(2;5)"
function keyOf(type, index, net) {
    const t = userType(type);
    return OPS[type] && OPS[type].net ? t + "(" + (net || 0) + ";" + index + ")" : t + index;
}
function fbKey(name, inst, pinType, pin) {
    return name + inst + "(" + pinType + ";" + pin + ")";
}

function checkIndex(type, n, what) {
    const def = OPS[type];
    const max = def.max || MAX_INDEX;
    if (!Number.isInteger(n) || n < 1 || n > max) {
        const e = new Error("index");
        e.e4 = { key: "indexRange", args: { what: what || userType(type), max } };
        throw e;
    }
}
function checkNet(net) {
    if (!Number.isInteger(net) || net < 0 || net > 8) {
        const e = new Error("net");
        e.e4 = { key: "netRange", args: {} };
        throw e;
    }
}
function fail(key, args) {
    const e = new Error(key);
    e.e4 = { key, args: args || {} };
    return e;
}

// ------------------------------------------------------------------------------------------------ Elemente bilden
// Ein "Element" beschreibt, was gelesen wird:
// { elm: "MW(3)", kind: "single"|"range"|"all"|"fb"|"sys", type, index, end, net, keys: [...] }

function single(type, index, net) {
    type = apiType(type);
    const def = OPS[type];
    if (!def) throw fail("unknownType", { type });
    checkIndex(type, index);
    if (def.net) {
        checkNet(net);
        return { elm: type + "(" + net + ";" + index + ")", kind: "single", type, index, net, keys: [keyOf(type, index, net)] };
    }
    return { elm: type + "(" + index + ")", kind: "single", type, index, keys: [keyOf(type, index)] };
}

function range(type, start, end, net) {
    type = apiType(type);
    const def = OPS[type];
    if (!def) throw fail("unknownType", { type });
    checkIndex(type, start);
    checkIndex(type, end);
    if (end < start) throw fail("rangeOrder", {});
    const keys = [];
    for (let i = start; i <= end; i++) keys.push(keyOf(type, i, net));
    // Bit-Bereiche müssen laut Eaton ganze Bytes abdecken (sonst API-Fehler 7): I3..I6 -> I(1,8)
    let a = start;
    let b = end;
    if (def.width === "bit") {
        a = Math.floor((start - 1) / 8) * 8 + 1;
        b = Math.ceil(end / 8) * 8;
        if (def.max) b = Math.min(b, def.max);
    }
    if (def.net) {
        checkNet(net);
        return { elm: type + "(" + net + ";" + a + "," + b + ")", kind: "range", type, index: start, end, net, keys };
    }
    return { elm: type + "(" + a + "," + b + ")", kind: "range", type, index: start, end, keys };
}

function all(type) {
    type = apiType(type);
    const def = OPS[type];
    if (!def) throw fail("unknownType", { type });
    if (!def.all) throw fail("noAll", { type: userType(type) });
    return { elm: type, kind: "all", type, keys: null };
}

function fb(name, inst, pinType, pin) {
    const n = String(name || "").trim().toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(n)) throw fail("fbName", {});
    if (!Number.isInteger(inst) || inst < 1 || inst > 255) throw fail("fbInst", {});
    if (![0, 1, 2, 3].includes(pinType)) throw fail("fbPinType", {});
    if (!Number.isInteger(pin) || pin < 0 || pin > 63) throw fail("fbPin", {});
    return { elm: "FB" + n + inst + "(" + pinType + ";" + pin + ")", kind: "fb", name: n, inst, pinType, pin, keys: [fbKey(n, inst, pinType, pin)] };
}

function sys(name) {
    const n = String(name || "").trim().toUpperCase();
    if (!SYSINFO.includes(n)) throw fail("unknownSys", { name: n });
    return { elm: n, kind: "sys", name: n, keys: [n] };
}

function toInt(s) {
    return s === undefined ? undefined : parseInt(s, 10);
}

// Text in ein Element umwandeln. Erlaubt u. a.:
// MW3, MW(3), Q1, MW(1,8), MW1-8, N(2;5), N(2;1,8), I, M, STATE, FBT1(2;0), T1(2;0)
function parseElement(text) {
    const s = String(text === undefined || text === null ? "" : text).trim().replace(/\s+/g, "");
    if (!s) throw fail("emptyElement", {});
    const up = s.toUpperCase();
    let m;
    if (SYSINFO.includes(up)) return sys(up);
    if ((m = new RegExp("^(" + OP_RE + ")$").exec(up))) return all(m[1]);
    if ((m = new RegExp("^(" + OP_RE + ")0*(\\d+)$").exec(up))) {
        const t = apiType(m[1]);
        return single(t, toInt(m[2]), OPS[t].net ? 0 : undefined);
    }
    if ((m = new RegExp("^(" + OP_RE + ")0*(\\d+)-0*(\\d+)$").exec(up))) {
        const t = apiType(m[1]);
        return range(t, toInt(m[2]), toInt(m[3]), OPS[t].net ? 0 : undefined);
    }
    // NET-Operanden mit NET-ID: N(2;5) oder N(2;1,8)
    if ((m = /^(N|NB|NW|ND)\((\d+);(\d+)(?:,(\d+))?\)$/.exec(up))) {
        const net = toInt(m[2]);
        return m[4] === undefined ? single(m[1], toInt(m[3]), net) : range(m[1], toInt(m[3]), toInt(m[4]), net);
    }
    if ((m = new RegExp("^(" + OP_RE + ")\\((\\d+)(?:,(\\d+))?\\)$").exec(up))) {
        const t = apiType(m[1]);
        const net = OPS[t].net ? 0 : undefined;
        return m[3] === undefined ? single(t, toInt(m[2]), net) : range(t, toInt(m[2]), toInt(m[3]), net);
    }
    // Funktionsbaustein-Pin: FBT1(2;0) oder T1(2;0) (auch mit Komma)
    if ((m = /^(?:FB)?([A-Z]{1,3})(\d+)\(([0-3])[;,](\d+)\)$/.exec(up))) {
        return fb(m[1], toInt(m[2]), toInt(m[3]), toInt(m[4]));
    }
    throw fail("badElement", { text: String(text) });
}

// Liste "M1, MW3; I(1,8) STATE" -> Elemente. Trenner: Komma/Semikolon/Leerzeichen außerhalb von Klammern, "+"
function parseList(text) {
    if (Array.isArray(text)) return text.map(parseElement);
    const s = String(text || "");
    const parts = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
        if (ch === "(") depth++;
        if (ch === ")") depth = Math.max(0, depth - 1);
        if (depth === 0 && /[,;+\s\n]/.test(ch)) {
            if (cur.trim()) parts.push(cur.trim());
            cur = "";
        } else {
            cur += ch;
        }
    }
    if (cur.trim()) parts.push(cur.trim());
    if (parts.length === 0) throw fail("emptyElement", {});
    return parts.map(parseElement);
}

// Elemente zu Abfragen zusammenfassen, so dass jede URL höchstens URL_LIMIT Zeichen hat
function chunkElements(elements, prefix) {
    const chunks = [];
    let cur = [];
    let len = prefix.length;
    const seen = new Set();
    for (const e of elements) {
        if (seen.has(e.elm)) continue;
        seen.add(e.elm);
        const add = (cur.length ? 1 : 0) + e.elm.length;
        if (cur.length && len + add > URL_LIMIT) {
            chunks.push(cur);
            cur = [];
            len = prefix.length;
        }
        cur.push(e.elm);
        len += (cur.length > 1 ? 1 : 0) + e.elm.length;
    }
    if (cur.length) chunks.push(cur);
    return chunks.map((c) => prefix + c.join("+"));
}

// ------------------------------------------------------------------------------------------------ Antwort auswerten

// BASE64 -> Werte. Bits: niedrigstes Bit zuerst (Bit 0 von Byte 0 = erster Operand), Zahlen little-endian.
function decodeBase64(b64, width) {
    const buf = Buffer.from(String(b64), "base64");
    const out = [];
    if (width === "bit") {
        for (let i = 0; i < buf.length; i++) for (let j = 0; j < 8; j++) out.push((buf[i] >>> j) & 1);
    } else if (width === "u8") {
        for (let i = 0; i < buf.length; i++) out.push(buf[i]);
    } else if (width === "u16") {
        for (let i = 0; i + 1 < buf.length; i += 2) out.push(buf.readUInt16LE(i));
    } else if (width === "i16") {
        for (let i = 0; i + 1 < buf.length; i += 2) out.push(buf.readInt16LE(i));
    } else if (width === "u32") {
        for (let i = 0; i + 3 < buf.length; i += 4) out.push(buf.readUInt32LE(i));
    } else {
        for (let i = 0; i + 3 < buf.length; i += 4) out.push(buf.readInt32LE(i));
    }
    return out;
}

// Breite aus der Bytezahl ableiten: Eaton beschreibt AI/AO als Wort (2 Byte), die Beispiele liefern aber
// 4 Byte je Wert. Passt die Bytezahl eindeutig zu 2 oder 4 Byte je Wert, gilt diese.
function widthFor(type, b64, count) {
    const def = OPS[type];
    if (def.width === "bit" || def.width === "u8" || !count) return def.width;
    const bytes = Buffer.from(String(b64), "base64").length;
    if (bytes === count * 4) return def.width === "u16" ? "u32" : "i32";
    if (bytes === count * 2) return def.width === "u16" ? "u16" : "i16";
    return def.width;
}
const ALL_COUNT = { I: 128, O: 128, AI: 48, AO: 48, M: 512, N: 512 };

// Einzelwert: ab Firmware 1.20 eine Zahl, bis 1.10 BASE64. Auch "0" als Text kommt vor.
function decodeSingle(v, width) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    const s = String(v).trim();
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    const arr = decodeBase64(s, width);
    return arr.length ? arr[0] : null;
}

function timeToMs(o) {
    const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
    return ((n(o.H) * 60 + n(o.M)) * 60 + n(o.S)) * 1000 + n(o.MS);
}

// Antwort (JSON-Objekt) -> { values: {Schlüssel: Wert}, errors: [{key, code}], extra: {Schlüssel: Zusatzinfo} }
function parseResponse(json) {
    const values = {};
    const errors = [];
    const extra = {};
    if (!json || typeof json !== "object") return { values, errors, extra };

    const ops = json.OPERANDS;
    if (ops && typeof ops === "object") {
        for (const k of Object.keys(ops)) {
            const m = /^(AI|AO|ID|MB|MW|MD|NB|NW|ND|I|O|M|N)(SINGLE|RANGE|ALL)$/.exec(k);
            if (!m) continue;
            const type = m[1];
            const def = OPS[type];
            const v = ops[k];
            if (m[2] === "ALL") {
                if (typeof v === "string") decodeBase64(v, widthFor(type, v, ALL_COUNT[type])).forEach((x, i) => { values[keyOf(type, i + 1)] = x; });
                continue;
            }
            for (const e of Array.isArray(v) ? v : [v]) {
                if (!e || typeof e !== "object") continue;
                const net = e.ID !== undefined ? Number(e.ID) : 0;
                if (m[2] === "SINGLE") {
                    const key = keyOf(type, Number(e.INDEX), net);
                    if (e.ERROR !== undefined) errors.push({ key, code: Number(e.ERROR) });
                    else if (e.V !== undefined) values[key] = decodeSingle(e.V, def.width);
                } else {
                    const start = Number(e.START);
                    const end = Number(e.END);
                    if (e.ERROR !== undefined) {
                        errors.push({ key: keyOf(type, start, net) + "-" + end, code: Number(e.ERROR) });
                    } else if (e.V !== undefined) {
                        const arr = decodeBase64(e.V, widthFor(type, e.V, end - start + 1));
                        for (let i = start; i <= end && i - start < arr.length; i++) values[keyOf(type, i, net)] = arr[i - start];
                    }
                }
            }
        }
    }

    const fbs = json.FB;
    if (fbs && typeof fbs === "object") {
        for (const name of Object.keys(fbs)) {
            for (const e of Array.isArray(fbs[name]) ? fbs[name] : [fbs[name]]) {
                if (!e || typeof e !== "object") continue;
                const key = fbKey(name, e.INST, e.TYPE, e.OFFSET);
                if (e.ERROR !== undefined) {
                    errors.push({ key, code: Number(e.ERROR) });
                } else if (e.TIMEBASE !== undefined || e.H !== undefined) {
                    values[key] = timeToMs(e);
                    extra[key] = { timebase: Number(e.TIMEBASE), h: Number(e.H) || 0, m: Number(e.M) || 0, s: Number(e.S) || 0, ms: Number(e.MS) || 0 };
                } else if (e.V !== undefined) {
                    values[key] = decodeSingle(e.V, "i32");
                }
            }
        }
    }

    const si = json.SYSINFO || json.Sysinfo || json.sysinfo;
    if (si && typeof si === "object") {
        for (const k of Object.keys(si)) values[k] = si[k];
        if (si.VERS !== undefined || si.BUILD !== undefined) values.VERSION = { VERS: si.VERS, BUILD: si.BUILD };
        if (si.DIAG_LIST !== undefined || si.DIAG_CNT !== undefined) {
            values.DIAG = { DIAG_CNT: si.DIAG_CNT, DIAG_TIME: si.DIAG_TIME, DIAG_LIST: si.DIAG_LIST };
        }
    }
    return { values, errors, extra };
}

// Werte für ein Element aus der ausgewerteten Antwort holen
function pick(element, parsed) {
    if (element.kind === "all") {
        const out = {};
        const prefix = userType(element.type);
        const re = new RegExp("^" + prefix + "\\d+$");
        for (const k of Object.keys(parsed.values)) if (re.test(k)) out[k] = parsed.values[k];
        return out;
    }
    if (element.kind === "range") {
        const out = {};
        for (const k of element.keys) if (parsed.values[k] !== undefined) out[k] = parsed.values[k];
        return out;
    }
    if (element.kind === "fb") {
        const k = element.keys[0];
        if (parsed.values[k] !== undefined) return parsed.values[k];
        // Ersatz: genau ein Ergebnis für diesen Baustein, aber mit abweichender Nummerierung
        const re = new RegExp("^" + element.name + "\\d+\\(" + element.pinType + ";" + element.pin + "\\)$");
        const cand = Object.keys(parsed.values).filter((x) => re.test(x));
        return cand.length === 1 ? parsed.values[cand[0]] : undefined;
    }
    return parsed.values[element.keys[0]];
}

function mergeParsed(list) {
    const out = { values: {}, errors: [], extra: {} };
    for (const p of list) {
        Object.assign(out.values, p.values);
        Object.assign(out.extra, p.extra);
        out.errors.push(...p.errors);
    }
    return out;
}

// ------------------------------------------------------------------------------------------------ Schreiben

function toWriteValue(v) {
    let x = v;
    if (typeof x === "string") {
        const t = x.trim().toLowerCase();
        if (t === "true" || t === "false") x = t === "true";
        else if (t !== "" && Number.isFinite(Number(t))) x = Number(t);
    }
    if (typeof x === "boolean") x = x ? 1 : 0;
    if (typeof x !== "number" || !Number.isFinite(x)) throw fail("invalidValue", {});
    if (!Number.isInteger(x)) throw fail("integer", {});
    return x;
}

const WRITE_LIMITS = {
    bit: [0, 1],
    u8: [0, 255],
    u16: [-32768, 65535],
    i32: [-2147483648, 4294967295],
};

// Pfad zum Schreiben eines Operanden
function writeOperandPath(type, index, net, value) {
    type = apiType(type);
    const def = OPS[type];
    if (!def) throw fail("unknownType", { type });
    if (!def.write) throw fail("notWritable", { type: userType(type) });
    checkIndex(type, index);
    const x = toWriteValue(value);
    const lim = WRITE_LIMITS[def.width];
    if (x < lim[0] || x > lim[1]) throw fail("valueRange", { name: keyOf(type, index, net), min: lim[0], max: lim[1] });
    let p = "/api/set/op?op=" + type + "&index=" + index;
    if (def.net) {
        checkNet(net);
        p += "&netid=" + net;
    }
    return p + "&val=" + x;
}

// Ein FB-Eingang zum Schreiben: "T1(2;0;2000)"
function fbWriteParam(name, inst, pinType, pin, value) {
    const n = String(name || "").trim().toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(n)) throw fail("fbName", {});
    if (!Number.isInteger(inst) || inst < 1 || inst > 255) throw fail("fbInst", {});
    if (pinType !== 0 && pinType !== 2) throw fail("fbWritePinType", {});
    if (!Number.isInteger(pin) || pin < 0 || pin > 63) throw fail("fbPin", {});
    const x = toWriteValue(value);
    if (pinType === 0 && x !== 0 && x !== 1) throw fail("valueRange", { name: n + inst, min: 0, max: 1 });
    return n + inst + "(" + pinType + ";" + pin + ";" + x + ")";
}

// Bis zu 7 FB-Parameter pro Aufruf
function fbWritePaths(params) {
    const out = [];
    for (let i = 0; i < params.length; i += 7) {
        const part = params.slice(i, i + 7);
        out.push("/api/set/par?op=FB&" + part.map((p, j) => "v" + (j + 1) + "=" + p).join("&"));
    }
    return out;
}

// Schlüssel aus msg.payload-Objekt -> Schreibauftrag
// "M5", "MW3", "Q1" (abgelehnt), "N(2;5)", "T1(2;0)" / "FBT1(2;0)"
function parseWriteKey(key, value) {
    const s = String(key).trim().replace(/\s+/g, "").toUpperCase();
    let m;
    if ((m = /^(?:FB)?([A-Z]{1,3})(\d+)\(([0-3])[;,](\d+)\)$/.exec(s)) && !new RegExp("^(" + OP_RE + ")$").test(m[1] + "")) {
        return { kind: "fb", param: fbWriteParam(m[1], toInt(m[2]), toInt(m[3]), toInt(m[4]), value) };
    }
    if ((m = /^(N|NB|NW|ND)\((\d+);(\d+)\)$/.exec(s))) {
        return { kind: "op", path: writeOperandPath(m[1], toInt(m[3]), toInt(m[2]), value), key: m[1] + "(" + toInt(m[2]) + ";" + toInt(m[3]) + ")" };
    }
    if ((m = new RegExp("^(" + OP_RE + ")(?:0*(\\d+)|\\(0*(\\d+)\\))$").exec(s))) {
        const t = apiType(m[1]);
        const idx = toInt(m[2] !== undefined ? m[2] : m[3]);
        return { kind: "op", path: writeOperandPath(t, idx, OPS[t] && OPS[t].net ? 0 : undefined, value), key: keyOf(t, idx, 0) };
    }
    throw fail("badElement", { text: String(key) });
}

// Antwort von /api/set/par auswerten: [{"T1(2;0;2000)":0,"SUCCESS":0}] oder [{..., "ERROR":37}]
function parseSetParResponse(json) {
    const errors = [];
    const list = Array.isArray(json) ? json : json && typeof json === "object" ? [json] : [];
    for (const e of list) {
        if (!e || typeof e !== "object") continue;
        if (e.ERROR !== undefined) {
            const name = Object.keys(e).find((k) => k !== "ERROR" && k !== "SUCCESS") || "";
            errors.push({ key: name, code: Number(e.ERROR) });
        }
    }
    return errors;
}

// ------------------------------------------------------------------------------------------------ Datum/Uhrzeit

function toDate(v) {
    if (v === undefined || v === null || v === "" || v === "now") return new Date();
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);
    const d = new Date(String(v));
    if (isNaN(d.getTime())) throw fail("badDate", {});
    return d;
}

function datePath(d) {
    return "/api/set/clock?op=date&v1=" + d.getFullYear() + "&v2=" + (d.getMonth() + 1) + "&v3=" + d.getDate();
}
function timePath(d) {
    return "/api/set/clock?op=time&v1=" + d.getHours() + "&v2=" + d.getMinutes() + "&v3=" + d.getSeconds();
}

module.exports = {
    OPS, SYSINFO, ERROR_CODES, URL_LIMIT,
    apiType, userType, keyOf, fbKey,
    single, range, all, fb, sys, parseElement, parseList, chunkElements,
    decodeBase64, decodeSingle, parseResponse, pick, mergeParsed,
    toWriteValue, writeOperandPath, fbWriteParam, fbWritePaths, parseWriteKey, parseSetParResponse,
    toDate, datePath, timePath,
};
