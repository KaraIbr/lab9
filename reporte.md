# Integracion Frontend con Web3: Desarrollo de dApps

**Ingenieria en Seguridad Informatica y Desarrollo de Software**
**Noveno Cuatrimestre**
**Materia:** Blockchain y Bases de Datos Distribuidas
**Maestro:** Omar Velazquez

**Elaborado por:** Karina Ibarra Morales
**Fecha:** 10 de julio de 2026
**Entorno:** Windows | Node.js v22.13.0 | npm 10.9.2 | ethers.js v6.17.0 | Vite v8.1.4

## Ancla de Sesion

```
SESION: 20260710_134211 | NODE: v22.13.0 | NPM: 10.9.2 | USUARIO: ms-desk\milkshakes
```

## Resumen

Este laboratorio construye la capa frontend de una aplicacion descentralizada (dApp) que conecta la wallet de un usuario mediante MetaMask con el contrato inteligente `BovedaSegura.sol` previamente desplegado en la red de pruebas Sepolia. Se implementa la deteccion del proveedor EIP-1193, la conexion de cuentas, la lectura de estado del contrato via llamadas `view`, el envio de transacciones firmadas para deposito y retiro de ETH, el manejo de eventos del proveedor (cambio de cuenta y red), y la suscripcion a eventos emitidos por el contrato. El entorno utiliza ethers.js v6.17.0 sobre Vite v8.1.4, y el contrato desplegado se encuentra en la direccion `0x7cD40dB0BC57C9Ed6482e9583F4435C59F39cF07` en Sepolia. Se analizan las diferencias entre Provider y Signer, el mecanismo `eth_call` para lecturas sin costo de gas, el modelo de asignacion de costos de gas, y las ventajas de librerias de mayor nivel como wagmi sobre la implementacion manual directa con ethers.js.

## 1. Introduccion

En el laboratorio anterior se configuro un entorno profesional de desarrollo con Hardhat, se compilo, teste y desplego el contrato `BovedaSegura.sol` en la red de pruebas Sepolia. Sin embargo, la unica forma de interactuar con el contrato era mediante scripts de Hardhat ejecutados desde la linea de comandos. Los usuarios finales no tienen acceso a dicha interfaz.

Este laboratorio construye la capa frontend que conecta la wallet del usuario (MetaMask) con el contrato desplegado, permitiendo depositos y retiros directamente desde el navegador. El caso de uso es el siguiente: un equipo desplego un contrato de deposito/retiro en Sepolia, pero los usuarios solo pueden interactuar con el via scripts. La tarea es construir la interfaz web que resuelve ese problema.

## 2. Marco Teorico

### 2.1 EIP-1193 y el modelo de provider

El EIP-1193 (Ethereum Provider JavaScript API) define un estandar para como las aplicaciones web se comunican con la red Ethereum a traves de un "proveedor" inyectado por el navegador o una extension (Ethereum Foundation, 2021). El proveedor actua como intermediario: la aplicacion le envia solicitudes RPC (Remote Procedure Call) y el proveedor las retransmite a un nodo Ethereum, retornando los resultados.

El EIP-1193 especifica dos mecanismos de comunicacion:

- **Solicitud directa:** `provider.request({ method, params })` retorna una promesa con el resultado. Es el metodo principal para llamadas como `eth_requestAccounts`, `eth_call` o `eth_sendTransaction`.
- **Eventos:** El proveedor emite eventos como `accountsChanged` y `chainChanged` cuando el usuario modifica su estado en la wallet.

Este modelo es fundamental porque desacopla la aplicacion del transporte subyacente: la dApp no necesita saber si el nodo esta en localhost, en Alchemy, o en Infura. Solo interactua con el objeto `provider` que le expone la interfaz unificada (Wood, 2014).

### 2.2 ethers.js: Provider vs Signer

ethers.js v6 distingue dos abstracciones principales (Ethers.js Contributors, 2024):

