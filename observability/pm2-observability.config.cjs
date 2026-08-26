/**
 * PM2 apps del stack de observabilidad self-hosted en 192.168.1.230.
 * Binarios nativos (sin Docker). Descarga previa manual, ver README.md.
 * Arranque: pm2 start observability/pm2-observability.config.cjs
 * NOTA: instalar este stack en produccion requiere aprobacion de Javier
 *       (production-approval-gate + palabra adelante).
 */
module.exports = {
  apps: [
    {
      name: 'gmp-prometheus',
      script: '/opt/gmp-observability/bin/prometheus',
      args: '--config.file=/opt/gmp-observability/prometheus.yml --storage.tsdb.path=/opt/gmp-observability/prometheus-data --storage.tsdb.retention.time=30d --web.listen-address=127.0.0.1:9090',
      cwd: '/opt/gmp-observability',
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'gmp-loki',
      script: '/opt/gmp-observability/bin/loki',
      args: '-config.file=/opt/gmp-observability/loki-config.yaml',
      cwd: '/opt/gmp-observability',
      max_memory_restart: '500M',
    },
    {
      name: 'gmp-tempo',
      script: '/opt/gmp-observability/bin/tempo',
      args: '-config.file=/opt/gmp-observability/tempo.yaml',
      cwd: '/opt/gmp-observability',
      max_memory_restart: '500M',
    },
    {
      name: 'gmp-grafana',
      script: '/opt/gmp-observability/bin/grafana',
      args: 'server --homepath=/opt/gmp-observability/grafana --config=/opt/gmp-observability/grafana.ini',
      cwd: '/opt/gmp-observability',
      max_memory_restart: '500M',
      env: {
        GF_SERVER_HTTP_PORT: '3001',
        GF_SERVER_HTTP_ADDR: '192.168.1.230',
        GF_SECURITY_ADMIN_USER: 'admin',
        // Cambiar la clave inicial en el primer arranque; nunca en ficheros del repo.
        GF_PATHS_PROVISIONING: '/opt/gmp-observability/grafana/provisioning',
      },
    },
  ],
};
