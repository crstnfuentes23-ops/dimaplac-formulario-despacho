const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const MAX_BODY_BYTES = 64 * 1024;
const FORM_TTL_MS = 12 * 60 * 60 * 1000;
const FORM_COOKIE = "dimaplac_form_session";
const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
const NOTION_DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID || "7de7ae5f-b2dc-830b-b2ad-07e7cb0a643b";
const NOTION_VERSION = process.env.NOTION_VERSION || "2025-09-03";
const FORM_SHARED_PASSWORD = process.env.FORM_SHARED_PASSWORD || "";
const FORM_SESSION_SECRET = process.env.FORM_SESSION_SECRET || "";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest();
}

function safeEqualText(left, right) {
  return crypto.timingSafeEqual(hashText(left), hashText(right));
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index === -1) return cookies;
      cookies[decodeURIComponent(part.slice(0, index).trim())] = decodeURIComponent(part.slice(index + 1).trim());
      return cookies;
    }, {});
}

function sessionSecret() {
  return FORM_SESSION_SECRET || FORM_SHARED_PASSWORD || "dimaplac-local-session";
}

function signSession(expiresAt) {
  return crypto.createHmac("sha256", sessionSecret()).update(String(expiresAt)).digest("hex");
}

function cookieOptions(maxAgeSeconds = Math.floor(FORM_TTL_MS / 1000)) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function setSessionCookie(res) {
  const expiresAt = Date.now() + FORM_TTL_MS;
  const value = `${expiresAt}.${signSession(expiresAt)}`;
  res.setHeader("Set-Cookie", `${FORM_COOKIE}=${encodeURIComponent(value)}; ${cookieOptions()}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${FORM_COOKIE}=; ${cookieOptions(0)}`);
}