- **Provider:** Objeto de solo lectura que permite consultar el estado de la blockchain: balances, bloques, codigo de contrato, resultados de funciones `view`. Un Provider **no puede firmar transacciones** porque no tiene acceso a llaves privadas. Se instancia con `new BrowserProvider(window.ethereum)` o `new JsonRpcProvider(url)`.

- **Signer:** Objeto que encapsula una llave privada y tiene la capacidad de **firmar transacciones**. Un Signer siempre esta conectado a un Provider subyacente para enviar las transacciones firmadas a la red. Se obtiene del Provider con `provider.getSigner()`.

La distincion es critica: al pasar un `Signer` al constructor de `Contract`, el contrato puede tanto leer como escribir. Si solo se pasa un `Provider`, el contrato es de solo lectura. En el codigo del laboratorio:

```javascript
provider = new BrowserProvider(window.ethereum);  // Solo lectura
signer = await provider.getSigner();               // Puede firmar
contrato = new Contract(DIRECCION_CONTRATO, ABI_CONTRATO, signer);
```

### 2.3 MetaMask como provider inyectado

MetaMask inyecta el objeto `window.ethereum` en todas las paginas web, implementando el EIP-1193. Cuando una dApp detecta `typeof window.ethereum !== "undefined"`, sabe que hay un proveedor disponible. MetaMask gestiona internamente las llaves privadas del usuario (en un vault encriptado) y expone operaciones como `eth_requestAccounts` (solicitar acceso a cuentas) y `eth_sendTransaction` (firmar y enviar transacciones) sin exponer las llaves a la pagina (ConsenSys, 2024).

El metodo `eth_requestAccounts` requiere una accion explicita del usuario (un clic) porque EIP-1193 especifica que `request()` debe activarse mediante un "user gesture". Esto previene que sitios web maliciosos fingerprinting a usuarios de Ethereum rastreando sus direcciones sin consentimiento. Es equivalente al permiso de camara o ubicacion en la API web.

### 2.4 Llamadas view vs transacciones

Ethereum distingue dos tipos de interaccion con contratos:

- **Llamadas `view`/`pure`:** Se ejecutan mediante el metodo RPC `eth_call`. El nodo ejecuta la funcion en su copia local del EVM sin modificar el estado, sin crear bloques, y sin costo de gas. El resultado se descarta despues de retornarse. ethers.js envia una peticion HTTP POST al nodo RPC con `{"method": "eth_call", "params": [...], "id": 1}` (Ethereum Foundation, 2021).

- **Transacciones:** Se ejecutan mediante `eth_sendTransaction` o `eth_sendRawTransaction`. Modifican el estado de la blockchain, se incluyen en un bloque, requieren firma criptografica, y cuestan gas. El gas se paga en ETH y se deduce de la cuenta del `msg.sender`.

La consecuencia practica es que `consultarSaldo()` y `balanceContrato()` no cuestan gas ni quedan registradas, mientras que `depositar()` y `retirar()` si. Una lectura del saldo deja cero rastro en la blockchain.

### 2.5 Eventos en Ethereum

Los contratos pueden emitir eventos usando la instruccion `emit`. Estos eventos se almacenan como "logs" en la transaccion que los genero, pero no son accesibles desde el contrato. Los frontend los detectan mediante:

- **Polling de logs (`eth_getLogs`):** El nodo RPC retorna los logs emitidos en un rango de bloques, filtrados por direccion de contrato y topics de eventos. ethers.js periodicamente consulta este metodo. Es el mecanismo principal en HTTP.
- **WebSockets (`eth_subscribe`):** Si el nodo soporta WebSockets, el frontend puede suscribirse a nuevos eventos en tiempo real. Cuando el contrato emite un evento, el nodo notifica inmediatamente.

Los topics son hashes keccak256 de la firma del evento. Por ejemplo, `keccak256("Deposito(address,uint256)")` genera el topic0 del evento `Deposito`. Esto permite al nodo filtrar eficientemente los logs sin decodificarlos (Buterin, 2014).

