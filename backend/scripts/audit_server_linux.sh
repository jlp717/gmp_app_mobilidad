#!/bin/bash
# ============================================================
#    AUDITORÍA COMPLETA DEL SERVIDOR - GMP MOVILIDAD
#    Para Ubuntu Server/Desktop
# ============================================================

echo "============================================================"
echo "   AUDITORÍA COMPLETA DEL SERVIDOR - GMP MOVILIDAD"
echo "   Fecha: $(date)"
echo "   Hostname: $(hostname)"
echo "============================================================"
echo ""

echo "[1/10] SISTEMA OPERATIVO"
echo "--------------------------------------------------------"
lsb_release -a 2>/dev/null || cat /etc/os-release
echo ""

echo "[2/10] TIPO DE INSTALACIÓN (Server vs Desktop)"
echo "--------------------------------------------------------"
echo "Default target: $(systemctl get-default)"
echo "Desktop session: ${XDG_CURRENT_DESKTOP:-'No detectado'}"
echo "Paquetes de escritorio instalados:"
dpkg -l 2>/dev/null | grep -E 'ubuntu-desktop|gnome-shell|kde-plasma|xfce4|mate-desktop' | awk '{print "  - " $2}' || echo "  (ninguno detectado)"
echo ""

echo "[3/10] NODE.JS"
echo "--------------------------------------------------------"
if command -v node &> /dev/null; then
    echo "[OK] Node.js instalado: $(node -v)"
else
    echo "[X] Node.js NO INSTALADO"
    echo "    Para instalar: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
fi
echo ""

echo "[4/10] NPM"
echo "--------------------------------------------------------"
if command -v npm &> /dev/null; then
    echo "[OK] NPM instalado: $(npm -v)"
else
    echo "[X] NPM NO INSTALADO"
fi
echo ""

echo "[5/10] GIT"
echo "--------------------------------------------------------"
if command -v git &> /dev/null; then
    echo "[OK] Git instalado: $(git --version)"
else
    echo "[!] Git NO instalado. Para instalar: sudo apt install git"
fi
echo ""

echo "[6/10] CONECTIVIDAD INTERNET"
echo "--------------------------------------------------------"
if ping -c 1 google.com &> /dev/null; then
    echo "[OK] Internet conectado"
else
    echo "[X] SIN INTERNET - Cloudflare NO funcionará"
fi
echo ""

echo "[7/10] PUERTO 3000 (Backend API)"
echo "--------------------------------------------------------"
if ss -tlnp 2>/dev/null | grep -q ":3000"; then
    echo "[!] PUERTO 3000 YA EN USO:"
    ss -tlnp | grep ":3000"
else
    echo "[OK] Puerto 3000 disponible"
fi
echo ""

echo "[8/10] DRIVER ODBC"
echo "--------------------------------------------------------"
if command -v isql &> /dev/null; then
    echo "[OK] unixODBC instalado"
    odbcinst -q -d 2>/dev/null | head -5 || echo "  No hay drivers configurados"
else
    echo "[!] unixODBC no detectado"
    echo "    Para instalar: sudo apt install unixodbc unixodbc-dev"
fi
echo ""

echo "[9/10] FIREWALL (UFW)"
echo "--------------------------------------------------------"
if command -v ufw &> /dev/null; then
    sudo ufw status 2>/dev/null || echo "  (requiere sudo para ver estado)"
else
    echo "[!] UFW no instalado"
fi
echo ""

echo "[10/10] PM2 (Process Manager)"
echo "--------------------------------------------------------"
if command -v pm2 &> /dev/null; then
    echo "[OK] PM2 instalado: $(pm2 -v)"
else
    echo "[!] PM2 no instalado"
    echo "    Para instalar: sudo npm install pm2 -g"
fi
echo ""

echo "============================================================"
echo "   INFORMACIÓN ADICIONAL PARA ESCRITORIO REMOTO"
echo "============================================================"
echo ""
echo "Servicios de escritorio remoto:"
systemctl is-active xrdp 2>/dev/null && echo "  - XRDP: activo" || echo "  - XRDP: no activo/instalado"
systemctl is-active vncserver 2>/dev/null && echo "  - VNC: activo" || echo "  - VNC: no activo/instalado"
echo ""

echo "============================================================"
echo "   FIN DE AUDITORÍA"
echo "============================================================"