function isAuthenticated(req) {
  const cookie = parseCookies(req)[FORM_COOKIE];
  const [expiresAtText, signature] = String(cookie || "").split(".");
  const expiresAt = Number(expiresAtText);
  if (!expiresAt || !signature || expiresAt < Date.now()) return false;
  return safeEqualText(signature, signSession(expiresAt));
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  setCors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  setCors(res);
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function readBody(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function text(value, maxLength = 500) {
  return normalizeText(value).slice(0, maxLength);
}

function richText(value) {
  const content = text(value, 1900);
  return { rich_text: content ? [{ type: "text", text: { content } }] : [] };
}

function title(value) {
  const content = text(value, 1900);
  return { title: content ? [{ type: "text", text: { content } }] : [] };
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateSubmission(values) {
  const data = {
    nombreCliente: text(values.nombreCliente),
    rut: text(values.rut),
    numeroContacto: text(values.numeroContacto),
    correoContacto: text(values.correoContacto),
    direccion: text(values.direccion),
    zona: text(values.zona),
    fechaComprometida: text(values.fechaComprometida, 20),
    facturaBoleta: text(values.facturaBoleta),
    pedidoCompuesto: text(values.pedidoCompuesto),
    bodegas: text(values.bodegas),
    nombreSolicitante: text(values.nombreSolicitante),
    notas: text(values.notas, 1900),
  };
  const required = [
    ["nombreCliente", "Nombre cliente"],
    ["rut", "RUT"],
    ["numeroContacto", "Numero de contacto"],
    ["direccion", "Direccion"],
    ["zona", "Zona"],
    ["fechaComprometida", "Fecha comprometida entrega"],
    ["facturaBoleta", "N boleta/factura"],
    ["pedidoCompuesto", "Pedido compuesto"],
    ["bodegas", "Bodegas"],
    ["nombreSolicitante", "Nombre del solicitante"],
  ];
  const missing = required.filter(([key]) => !data[key]).map(([, label]) => label);
  if (missing.length) return { error: `Faltan campos obligatorios: ${missing.join(", ")}.` };
  if (!isIsoDate(data.fechaComprometida)) return { error: "La fecha comprometida debe tener formato valido." };
  return { data };
}

function notionProperties(data) {
  return {
    "Nombre Cliente": title(data.nombreCliente),
    "Rut cliente ": richText(data.rut),
    "Numero Cliente": richText(data.numeroContacto),
    "Correo  Cliente": richText(data.correoContacto || "Sin Correo"),
    "Dirección de Despacho": richText(data.direccion),
    Zona: richText(data.zona),
    "Fecha comprometida": { date: { start: data.fechaComprometida } },
    "N° Factura/Boleta": richText(data.facturaBoleta),
    "Pedido Compuesto": richText(data.pedidoCompuesto),
    Bodegas: richText(data.bodegas),
    "Nombre Vendedor": richText(data.nombreSolicitante),
    "Nota ": richText(data.notas),
    "Estado del Pedido": { status: { name: "pendiente" } },
    "Registro del Despacho": { date: { start: nowIso() } },
  };
}

async function createNotionPage(data) {
  if (!NOTION_TOKEN) {
    const error = new Error("Falta configurar NOTION_TOKEN.");
    error.status = 500;
    throw error;
  }
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: NOTION_DATA_SOURCE_ID },
      properties: notionProperties(data),
    }),
  });
  const raw = await response.text();
  const payload = safeJsonParse(raw, {});
  if (!response.ok) {
    console.error("NOTION_CREATE_FAILED", response.status, payload.code || "", payload.message || raw.slice(0, 300));
    const error = new Error("Notion rechazo el envio. Revisa token, permisos, data source o columnas.");
    error.status = response.status >= 500 ? 502 : 400;
    throw error;
  }
  return payload;
}

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && pathname === "/api/dimaplac-form/session") {
    return sendJson(res, 200, {
      ok: true,
      authenticated: isAuthenticated(req),
      configured: {
        notionToken: Boolean(NOTION_TOKEN),
        notionDataSource: Boolean(NOTION_DATA_SOURCE_ID),
        sharedPassword: Boolean(FORM_SHARED_PASSWORD),
      },
    });
  }
  if (req.method === "POST" && pathname === "/api/dimaplac-form/login") {
    const body = await readBody(req).catch((error) => ({ __error: error }));
    if (body.__error) return sendJson(res, 400, { ok: false, message: "JSON invalido." });
    if (!FORM_SHARED_PASSWORD) return sendJson(res, 500, { ok: false, message: "Falta configurar FORM_SHARED_PASSWORD." });
    if (!safeEqualText(normalizeText(body.password), FORM_SHARED_PASSWORD)) return sendJson(res, 401, { ok: false, message: "Clave incorrecta." });
    setSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/dimaplac-form/logout") {
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/dimaplac-form/submissions") {
    if (!isAuthenticated(req)) return sendJson(res, 401, { ok: false, message: "Ingresa la clave del formulario para enviar." });
    const body = await readBody(req).catch((error) => ({ __error: error }));
    if (body.__error) return sendJson(res, body.__error.message === "REQUEST_TOO_LARGE" ? 413 : 400, { ok: false, message: "No se pudo leer el envio." });
    const validation = validateSubmission(body.values || {});
    if (validation.error) return sendJson(res, 400, { ok: false, message: validation.error });
    try {
      const page = await createNotionPage(validation.data);
      return sendJson(res, 201, { ok: true, pageId: page.id || "" });
    } catch (error) {
      return sendJson(res, error.status || 502, { ok: false, message: error.message || "No se pudo enviar a Notion." });
    }
  }
  return sendJson(res, 404, { ok: false, message: "Recurso no encontrado." });
}

function staticPath(pathname) {
  if (pathname === "/" || pathname === "/formulario-despacho") return "/formulario-despacho.html";
  return pathname;
}

async function serveStatic(req, res, pathname) {
  const targetPath = staticPath(pathname);
  if (targetPath.includes("..")) return sendText(res, 400, "Ruta invalida.");
  const fullPath = path.join(ROOT_DIR, targetPath);
  if (!fullPath.startsWith(ROOT_DIR)) return sendText(res, 403, "Acceso denegado.");
  const content = await fsp.readFile(fullPath).catch(() => null);
  if (!content) return sendText(res, 404, "Archivo no encontrado.");
  setCors(res);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(fullPath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : content);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(urlObj.pathname);
    if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) return sendText(res, 405, "Metodo no permitido.");
    if (req.method === "OPTIONS") {
      setCors(res);
      res.writeHead(204);
      res.end();
      return;
    }
    return serveStatic(req, res, pathname);
  } catch (error) {
    console.error("SERVER_ERROR", error);
    return sendJson(res, 500, { ok: false, message: "Error interno del servidor." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dimaplac form running at http://${HOST}:${PORT}`);
});