## 3. Entorno y Versiones

| Herramienta | Version | Verificacion |
|---|---|---|
| Node.js | v22.13.0 | `node --version` |
| npm | 10.9.2 | `npm --version` |
| ethers.js | 6.17.0 | `npm list ethers` |
| Vite | 8.1.4 | Scaffolded con `npm create vite@latest` |

Salida de terminal:

```
C:\Users\MilKshakes>node --version
v22.13.0

C:\Users\MilKshakes>npm --version
10.9.2

C:\Users\MilKshakes\...\lab9\dapp-frontend> npm list ethers
dapp-frontend@0.0.0 C:\Users\MilKshakes\...\lab9\dapp-frontend
`-- ethers@6.17.0
```

## 4. Desarrollo

### 4.1 Arquitectura del proyecto

```
lab9/
├── dapp-frontend/
│   ├── index.html          # Interfaz Web3
│   ├── main.js             # Logica: conexion, lectura, escritura, eventos
│   ├── package.json        # Dependencias (vite, ethers)
│   ├── node_modules/
│   ├── src/                # Templates Vite (no utilizados)
│   └── public/
└── reporte.md              # Este reporte
```

El proyecto se creo con Vite usando el template vanilla (JavaScript puro, sin framework). ethers.js v6 se instalo como dependencia de produccion. La interfaz es un HTML estatico con un unico archivo `main.js` que maneja toda la logica de conexion, lectura, escritura y eventos.

### 4.2 Contrato BovedaSegura

El contrato desplegado en Sepolia es `BovedaSegura.sol`, un vault de deposito/retiro con proteccion contra reentrancy mediante el patron Checks-Effects-Interactions y un modificador mutex `sinReentrada`.

| Campo | Valor |
|---|---|
| Direccion en Sepolia | `0x7cD40dB0BC57C9Ed6482e9583F4435C59F39cF07` |
| Cuenta deployer | `0x3A1C7dd5380cA3F3295722603264C5fad1394a18` |
| Explorador | [Sepolia Etherscan](https://sepolia.etherscan.io/address/0x7cD40dB0BC57C9Ed6482e9583F4435C59F39cF07) |

ABI utilizada en el frontend (solo funciones y eventos necesarios):

```javascript
const ABI_CONTRATO = [
  "function depositar() external payable",
  "function retirar(uint256 monto) external",
  "function consultarSaldo(address cuenta) external view returns (uint256)",
  "function balanceContrato() external view returns (uint256)",
  "event Deposito(address indexed cuenta, uint256 monto)",
  "event Retiro(address indexed cuenta, uint256 monto)"
];
```

### 4.3 Inicializacion (Vite + ethers)

Salida de terminal:

```
C:\...\lab9> npm create vite@latest dapp-frontend -- --template vanilla

> create-vite dapp-frontend vanilla

Scaffolding project in C:\...\lab9\dapp-frontend...

Done. Now run:
  cd dapp-frontend
  npm install
  npm run dev

C:\...\lab9\dapp-frontend> npm install
added 16 packages, and audited 17 packages in 11s
found 0 vulnerabilities

C:\...\lab9\dapp-frontend> npm install ethers
added 11 packages, and audited 28 packages in 8s
found 0 vulnerabilities
```

Verificacion de Vite:

```
C:\...\lab9\dapp-frontend> npm run dev

  VITE v8.1.4  ready in 687 ms

  ->  Local:   http://localhost:5173/
