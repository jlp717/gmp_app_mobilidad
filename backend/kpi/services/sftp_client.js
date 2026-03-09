// sftp_client.js: Cliente SFTP con reintentos, timeouts y descarga segura de CSVs
'use strict';

const SftpClient = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../../middleware/logger');

const SFTP_CONFIG = {
  host: process.env.KPI_SFTP_HOST,
  port: parseInt(process.env.KPI_SFTP_PORT || '990', 10),
  username: process.env.KPI_SFTP_USER,
  password: process.env.KPI_SFTP_PASS,
  readyTimeout: parseInt(process.env.KPI_SFTP_TIMEOUT || '20000', 10),
  retries: 3,
  retry_factor: 2,
  retry_minTimeout: 2000,
};

const REMOTE_FOLDER = process.env.KPI_SFTP_FOLDER || '/IN';

const EXPECTED_FILES = [
  'Desviacion_Ventas.csv',
  'Clientes_ConCuotaSinCompra.csv',
  'Desviacion_Referenciacion.csv',
  'Mensaje_Promociones.csv',
  'Altas_Clientes.csv',
  'Mensajes_Clientes.csv',
  'Medios_Clientes.csv',
];

/**
 * Descarga todos los CSVs esperados del SFTP a un directorio local temporal.
 * Retorna la ruta del directorio y metadatos por archivo.
 * @param {string} [localDir] - Ruta local de destino (si se omite, usa tmp)
 * @returns {Promise<{dir: string, files: Array<{name: string, localPath: string, size: number, hash: string}>}>}
 */
async function fetchCSVsFromSFTP(localDir) {
  const downloadDir = localDir || path.join(
    process.env.KPI_TEMP_DIR || path.join(__dirname, '..', 'tmp'),
    `sftp_${Date.now()}`
  );

  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const sftp = new SftpClient();
  const downloadedFiles = [];
  let attempt = 0;
  const maxRetries = SFTP_CONFIG.retries;

  while (attempt < maxRetries) {
    try {
      attempt++;
      logger.info(`[kpi:sftp] Conectando a ${SFTP_CONFIG.host}:${SFTP_CONFIG.port} (intento ${attempt}/${maxRetries})`);

      await sftp.connect({
        host: SFTP_CONFIG.host,
        port: SFTP_CONFIG.port,
        username: SFTP_CONFIG.username,
        password: SFTP_CONFIG.password,
        readyTimeout: SFTP_CONFIG.readyTimeout,
      });

      logger.info(`[kpi:sftp] Conectado. Listando ${REMOTE_FOLDER}...`);
      const remoteFiles = await sftp.list(REMOTE_FOLDER);
      const remoteNames = new Set(remoteFiles.map((f) => f.name));

      for (const expectedFile of EXPECTED_FILES) {
        if (!remoteNames.has(expectedFile)) {
          logger.warn(`[kpi:sftp] Archivo no encontrado: ${expectedFile} — se omite`);
          continue;
        }

        const remotePath = `${REMOTE_FOLDER}/${expectedFile}`;
        const localPath = path.join(downloadDir, expectedFile);

        logger.info(`[kpi:sftp] Descargando ${expectedFile}...`);
        await sftp.fastGet(remotePath, localPath);

        const stats = fs.statSync(localPath);
        const hash = computeFileHash(localPath);

        downloadedFiles.push({
          name: expectedFile,
          localPath,
          size: stats.size,
          hash,
        });

        logger.info(`[kpi:sftp] ${expectedFile} descargado (${stats.size} bytes, SHA256: ${hash.substring(0, 16)}...)`);
      }

      await sftp.end();
      break; // Éxito, salir del bucle de reintentos

    } catch (err) {
      logger.error(`[kpi:sftp] Error en intento ${attempt}: ${err.message}`);
      try { await sftp.end(); } catch (_) { /* ignore */ }

      if (attempt >= maxRetries) {
        throw new Error(`SFTP falló tras ${maxRetries} intentos: ${err.message}`);
      }

      const delay = SFTP_CONFIG.retry_minTimeout * Math.pow(SFTP_CONFIG.retry_factor, attempt - 1);
      logger.info(`[kpi:sftp] Reintentando en ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  if (downloadedFiles.length === 0) {
    throw new Error('No se descargó ningún archivo CSV del SFTP');
  }

  logger.info(`[kpi:sftp] ${downloadedFiles.length}/${EXPECTED_FILES.length} archivos descargados en ${downloadDir}`);
  return { dir: downloadDir, files: downloadedFiles };
}

/**
 * Carga CSVs desde un directorio local (para testing o modo offline).
 */
function loadLocalCSVs(localDir) {
  const files = [];
  for (const expectedFile of EXPECTED_FILES) {
    const localPath = path.join(localDir, expectedFile);
    if (!fs.existsSync(localPath)) {
      logger.warn(`[kpi:local] Archivo no encontrado: ${localPath} — se omite`);
      continue;
    }
    const stats = fs.statSync(localPath);
    const hash = computeFileHash(localPath);
    files.push({ name: expectedFile, localPath, size: stats.size, hash });
  }
  return { dir: localDir, files };
}

function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

module.exports = {
  fetchCSVsFromSFTP,
  loadLocalCSVs,
  EXPECTED_FILES,
};
