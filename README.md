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

---

## Actualización: Migración de Lightning a Chipi Pay SDK en server_strk_chipi.js

El sistema de pago de este proyecto ha sido completamente refactorizado, reemplazando la integración con **Lightning Network (LND)** por el **SDK de Chipi Pay**. Este cambio estratégico simplifica el flujo de pago, elimina la necesidad de que los usuarios gestionen canales de Lightning y permite transacciones *gasless* (sin costo de gas para el usuario) directamente en la red de **Starknet**. ⛓️

### Nuevas Características

-   **Billetera Integrada**: Los usuarios pueden crear una billetera de Starknet directamente a través de la API, protegida por un PIN.
-   **Transacciones Gasless**: Chipi Pay actúa como un *paymaster*, cubriendo las tarifas de gas de la red para la acuñación (minting) del NFT que representa la propiedad.
-   **Flujo de Pago Directo**: Se elimina el sistema de facturas (invoices). El pago es ahora una ejecución de transacción directa en la blockchain.

---

### Tecnologías Actualizadas

-   **Chipi Pay SDK**: Para la creación de billeteras y la ejecución de transacciones en Starknet.
-   **Starknet.js**: Utilizado para la conexión con la red de Starknet y la verificación de transacciones y propiedad de NFTs.
-   ~~Lightning Network~~: **Eliminado del proyecto.**

---

### Nueva Arquitectura y Flujo de Trabajo

El flujo de pago ha cambiado de un modelo basado en facturas a uno basado en transacciones directas.

1.  **Creación de Wallet (Nuevo)**: El cliente primero crea una wallet de Chipi Pay a través de la API, especificando un PIN. El cliente debe **guardar de forma segura** las credenciales devueltas (`publicKey` y `encryptedPrivateKey`).
2.  **Upload**: Este paso no cambia. El video se sube y se cifra en el servidor.
3.  **Ejecución de Pago**: En lugar de solicitar una factura, el cliente llama al endpoint de pago con las credenciales de su wallet y su PIN. El servidor utiliza el SDK de Chipi Pay para ejecutar directamente la transacción de `mint` del NFT en el contrato de Starknet.
4.  **Verificación y Desbloqueo**: El servidor ahora verifica el estado de la transacción en la blockchain usando el hash de la transacción. Una vez que la transacción se confirma (`settled`), se considera pagado, y el cliente puede solicitar las claves de descifrado.

---

### Endpoints Modificados y Nuevos

-   `POST /wallet/create` **(Nuevo)**: Crea una nueva billetera de Chipi Pay para el usuario.
-   `POST /pay/:id` **(Modificado)**: Ejecuta directamente la transacción de pago y acuñación del NFT. Ya no genera una factura.
-   `GET /pay/:id/status` **(Modificado)**: Verifica el estado de una transacción en la blockchain usando su hash, en lugar de verificar una factura Lightning.

---

### Nueva Configuración

Actualiza tu archivo `.env` para eliminar las variables de LND y agregar las de Chipi Pay y Starknet.

```bash
# Clave maestra para key wrapping (sin cambios)
MASTER_KEY_BASE64=tu_clave_maestra_base64_aqui

# --- NUEVA CONFIGURACIÓN CHIPI PAY ---
CHIPI_PAYMASTER_API_KEY=tu_api_key_de_chipi_paymaster
CHIPI_RPC_URL=[https://starknet-goerli.infura.io/v3/tu_api_key_de_infura_o_similar](https://starknet-goerli.infura.io/v3/tu_api_key_de_infura_o_similar)

# --- CONFIGURACIÓN STARKNET (Sigue siendo necesaria) ---
STARKNET_NFT_CONTRACT_ADDRESS=0x...
STARKNET_NFT_ABI_PATH=./path/to/your/nft_abi.json
# STARKNET_ACCOUNT_ADDRESS y STARKNET_PRIVATE_KEY ya no son para pagos,
# pero el script los usa para conectar el contrato y llamar a funciones de solo lectura.
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...

# --- VARIABLES LND (ELIMINADAS) ---
# LND_URL
# LND_MACAROON_HEX
# LND_TLS_CERT_B64

---

### Integración Profunda con Starknet.js

Aunque el SDK de Chipi Pay se encarga de la ejecución de la transacción de pago, la librería **`starknet.js`** es fundamental para que nuestro backend pueda interactuar y verificar el estado directamente en la blockchain de Starknet. Esto asegura un sistema robusto y descentralizado.

Las responsabilidades clave de `starknet.js` en este proyecto son:

1.  **Conexión con la Red**: Se inicializa un `Provider` de `starknet.js` que conecta el servidor a un nodo de la red.
 Esta conexión es esencialmente de solo lectura y permite consultar el estado de la blockchain en tiempo real, como el estado de una transacción o la información almacenada en un contrato.

2.  **Verificación del Estado de la Transacción**: En el endpoint `GET /pay/:id/status`, se utiliza la función `provider.waitForTransaction()`. 
Esta función toma el hash de la transacción devuelto por Chipi Pay y sondea la red hasta que la transacción es aceptada y confirmada en un bloque de Starknet. Este es el mecanismo principal y más seguro para confirmar que un pago ha sido exitoso.

3.  **Lectura del Estado del Contrato**: Para verificar la propiedad de un NFT (y así autorizar el acceso a las claves de descifrado 
en el endpoint `GET /keys/:id`), el backend utiliza una instancia del `Contract` de `starknet.js` para llamar a la función de vista `ownerOf`. 
Esto permite preguntar directamente a la blockchain quién es el dueño de un token específico, asegurando que solo el pagador correcto pueda acceder al contenido cifrado.

## Contacto

Para preguntas o soporte, abre un issue en GitHub.

## Referencias

- [LND REST API Documentation](https://lightning.engineering/api-docs/api/lnd/)
- [Fastify Documentation](https://www.fastify.io/)
- [Node.js Crypto Module](https://nodejs.org/api/crypto.html)
