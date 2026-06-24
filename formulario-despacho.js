const loginPanel = document.querySelector("#loginPanel");
const formPanel = document.querySelector("#formPanel");
const loginForm = document.querySelector("#loginForm");
const dispatchForm = document.querySelector("#dispatchForm");
const loginMessage = document.querySelector("#loginMessage");
const formMessage = document.querySelector("#formMessage");
const submitBtn = document.querySelector("#submitBtn");
const fillExampleBtn = document.querySelector("#fillExampleBtn");
const logoutBtn = document.querySelector("#logoutBtn");

const exampleValues = {
  nombreCliente: "Cristian Galleguillos Contreras",
  rut: "19.348.448-4",
  numeroContacto: "9-89863368",
  correoContacto: "Sin Correo",
  direccion: "Ernesto Melendez 1626, La Cantera",
  zona: "Coquimbo",
  fechaComprometida: "2026-06-13",
  facturaBoleta: "BLV 5228882 - BLV 528883",
  pedidoCompuesto: "Material de Panamericana",
  bodegas: "Material de Panamericana",
  nombreSolicitante: "Mauricio Gonzalez",
  notas: "Dimensionado + materiales",
};

function setMessage(element, text = "", type = "") {
  element.textContent = text;
  element.className = `message ${type}`.trim();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "No se pudo completar la accion.");
  }
  return payload;
}

function showForm() {
  loginPanel.hidden = true;
  formPanel.hidden = false;
  setMessage(loginMessage);
}

function showLogin(message = "") {
  loginPanel.hidden = false;
  formPanel.hidden = true;
  if (message) setMessage(loginMessage, message, "warning");
}

function collectFormValues() {
  return Object.fromEntries(new FormData(dispatchForm).entries());
}

function fillExample() {
  for (const [name, value] of Object.entries(exampleValues)) {
    const input = dispatchForm.elements[name];
    if (input) input.value = value;
  }
  setMessage(formMessage, "Ejemplo cargado. Puedes revisar y enviar.", "success");
}

async function loadSession() {
  try {
    const data = await api("/api/dimaplac-form/session");
    if (!data.configured?.sharedPassword) {
      showLogin("Falta configurar FORM_SHARED_PASSWORD en el servidor.");
      return;
    }
    if (!data.configured?.notionToken || !data.configured?.notionDataSource) {
      showLogin("Faltan variables de Notion en el servidor.");
      return;
    }
    if (data.authenticated) showForm();
    else showLogin();
  } catch (error) {
    showLogin(error.message);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(loginMessage, "Validando clave...");
  const password = document.querySelector("#password").value;
  try {
    await api("/api/dimaplac-form/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    loginForm.reset();
    showForm();
  } catch (error) {
    setMessage(loginMessage, error.message, "danger");
  }
});

dispatchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitBtn.disabled = true;
  setMessage(formMessage, "Enviando a Notion...");
  try {
    const data = await api("/api/dimaplac-form/submissions", {
      method: "POST",
      body: JSON.stringify({ values: collectFormValues() }),
    });
    dispatchForm.reset();
    const suffix = data.pageId ? ` Folio Notion: ${data.pageId}` : "";
    setMessage(formMessage, `Solicitud creada correctamente.${suffix}`, "success");
  } catch (error) {
    setMessage(formMessage, error.message, "danger");
  } finally {
    submitBtn.disabled = false;
  }
});

fillExampleBtn.addEventListener("click", fillExample);

logoutBtn.addEventListener("click", async () => {
  await api("/api/dimaplac-form/logout", { method: "POST", body: "{}" }).catch(() => {});
  showLogin("Sesion cerrada.");
});

loadSession();
