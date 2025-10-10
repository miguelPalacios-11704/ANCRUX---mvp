# ⚡ Guía rápida: Interactuar con tu nodo Lightning (testnet)

Esta guía te ayuda a reconectarte y operar tu nodo LND cada vez que reinicies tu Mac o cierres la terminal.

---

## 🪙 1. Iniciar Bitcoin Core en testnet

Antes de usar Lightning, asegúrate de que Bitcoin Core esté corriendo y sincronizado.

### A. Verifica si ya está corriendo
```bash
bitcoin-cli -testnet getblockchaininfo
```
Debe mostrar:
```json
"chain": "test",
"initialblockdownload": false
```

### B. Si no está corriendo, inícialo desde la terminal
```bash
bitcoind -testnet -daemon
```

Esto arrancará Bitcoin Core en segundo plano.

---

## ⚡ 2. Iniciar tu nodo Lightning (LND)

Cada vez que reinicies o cierres la terminal, necesitas reiniciar LND.

### A. Si LND no está corriendo:
```bash
lnd --network=testnet
```
Déjalo abierto en una pestaña — este proceso es tu servidor Lightning.

### B. Desbloquea tu wallet en otra terminal
```bash
lncli --network=testnet unlock
```
Introduce la contraseña que creaste al configurar LND.
Cuando diga `lnd successfully unlocked`, ya puedes interactuar.

---

## 🔍 3. Verificar el estado del nodo

```bash
lncli --network=testnet getinfo
```
Debe mostrar:
```json
"synced_to_chain": true,
"synced_to_graph": true,
"num_active_channels": 1
```

---

## 💸 4. Operaciones comunes

### Ver canales
```bash
lncli --network=testnet listchannels
```

### Ver balance on-chain
```bash
lncli --network=testnet walletbalance
```

### Ver pagos realizados
```bash
lncli --network=testnet listpayments
```

### Pagar un invoice Lightning
```bash
lncli --network=testnet payinvoice <BOLT11>
```

### Recibir un pago Lightning
```bash
lncli --network=testnet addinvoice --amt=5000 --memo="test payment"
```

---

## 🧹 5. Apagar correctamente

Cuando termines de usar tu nodo:
```bash
lncli --network=testnet stop
```

Esto cierra LND de forma segura.

---

## 🧠 Resumen rápido de comandos

| Tarea | Comando |
|-------|----------|
| Iniciar Bitcoin Core | `bitcoind -testnet -daemon` |
| Iniciar LND | `lnd --network=testnet` |
| Desbloquear wallet LND | `lncli --network=testnet unlock` |
| Verificar estado | `lncli --network=testnet getinfo` |
| Pagar un invoice | `lncli --network=testnet payinvoice <BOLT11>` |
| Recibir un pago | `lncli --network=testnet addinvoice --amt=1000` |
| Apagar LND | `lncli --network=testnet stop` |

---

## 🧩 Tip extra

Si quieres verificar que Bitcoin Core está completamente sincronizado:
```bash
bitcoin-cli -testnet getblockcount
```
Y para monitorear tu canal Lightning activo:
```bash
lncli --network=testnet listchannels
```

---

**Autor:** Pedro Merino  
**Versión:** Testnet Lightning Guide v1.0  
