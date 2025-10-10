# Ancrux MVP - Manual de uso paso a paso

Este documento explica cómo usar ANCRUX

---

## Requisitos previos

- Node.js y npm instalados
- Proyecto configurado en `~/ancrux-mvp`
- Archivo `.env` correctamente configurado con tus credenciales de LND (Voltage)
- Nodo Lightning en Voltage (Testnet) **corriendo y desbloqueado**

---

## Estructura de trabajo

Abre **dos terminales**:

| Terminal | Funcón                                         | Comando principal                           |
| -------- | ---------------------------------------------- | ------------------------------------------- |
| **1**    | Servidor backend (Fastify + SQLite + LND REST) | `npm start`                                 |
| **2**    | Cliente para pruebas con `curl`                | comandos para subir, pagar, consultar, etc. |

---

## Flujo completo

### 1. Iniciar el servidor

```bash
cd ~/ancrux-mvp
npm start
```

Salida esperada:

```
Server listening at http://0.0.0.0:3000
```

> Deja esta terminal abierta.

---

### 2. Subir un video

En otra terminal:

```bash
curl -F 'file=@"/Users/pedromerino/Developer/Dank ass sandboarding son.mp4";type=video/mp4' \
  http://localhost:3000/videos
```

Respuesta esperada:

```json
{"id":"<VIDEO_ID>","algo":"aes-256-gcm","size":1549786}
```

---

### 3. Crear un invoice Lightning

```bash
curl -X POST http://localhost:3000/pay/<VIDEO_ID>
```

Respuesta:

```json
{"video_id":"<VIDEO_ID>","bolt11":"lntb10u1p5...","payment_hash":"..."}
```

> Copia el `bolt11`.

---

### 4. Pagar el invoice

- Abre una wallet Lightning **Testnet** (Mutiny, Phoenix Testnet o Alby Testnet)
- Pega el `bolt11`
- Confirma el pago

---

### 5. Verificar el estado del pago

```bash
curl http://localhost:3000/pay/<VIDEO_ID>/status
```

Esperado:

```json
{"invoice_status":"settled","video_state":"paid"}
```

---

### 6. Obtener claves de desencriptado

```bash
curl http://localhost:3000/keys/<VIDEO_ID>
```

Respuesta:

```json
{
 "cek_b64":"<clave_base64>",
 "nonce_b64":"<nonce_base64>"
}
```

---

### 7. Descargar el video cifrado

```bash
curl -o cipher.bin http://localhost:3000/videos/<VIDEO_ID>
```

---

### 8. Desencriptar el video localmente

```bash
node src/decrypt_local.js cipher.bin video_out.mp4 "<CEK_B64>" "<NONCE_B64>"
```

---

### 9. Verificar el resultado

```bash
open video_out.mp4
```

---

### 10. (Opcional) Verificar integridad del video

```bash
shasum -a 256 "/Users/pedromerino/Developer/Dank ass sandboarding son.mp4"
shasum -a 256 ./video_out.mp4
```

Los hashes deben coincidir.

---

## Notas importantes

- Si `/pay/:id` devuelve error `401/403/5xx`, revisa `.env` (`LND_URL`, `LND_MACAROON_HEX`, `LND_TLS_CERT_B64`) y que el nodo esté **Running + Unlocked**.
- Si `invoice_status` sigue `pending`, confirma en tu wallet que el pago se completó.
- Si el desencriptado falla con `unable to authenticate data`, asegúrate de usar exactamente las claves del mismo video ID.

---

## Resultado esperado

Cuando todo funcione correctamente:

- El servidor cifra y guarda tu video.
- Crea un invoice Lightning para liberarlo.
- Cuando pagas, se marcan `settled` y `paid`.
- Puedes obtener la clave y desencriptar tu video localmente.

