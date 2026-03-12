// sftp_client.js: Cliente FTPS (FTP sobre TLS implícito, puerto 990) para CSVs Glacius
'use strict';

const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../../middleware/logger');

const FTP_CONFIG = {
  host: process.env.KPI_SFTP_HOST,
  port: parseInt(process.env.KPI_SFTP_PORT || '990', 10),
  user: process.env.KPI_SFTP_USER,
  password: process.env.KPI_SFTP_PASS,
  secure: 'implicit', // Puerto 990 = FTPS implícito (TLS desde el inicio)
  timeout: parseInt(process.env.KPI_SFTP_TIMEOUT || '30000', 10),
};

const REMOTE_FOLDER = process.env.KPI_SFTP_FOLDER || '/IN';
const MAX_RETRIES = 3;

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
 * Descarga todos los CSVs esperados del FTPS a un directorio local temporal.
 */
async function fetchCSVsFromSFTP(localDir) {
  const downloadDir = localDir || path.join(
    process.env.KPI_TEMP_DIR || path.join(__dirname, '..', 'tmp'),
    `sftp_${Date.now()}`
  );

  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const downloadedFiles = [];
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    const client = new ftp.Client(FTP_CONFIG.timeout);
    // client.ftp.verbose = true; // Uncomment for debug

    try {
      attempt++;
      logger.info(`[kpi:ftps] Conectando a ${FTP_CONFIG.host}:${FTP_CONFIG.port} (intento ${attempt}/${MAX_RETRIES})`);

      await client.access({
        host: FTP_CONFIG.host,
        port: FTP_CONFIG.port,
        user: FTP_CONFIG.user,
        password: FTP_CONFIG.password,
        secure: FTP_CONFIG.secure,
        secureOptions: { rejectUnauthorized: false }, // Accept self-signed certs
      });

      logger.info(`[kpi:ftps] Conectado. Listando ${REMOTE_FOLDER}...`);
      await client.cd(REMOTE_FOLDER);
      const remoteFiles = await client.list();
      const remoteNames = new Set(remoteFiles.map((f) => f.name));

      logger.info(`[kpi:ftps] ${remoteFiles.length} archivos encontrados en ${REMOTE_FOLDER}`);

      for (const expectedFile of EXPECTED_FILES) {
        if (!remoteNames.has(expectedFile)) {
          logger.warn(`[kpi:ftps] Archivo no encontrado: ${expectedFile} — se omite`);
          continue;
        }

        const localPath = path.join(downloadDir, expectedFile);

        logger.info(`[kpi:ftps] Descargando ${expectedFile}...`);
        await client.downloadTo(localPath, expectedFile);

        const stats = fs.statSync(localPath);
        const hash = computeFileHash(localPath);

        downloadedFiles.push({
          name: expectedFile,
          localPath,
          size: stats.size,
          hash,
        });

        logger.info(`[kpi:ftps] ${expectedFile} descargado (${stats.size} bytes, SHA256: ${hash.substring(0, 16)}...)`);
      }

      client.close();
      break; // Success

    } catch (err) {
      logger.error(`[kpi:ftps] Error en intento ${attempt}: ${err.message}`);
      client.close();

      if (attempt >= MAX_RETRIES) {
        throw new Error(`FTPS falló tras ${MAX_RETRIES} intentos: ${err.message}`);
      }

      const delay = 2000 * Math.pow(2, attempt - 1);
      logger.info(`[kpi:ftps] Reintentando en ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  if (downloadedFiles.length === 0) {
    throw new Error('No se descargó ningún archivo CSV del FTPS');
  }

  logger.info(`[kpi:ftps] ${downloadedFiles.length}/${EXPECTED_FILES.length} archivos descargados en ${downloadDir}`);
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