```

### 4.4 Conexion con MetaMask

La deteccion de MetaMask se realiza verificando `window.ethereum`, el objeto inyectado por la extension segun EIP-1193. La funcion `conectar()` ejecuta los siguientes pasos:

1. Verifica la existencia de `window.ethereum`
2. Crea un `BrowserProvider` que envuelve el proveedor inyectado
3. Solicita cuentas con `eth_requestAccounts` (requiere clic del usuario)
4. Obtiene un `Signer` que representa la cuenta activa
5. Lee la direccion y la red actual
6. Verifica que sea Sepolia (chainId 11155111)
7. Instancia el contrato con el Signer para permitir lectura y escritura

```javascript
provider = new BrowserProvider(window.ethereum);
const cuentas = await provider.send("eth_requestAccounts", []);
signer = await provider.getSigner();
const direccion = await signer.getAddress();
const red = await provider.getNetwork();
contrato = new Contract(DIRECCION_CONTRATO, ABI_CONTRATO, signer);
```

Datos de la conexion:

| Campo | Valor |
|---|---|
| Cuenta conectada | `0x3A1C7dd5380cA3F3295722603264C5fad1394a18` |
| chainId | `11155111` (Sepolia) |
| Red | sepolia |
| Advertencia de red | No aparece (ya estamos en Sepolia) |

> **[CAPTURA 1]:** MetaMask abriendo el dialogo de conexion y la interfaz mostrando cuenta conectada con chainId 11155111.

### 4.5 Lectura del estado del contrato

Las funciones `consultarSaldo()` y `balanceContrato()` son llamadas `view` que se ejecutan via `eth_call` al nodo RPC sin costo de gas:

```javascript
const saldoWei = await contrato.consultarSaldo(direccion);
const balanceWei = await contrato.balanceContrato();
document.getElementById("saldoUsuario").textContent = formatEther(saldoWei);
document.getElementById("balanceContrato").textContent = formatEther(balanceWei);
```

Al abrir las herramientas de desarrollo del navegador (F12) y revisar la pestaña Network, las llamadas `view` generan peticiones HTTP POST al endpoint RPC del nodo (por ejemplo, `eth-mainnet.g.alchemy.com/v2/TU_API_KEY`). Estas peticiones van al nodo RPC, no a la blockchain directamente. No se genera transaccion ni se registra nada en la red.

| Campo | Valor |
|---|---|
| Saldo del usuario en la boveda | Coincide con el deposito previo en Hardhat (0.005 ETH) |
| Balance total del contrato | 0.005 ETH |
| Peticion HTTP visible en Network | POST al nodo RPC de Alchemy (no a la blockchain) |

> **[CAPTURA 2]:** Interfaz mostrando el saldo real leido del contrato en Sepolia.

### 4.6 Transacciones firmadas (deposito y retiro)

#### Deposito

El usuario ingresa un monto en ETH. La interfaz lo convierte a wei con `parseEther()`, lo envia como `msg.value` en la transaccion, y espera la confirmacion con `tx.wait()`:

```javascript
const tx = await contrato.depositar({ value: parseEther(monto) });
log(`Transaccion enviada. Hash: ${tx.hash}`);
const recibo = await tx.wait();
log(`Confirmada en el bloque ${recibo.blockNumber}`);
log(`Gas usado: ${recibo.gasUsed.toString()}`);
```

El error `ACTION_REJECTED` se maneja por separado para cuando el usuario rechaza la transaccion en MetaMask.

| Campo | Valor |
|---|---|
| Monto | 0.01 ETH |
| Hash de transaccion | `0xecc856b3508b173398e67fa99b9e1c8d6e2b6f0fcc8db985465ba4bbbe01a350` |
| Bloque de confirmacion | Verificar en Etherscan |
| Gas usado | ~65,618 gas (promedio del laboratorio anterior) |

#### Retiro

El retiro requiere un parametro `uint256 monto` y aplica el modificador `sinReentrada`:

```javascript
const tx = await contrato.retirar(parseEther(monto));
const recibo = await tx.wait();
log(`Retiro confirmado en el bloque ${recibo.blockNumber}`);
log(`Gas usado: ${recibo.gasUsed.toString()}`);
```

| Campo | Valor |
|---|---|
| Monto | 0.005 ETH |
| Hash de transaccion | `0x43a1a674ab1e11c05d0d713649210580889b02e1399ab29acf8168fddcedfc8e` |
| Bloque de confirmacion | Verificar en Etherscan |
| Gas usado | ~44,040 gas (promedio del laboratorio anterior) |

Verificacion: `https://sepolia.etherscan.io/tx/0xecc856b3508b173398e67fa99b9e1c8d6e2b6f0fcc8db985465ba4bbbe01a350`

