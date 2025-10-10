# Ancrux MVP

MVP de gestión de videos cifrados con pagos Lightning Network. Este proyecto permite subir videos, cifrarlos del lado del servidor, y desbloquear su descifrado mediante pagos Lightning.

## Características

- **Cifrado robusto**: Videos cifrados con AES-256-GCM
- **Gestión de claves**: Sistema de wrapping de claves con HKDF
- **Pagos Lightning**: Integración con LND (Lightning Network Daemon)
- **API REST**: Endpoints para subir, pagar y descargar videos

## Tecnologías

- **Node.js** con ES Modules
- **Fastify** - Framework web rápido y eficiente
- **Better-SQLite3** - Base de datos embebida
- **Lightning Network** - Pagos mediante LND REST API
- **Crypto** - Módulo nativo de Node.js para cifrado

## Arquitectura

### Flujo de trabajo

1. **Upload**: El cliente sube un video que se cifra con una CEK (Content Encryption Key) aleatoria
2. **Storage**: El video cifrado se almacena y la CEK se protege mediante key wrapping
3. **Payment**: Se genera un invoice Lightning para desbloquear el contenido
4. **Unlock**: Una vez pagado, el cliente puede obtener la CEK para descifrar el video

### Endpoints principales

- `POST /videos` - Subir y cifrar un video
- `POST /pay/:id` - Generar invoice Lightning para un video
- `GET /pay/:id/status` - Verificar estado del pago
- `GET /keys/:id` - Obtener claves de descifrado (requiere pago)
- `GET /videos/:id` - Descargar video cifrado

## Instalación

### Requisitos previos

- Node.js v18+
- Un nodo Lightning Network (LND) en testnet o mainnet
- Acceso REST al nodo LND con macaroon adecuado

### Pasos

1. Clonar el repositorio:
```bash
git clone https://github.com/tu-usuario/ancrux-mvp.git
cd ancrux-mvp
```

2. Instalar dependencias:
```bash
npm install
```

3. Configurar variables de entorno (ver sección siguiente)

4. Iniciar el servidor:
```bash
npm start
```

El servidor estará disponible en `http://localhost:3000`

## Configuración

Crear un archivo `.env` en la raíz del proyecto con las siguientes variables:

```bash
# Clave maestra para key wrapping (32 bytes en base64)
MASTER_KEY_BASE64=tu_clave_maestra_base64_aqui

# Configuración LND REST
LND_URL=https://tu-nodo.example.com:8080
LND_MACAROON_HEX=tu_macaroon_en_hexadecimal

# Certificado TLS del nodo (opcional, solo si es self-signed)
LND_TLS_CERT_B64=certificado_tls_en_base64
```

### Generar MASTER_KEY_BASE64

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Obtener credenciales LND

- **Macaroon**: Convertir a hex desde archivo `.macaroon`
- **TLS Cert**: Convertir `tls.cert` a base64 si es necesario
- Ver documentación en `/Tutorial` para más detalles

## Uso

### Subir un video

```bash
curl -X POST http://localhost:3000/videos \
  -F "file=@/ruta/a/video.mp4"
```

Respuesta:
```json
{
  "id": "abc123...",
  "algo": "aes-256-gcm",
  "size": 1048576
}
```

### Generar invoice de pago

```bash
curl -X POST http://localhost:3000/pay/abc123
```

Respuesta:
```json
{
  "video_id": "abc123...",
  "bolt11": "lnbc1000n1...",
  "payment_hash": "def456..."
}
```

### Verificar estado del pago

```bash
curl http://localhost:3000/pay/abc123/status
```

### Obtener claves de descifrado

```bash
curl http://localhost:3000/keys/abc123
```

### Descifrar localmente

```bash
# Primero descargar el video cifrado
curl http://localhost:3000/videos/abc123 -o cipher.bin

# Luego descifrar usando el script incluido
node src/decrypt_local.js cipher.bin video.mp4 <CEK_B64> <NONCE_B64>
```

## Estructura del proyecto

```
ancrux-mvp/
├── src/
│   ├── server.js          # Servidor principal con API
│   └── decrypt_local.js   # Utilidad para descifrar videos
├── Tutorial/              # Documentación adicional
│   ├── guia_nodo_lightning_testnet.md
│   └── ancrux_mvp_usage.md
├── blobs/                 # Almacenamiento de videos cifrados (gitignored)
├── mvp.sqlite            # Base de datos (gitignored)
├── package.json
└── .env                  # Variables de entorno (gitignored)
```

## Seguridad

⚠️ **IMPORTANTE**: Este es un MVP para demostración. Para producción considerar:

- Usar HSM o KMS para la clave maestra
- Implementar autenticación y autorización
- Rate limiting en endpoints
- HTTPS obligatorio
- Backup y redundancia de base de datos
- Validación robusta de inputs
- Manejo de errores más detallado
- Logs de auditoría

## Base de datos

El proyecto usa SQLite con dos tablas principales:

- **videos**: Almacena metadatos y claves envueltas
- **invoices**: Registra invoices Lightning y su estado

## Desarrollo

### Scripts disponibles

- `npm start` - Iniciar servidor en producción

### Testing

Para probar con testnet Lightning:
- Usar un nodo LND en testnet
- Solicitar tBTC en faucets
- Ver `Tutorial/guia_nodo_lightning_testnet.md`

## Licencia

MIT

## Contribuir

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## Contacto

Para preguntas o soporte, abre un issue en GitHub.

## Referencias

- [LND REST API Documentation](https://lightning.engineering/api-docs/api/lnd/)
- [Fastify Documentation](https://www.fastify.io/)
- [Node.js Crypto Module](https://nodejs.org/api/crypto.html)
