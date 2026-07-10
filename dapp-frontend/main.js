import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";

// Dirección del contrato desplegado en Sepolia (del laboratorio anterior)
const DIRECCION_CONTRATO = "0x7cD40dB0BC57C9Ed6482e9583F4435C59F39cF07";

// ABI mínima: solo las funciones que usa el frontend
const ABI_CONTRATO = [
  "function depositar() external payable",
  "function retirar(uint256 monto) external",
  "function consultarSaldo(address cuenta) external view returns (uint256)",
  "function balanceContrato() external view returns (uint256)",
  "event Deposito(address indexed cuenta, uint256 monto)",
  "event Retiro(address indexed cuenta, uint256 monto)"
];

const CHAIN_ID_SEPOLIA = "0xaa36a7"; // 11155111 en hexadecimal

let provider = null;
let signer = null;
let contrato = null;

function log(mensaje) {
  const logDiv = document.getElementById("log");
  const p = document.createElement("p");
  p.textContent = `[${new Date().toLocaleTimeString()}] ${mensaje}`;
  logDiv.prepend(p);
}

// Detecta si MetaMask está disponible mediante el proveedor inyectado EIP-1193
function detectarMetaMask() {
  if (typeof window.ethereum !== "undefined") {
    log("MetaMask detectado");
    return true;
  }
  document.getElementById("estadoConexion").textContent =
    "MetaMask no está instalado";
  log("MetaMask NO detectado — instálalo desde metamask.io");
  return false;
}

// Conecta la wallet solicitando acceso a las cuentas
async function conectar() {
  if (!detectarMetaMask()) return;

  try {
    // Solicita permiso al usuario para acceder a sus cuentas
    provider = new BrowserProvider(window.ethereum);
    const cuentas = await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();

    const direccion = await signer.getAddress();
    const red = await provider.getNetwork();

    document.getElementById("estadoConexion").textContent = "Conectado";
    document.getElementById("cuentaActual").textContent =
      `Cuenta: ${direccion}`;
    document.getElementById("redActual").textContent =
      `Red: ${red.name} (chainId: ${red.chainId})`;

    log(`Conectado como ${direccion}`);

    // Verifica que estamos en Sepolia
    if (red.chainId !== 11155111n) {
      log("ADVERTENCIA: no estás en Sepolia. Cambia de red en MetaMask.");
    }

    // Instancia el contrato con el signer (permite lectura y escritura)
    contrato = new Contract(DIRECCION_CONTRATO, ABI_CONTRATO, signer);

    // Escucha el evento Deposito emitido por el contrato (Parte 6)
    contrato.on("Deposito", (cuenta, monto) => {
      log(`EVENTO Deposito: ${cuenta} depositó ${formatEther(monto)} ETH`);
    });

    // Escucha el evento Retiro (Parte 6)
    contrato.on("Retiro", (cuenta, monto) => {
      log(`EVENTO Retiro: ${cuenta} retiró ${formatEther(monto)} ETH`);
    });

    document.getElementById("interaccion").style.display = "block";
    await actualizarSaldos();

  } catch (error) {
    log(`Error al conectar: ${error.message}`);
  }
}

document.getElementById("btnConectar").addEventListener("click", conectar);

// Parte 3 — Lee el estado del contrato
async function actualizarSaldos() {
  if (!contrato || !signer) {
    log("Conecta primero tu wallet");
    return;
  }

  try {
    const direccion = await signer.getAddress();

    // Llamada de solo lectura — no cuesta gas
    const saldoWei = await contrato.consultarSaldo(direccion);
    const balanceWei = await contrato.balanceContrato();

    // Convierte de wei a ETH para mostrar
    document.getElementById("saldoUsuario").textContent =
      formatEther(saldoWei);
    document.getElementById("balanceContrato").textContent =
      formatEther(balanceWei);

    log(`Saldo actualizado: ${formatEther(saldoWei)} ETH`);
  } catch (error) {
    log(`Error al leer saldos: ${error.message}`);
  }
}

document.getElementById("btnActualizar")
  .addEventListener("click", actualizarSaldos);

// Parte 4.1 — Depósito
async function depositar() {
  if (!contrato) {
    log("Conecta primero tu wallet");
    return;
  }

  const monto = document.getElementById("montoDeposito").value;
  if (!monto || parseFloat(monto) <= 0) {
    log("Ingresa un monto válido");
    return;
  }

  try {
    log(`Enviando depósito de ${monto} ETH...`);

    // Envía la transacción — MetaMask pedirá confirmación y firma
    const tx = await contrato.depositar({ value: parseEther(monto) });

    log(`Transacción enviada. Hash: ${tx.hash}`);
    log("Esperando confirmación en la red...");

    // Espera a que la transacción sea minada
    const recibo = await tx.wait();

    log(`Confirmada en el bloque ${recibo.blockNumber}`);
    log(`Gas usado: ${recibo.gasUsed.toString()}`);

    await actualizarSaldos();
  } catch (error) {
    // Maneja el rechazo del usuario y otros errores
    if (error.code === "ACTION_REJECTED") {
      log("Transacción rechazada por el usuario");
    } else {
      log(`Error en el depósito: ${error.message}`);
    }
  }
}

document.getElementById("btnDepositar").addEventListener("click", depositar);

// Parte 4.2 — Retiro
async function retirar() {
  if (!contrato) {
    log("Conecta primero tu wallet");
    return;
  }

  const monto = document.getElementById("montoRetiro").value;
  if (!monto || parseFloat(monto) <= 0) {
    log("Ingresa un monto válido");
    return;
  }

  try {
    log(`Solicitando retiro de ${monto} ETH...`);
    const tx = await contrato.retirar(parseEther(monto));
    log(`Transacción enviada. Hash: ${tx.hash}`);

    const recibo = await tx.wait();
    log(`Retiro confirmado en el bloque ${recibo.blockNumber}`);
    log(`Gas usado: ${recibo.gasUsed.toString()}`);

    await actualizarSaldos();
  } catch (error) {
    if (error.code === "ACTION_REJECTED") {
      log("Transacción rechazada por el usuario");
    } else {
      log(`Error en el retiro: ${error.message}`);
    }
  }
}

document.getElementById("btnRetirar").addEventListener("click", retirar);

// Parte 5 — Maneja eventos del proveedor EIP-1193
if (typeof window.ethereum !== "undefined") {

  // Se dispara cuando el usuario cambia de cuenta en MetaMask
  window.ethereum.on("accountsChanged", async (cuentas) => {
    if (cuentas.length === 0) {
      log("Wallet desconectada");
      document.getElementById("interaccion").style.display = "none";
      document.getElementById("estadoConexion").textContent = "No conectado";
    } else {
      log(`Cuenta cambiada a: ${cuentas[0]}`);
      // Reconecta con la nueva cuenta
      await conectar();
    }
  });

  // Se dispara cuando el usuario cambia de red en MetaMask
  window.ethereum.on("chainChanged", (chainId) => {
    log(`Red cambiada a chainId: ${chainId}`);
    // La recomendación oficial es recargar la página al cambiar de red
    window.location.reload();
  });
}