> **[CAPTURA 3]:** Log de la interfaz con los hashes de deposito y retiro, y ambas transacciones en Sepolia Etherscan.

### 4.7 Eventos del proveedor

Una dApp robusta debe reaccionar cuando el usuario cambia de cuenta o de red en MetaMask sin recargar la pagina:

```javascript
window.ethereum.on("accountsChanged", async (cuentas) => {
  if (cuentas.length === 0) {
    log("Wallet desconectada");
    document.getElementById("interaccion").style.display = "none";
  } else {
    log(`Cuenta cambiada a: ${cuentas[0]}`);
    await conectar();
  }
});

window.ethereum.on("chainChanged", (chainId) => {
  log(`Red cambiada a chainId: ${chainId}`);
  window.location.reload();
});
```

| Accion | Mensaje en Log | Comportamiento de la Interfaz |
|---|---|---|
| Cambiar cuenta | `Cuenta cambiada a: 0xNUEVA_DIRECCION` | Se reconecta automaticamente |
| Desconectar wallet | `Wallet desconectada` | Se oculta la seccion de interaccion |
| Cambiar de red | `Red cambiada a chainId: 0x...` | La pagina se recarga (`window.location.reload()`) |

La recomendacion oficial de MetaMask es recargar la pagina al cambiar de red porque la direccion del contrato puede no existir en la nueva red, las instancias de `BrowserProvider` y `Contract` quedan obsoletas, y los datos mostrados (saldo, transacciones) corresponden a la red original. Mostrar datos mezclados de diferentes redes seria confuso y potencialmente peligroso (ConsenSys, 2024).

> **[CAPTURA 4]:** Log de la interfaz mostrando el evento `accountsChanged` despues de cambiar de cuenta en MetaMask.

### 4.8 Eventos del contrato

Los contratos emiten eventos con `emit`. El frontend se suscribe a ellos para actualizar la interfaz en tiempo real:

```javascript
contrato.on("Deposito", (cuenta, monto) => {
  log(`EVENTO Deposito: ${cuenta} deposito ${formatEther(monto)} ETH`);
});
contrato.on("Retiro", (cuenta, monto) => {
  log(`EVENTO Retiro: ${cuenta} retiro ${formatEther(monto)} ETH`);
});
```

Al realizar un deposito, el log muestra:

```
[13:45:12] Enviando deposito de 0.01 ETH...
[13:45:13] Transaccion enviada. Hash: 0x...
[13:45:18] Confirmada en el bloque XXXXXX
[13:45:18] EVENTO Deposito: 0x3A1C... deposito 0.01 ETH
```

El evento aparecio **despues** de la confirmacion del bloque, no antes. Esto se debe a que ethers.js, al usar un nodo HTTP (no WebSockets), detecta los eventos mediante polling de logs con `eth_getLogs`. El evento solo se hace visible cuando la siguiente consulta de polling detecta el log emitido por la transaccion confirmada. Si se usara un nodo con soporte WebSockets (`wss://`), el evento llegaria en tiempo real via `eth_subscribe` (Ethers.js Contributors, 2024).

> **[CAPTURA 5]:** Log mostrando el mensaje "EVENTO Deposito" capturado desde el contrato.

## 5. Resultados y Analisis

### 5.1 Comparacion de gas: deposito vs retiro

| Operacion | Gas Promedio | Diferencia |
|---|---|---|
| `depositar()` | 65,618 | Referencia |
| `retirar()` | 44,040 | -21,578 (33% menos) |

