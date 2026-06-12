#!/home/gmp/gmp-powerbi/bin/python
"""
Power BI Data Export - GMP
===========================
Exporta datos del IBM i a CSVs accesibles por Power BI Service
Ejecutar con: /home/gmp/gmp-powerbi/bin/python powerbi_export.py
"""

import pyodbc
import csv
import os
import sys
from datetime import datetime

# CONFIGURACIÓN
CSV_DIR = "/var/www/powerbi-data"
ODBC_DSN = os.getenv("ODBC_DSN", "GMP")
ODBC_UID = os.getenv("ODBC_UID") or os.getenv("DB2_UID")
ODBC_PWD = os.getenv("ODBC_PASSWORD") or os.getenv("ODBC_PWD") or os.getenv("DB2_PASSWORD")
if not ODBC_UID or not ODBC_PWD:
    raise RuntimeError("Missing DB2 credentials. Set ODBC_UID and ODBC_PASSWORD in the environment.")
DSN = f"DSN={ODBC_DSN};UID={ODBC_UID};PWD={ODBC_PWD}"

# Tablas/vistas a exportar
EXPORTS = [
    {
        "name": "ventas",
        "sql": "SELECT * FROM JAVIER.V_FACT_VENTAS",
        "filename": "ventas.csv"
    },
    {
        "name": "medios",
        "sql": "SELECT * FROM JAVIER.V_MEDIOS_POWERBI",
        "filename": "medios.csv"
    },
    {
        "name": "articulos",
        "sql": "SELECT * FROM JAVIER.V_DIM_ARTICULO",
        "filename": "dim_articulo.csv"
    },
    {
        "name": "vendedores",
        "sql": "SELECT * FROM JAVIER.V_DIM_VENDEDOR",
        "filename": "dim_vendedor.csv"
    },
    {
        "name": "clientes",
        "sql": "SELECT * FROM JAVIER.V_DIM_CLIENTE_EXT",
        "filename": "dim_cliente.csv"
    }
]


def export_to_csv(cursor, sql, filepath, name):
    """Ejecuta SQL y escribe CSV"""
    print(f"  Exportando {name}...", end=" ")
    try:
        cursor.execute(sql)
        rows = cursor.fetchall()
        if not rows:
            print(f"0 filas (vacio)")
            return 0
        
        columns = [desc[0] for desc in cursor.description]
        
        with open(filepath, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f, delimiter=',', quotechar='"', 
                              quoting=csv.QUOTE_NONNUMERIC)
            writer.writerow(columns)
            for row in rows:
                cleaned = []
                for val in row:
                    if val is None:
                        cleaned.append(None)
                    elif isinstance(val, datetime):
                        cleaned.append(val.strftime('%Y-%m-%d %H:%M:%S'))
                    elif isinstance(val, (int, float)):
                        cleaned.append(val)
                    else:
                        cleaned.append(str(val).strip())
                writer.writerow(cleaned)
        
        print(f"{len(rows)} filas → {os.path.basename(filepath)}")
        return len(rows)
    except Exception as e:
        print(f"ERROR: {e}")
        return 0


def main():
    print(f"=== PowerBI Export - {datetime.now().strftime('%Y-%m-%d %H:%M')} ===")
    
    os.makedirs(CSV_DIR, exist_ok=True)
    
    try:
        conn = pyodbc.connect(DSN)
        cursor = conn.cursor()
        print("✓ Conexión IBM i OK")
    except Exception as e:
        print(f"✗ Error conectando a IBM i: {e}")
        sys.exit(1)
    
    total = 0
    for exp in EXPORTS:
        filepath = os.path.join(CSV_DIR, exp["filename"])
        count = export_to_csv(cursor, exp["sql"], filepath, exp["name"])
        total += count
    
    cursor.close()
    conn.close()
    
    print(f"\n✓ Exportación completada: {total} filas totales en {len(EXPORTS)} archivos")
    print(f"  Directorio: {CSV_DIR}")


if __name__ == "__main__":
    main()
