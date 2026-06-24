# Formulario Dimaplac conectado a Notion

Formulario público con clave simple para ingresar solicitudes de despacho y crear filas en la base `aapp` de Notion.

## Ruta

```txt
/formulario-despacho
```

## Variables de entorno

Configurar en Render:

```txt
NOTION_TOKEN=token_de_integracion_de_notion
NOTION_DATA_SOURCE_ID=7de7ae5f-b2dc-830b-b2ad-07e7cb0a643b
NOTION_VERSION=2025-09-03
FORM_SHARED_PASSWORD=clave_para_entrar_al_formulario
FORM_SESSION_SECRET=texto_largo_aleatorio_para_firmar_sesion
HOST=0.0.0.0
NODE_VERSION=22.13.0
```

## Campos enviados

- Nombre cliente → `Nombre Cliente`
- RUT → `Rut cliente `
- Número de contacto → `Numero Cliente`
- Correo de contacto → `Correo  Cliente`
- Dirección → `Dirección de Despacho`
- Zona → `Zona`
- Fecha comprometida entrega → `Fecha comprometida`
- N° boleta/factura → `N° Factura/Boleta`
- Pedido compuesto → `Pedido Compuesto`
- Bodegas → `Bodegas`
- Nombre del solicitante → `Nombre Vendedor`
- Notas u observaciones → `Nota `

Cada solicitud se crea con `Estado del Pedido = pendiente`.