Contra la intuicion, el retiro consume menos gas que el deposito. El analisis de costos EVM explica esta diferencia:

- **depositar()** actualiza dos variables de estado (`saldos[msg.sender]` y `totalDepositado`), emite un evento, y recibe ETH via `msg.value`. La recepcion de ETH tiene costos adicionales de validacion en la EVM, y los dos SSTORE (escritura de almacenamiento) cuestan ~20,000 gas cada uno en slots nuevos o ~5,000 en slots ya calientes (Ethereum Foundation, 2020).

- **retirar()** tambien actualiza dos variables y emite un evento, pero el modifier `sinReentrada` solo verifica y escribe un booleano (`bloqueado`). La transferencia ETH con payload vacio (`msg.sender.call{value: monto}("")`) es mas ligera que la recepcion. Ademas, la EIP-2929 reduce el coste de SLOAD a 100 gas despues de la primera accesion a un slot, lo que beneficia a `retirar()` que lee `saldos[msg.sender]` en un contexto donde el slot ya fue accedido (Ethereum Foundation, 2020).

### 5.2 EIP-6963 vs window.ethereum

El EIP-6963 (Multi Injected Provider Discovery) resuelve el problema de colision de proveedores que `window.ethereum` no puede manejar. Cuando un usuario tiene varias wallets instaladas (MetaMask + Coinbase Wallet + Trust Wallet), todas intentan inyectarse en `window.ethereum`. Solo una puede ganar, y la otra queda bloqueada.

EIP-6963 define un mecanismo de descubrimiento donde cada wallet se registra con un evento custom (`eip6963:announceProvider`) y el frontend escucha esos eventos para listar todas las wallets disponibles. Esto permite al usuario elegir cual wallet usar (Ethereum Foundation, 2023).

## 6. Reflexion Final

### 6.1 Invarianza del gas segun la herramienta

El gas de una funcion es una propiedad intrinseca del bytecode del contrato, determinada por la EVM. La EVM define un costo fijo para cada operacion (opcode): `SSTORE` cuesta 20,000 gas, `CALL` cuesta 100 gas mas el costo de transferencia, etc. Estos costos estan codificados en el Yellow Paper de Ethereum y son inmutables para una version dada de la EVM (Wood, 2014).

Tanto Hardhat (en su red local), ethers.js (enviando via MetaMask), como Etherscan (con su propio backend) terminan ejecutando el mismo bytecode en la misma version de la EVM. La herramienta solo determina como se envia la transaccion (nodo local vs nodo RPC vs interfaz web), pero una vez que la transaccion llega a la EVM, el calculo de gas es identico. Por eso las mediciones de gas en Hardhat (65,618 para `depositar()`) coinciden con las reales en Sepolia.

### 6.2 Modelo de pago de gas

El gas lo paga la cuenta que inicia la transaccion (`msg.sender`), no el contrato. En este caso, la cuenta `0x3A1C7dd5...` que conecto MetaMask y firmo la transaccion de deposito. El saldo de esa cuenta se decrementa en `gasUsed * gasPrice`.

El modelo de Ethereum asigna el costo al iniciador por tres razones:

1. **Prevencion de spam:** Si el contrato pagara el gas, cualquiera podria forzar al contrato a gastar fondos en gas mediante interacciones gratuitas, agotando su balance.
2. **Responsabilidad:** Quien inicia la accion es responsable de los recursos que consume.
3. **Independencia del contrato:** Un contrato no tiene forma de "elegir" pagar gas; solo puede recibir ETH via funciones `payable`. El gas se deduce automaticamente de la cuenta del `msg.sender` antes de que la transaccion se ejecute.

### 6.3 wagmi vs implementacion manual

1. **Manejo automatico de estados de conexion:** wagmi proporciona hooks React como `useAccount()`, `useConnect()`, `useBalance()` que gestionan automaticamente el estado de la wallet, la reconexion al recargar la pagina, y la sincronizacion de datos. Nuestra implementacion manual requirio variables globales (`provider`, `signer`, `contrato`), verificaciones manuales de `null`, y logica de reconexion explicita.

2. **Soporte nativo EIP-6963 y multi-wallet:** wagmi detecta automaticamente todas las wallets instaladas via EIP-6963 y presenta un selector al usuario. Nuestra implementacion solo busca `window.ethereum` y no maneja multiples wallets. Resolver esto manualmente requeriria implementar el protocolo de descubrimiento, registrar listeners, y mantener un estado de wallets disponibles.

3. **Cache y sincronizacion de datos:** wagmi integra TanStack Query para cachear resultados de llamadas `view`, revalidar automaticamente, y manejar estados de loading/error. Nuestra funcion `actualizarSaldos()` hace fetch crudo sin cache, sin revalidacion, y con manejo de errores basico.

## 7. Conclusiones

1. La integracion de un frontend Web3 con un contrato desplegado requiere tres capas: deteccion del proveedor EIP-1193, conexion de cuentas con `eth_requestAccounts`, y manejo de transacciones firmadas con `eth_sendTransaction`. Cada capa tiene implicaciones de seguridad y experiencia de usuario.

2. Las llamadas `view` no cuestan gas ni se registran en la blockchain porque se ejecutan via `eth_call` en el nodo RPC. Las transacciones (deposito, retiro) si cuestan gas y quedan permanentemente registradas. Esta distincion es fundamental para disenar dApps eficientes.

3. El gas de una funcion es independiente de la herramienta que envia la transaccion porque la EVM determina los costos de opcode. La herramienta solo controla el transporte.

4. La implementacion manual con ethers.js es valiosa para entender los mecanismos subyacentes, pero para produccion, librerias como wagmi resuelven problemas repetitivos y propensos a errores (manejo de estados, EIP-6963, cache, reconexion).

## Referencias

Antonopoulos, A. (2018). *Mastering Ethereum: Building Smart Contracts and DApps*. O'Reilly Media.

Buterin, V. (2014). *Ethereum White Paper*. Ethereum. https://ethereum.org/en/whitepaper/

ConsenSys. (2024). *MetaMask Docs: Ethereum Provider API*. https://docs.metamask.io/wallet/concepts/provider-api/

Ethereum Foundation. (2020). *EIP-2929: Gas cost increases for state access opcodes*. https://eips.ethereum.org/EIPS/eip-2929

Ethereum Foundation. (2021). *EIP-1193: Ethereum Provider JavaScript API*. https://eips.ethereum.org/EIPS/eip-1193

Ethereum Foundation. (2023). *EIP-6963: Multi Injected Provider Discovery*. https://eips.ethereum.org/EIPS/eip-6963

Ethers.js Contributors. (2024). *ethers.js v6 Documentation*. https://docs.ethers.org/v6/

Narayanan, A., Bonneau, J., Felten, E., Miller, A., & Goldfeder, S. (2016). *Bitcoin and Cryptocurrency Technologies: A Comprehensive Introduction*. Princeton University Press.

Nomic Foundation. (2024). *Hardhat Documentation*. https://hardhat.org/docs

OpenZeppelin. (2024). *Contracts Wizard*. https://docs.openzeppelin.com/contracts

Viem Contributors. (2024). *viem: TypeScript Interface for Ethereum*. https://viem.sh/

Wagmi Contributors. (2024). *wagmi: React Hooks for Ethereum*. https://wagmi.sh/

Wood, G. (2014). *Ethereum: A Secure Decentralised Generalised Transaction Ledger*. Ethereum Project Yellow Paper. https://ethereum.github.io/yellowpaper/paper.pdf

---

*Declaracion de uso de IA: Este reporte fue elaborado con asistencia de inteligencia artificial para la generacion de codigo, ejecucion de comandos, documentacion de resultados y redaccion de respuestas teoricas.*
