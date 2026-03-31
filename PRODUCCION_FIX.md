# 🔧 FIX LOGIN ERROR - ARQUITECTURA PRODUCCIÓN

## ✅ PROBLEMA RESUELTO

### Error Original
La app intentaba conectar a una IP local (`192.168.1.238`) en lugar del dominio de producción.

### Solución Implementada
**ARQUITECTURA PROFESIONAL PARA USO EN CUALQUIER LUGAR:**

1. **PRODUCCIÓN (Default)**: Siempre usa `https://api.mari-pepa.com`
   - Accesible desde CUALQUIER LUGAR con internet
   - Rutas de reparto, oficinas, casas de clientes, etc.
   - Cloudflare Named Tunnel - dominio fijo permanente

2. **DESARROLLO (Solo debugging)**: Detecta servidores locales
   - Solo se usa en oficina durante desarrollo
   - NUNCA se usa en producción/release

---

## 📁 ARCHIVOS MODIFICADOS

### 1. `lib/core/services/network_service.dart`
**CAMBIOS:**
- ✅ Producción ahora es el DEFAULT para release builds
- ✅ Servidores locales SOLO para desarrollo (debug)
- ✅ Método `forceProductionServer()` para forzar reconexión
- ✅ Health checks con timeout de 3 segundos
- ✅ Diagnósticos de red mejorados

### 2. `lib/core/api/api_config.dart`
**CAMBIOS:**
- ✅ Default: `ApiEnvironment.production`
- ✅ Siempre retorna `https://api.mari-pepa.com/api` en producción
- ✅ Endpoints documentados
- ✅ Timeouts aumentados para producción (60s receive)

### 3. `lib/core/api/api_client.dart`
**CAMBIOS:**
- ✅ Manejo de errores MEJORADO
- ✅ Mensajes CLAROS para el usuario:
  - "No hay conexión a internet. Verifica WiFi o datos móviles."
  - "Credenciales inválidas. Verifica usuario y PIN."
  - "Error del servidor (500). Inténtalo más tarde."
- ✅ Detección de SocketException para errores de red
- ✅ Detección de errores SSL/certificado

### 4. `lib/core/providers/auth_provider.dart`
**CAMBIOS:**
- ✅ Validación de input (username/password)
- ✅ Validación de respuesta y token
- ✅ Manejo de errores en SecureStorage (non-blocking)
- ✅ Mensajes de error descriptivos

### 5. `lib/core/services/secure_storage.dart`
**CAMBIOS:**
- ✅ Try/catch en TODAS las operaciones
- ✅ Logging para debugging
- ✅ Fallback graceful si falla

---

## 🚀 CÓMO FUNCIONA AHORA

### Para Comerciales (Producción)
```
Tablet (cualquier lugar) 
  → Internet (WiFi/4G) 
  → Cloudflare Tunnel 
  → https://api.mari-pepa.com 
  → Backend (oficina)
```

**NO importa dónde esté el comercial:**
- ✅ Ruta de reparto (4G/5G)
- ✅ Casa de cliente (WiFi)
- ✅ Oficina (WiFi)
- ✅ Cualquier lugar con internet

### Para Desarrollo (Solo en oficina)
```
Tablet (oficina) 
  → Misma red WiFi 
  → http://192.168.1.52:3334/api
```

---

## 📋 COMANDOS PARA BUILD

```bash
# 1. Ir al directorio del proyecto
cd C:\Users\Javier\Desktop\Repositorios\gmp_app_mobilidad

# 2. Limpiar build anterior
flutter clean

# 3. Obtener dependencias
flutter pub get

# 4. Construir APK de release (PRODUCCIÓN)
flutter build apk --release

# 5. Instalar en tablet
flutter install
```

---

## 🧪 TESTING

### Test 1: Login desde producción
1. **Tablet en WiFi de oficina** → Login debe funcionar
2. **Tablet en datos móviles (4G)** → Login debe funcionar
3. **Tablet en casa de cliente** → Login debe funcionar

### Test 2: Mensajes de error claros
| Escenario | Mensaje Esperado |
|-----------|------------------|
| Sin internet | "No hay conexión a internet. Verifica tu WiFi o datos móviles." |
| Usuario vacío | "Usuario y contraseña requeridos" |
| PIN incorrecto | "Credenciales inválidas. Verifica usuario y PIN." |
| Servidor caído | "Error del servidor (500). Inténtalo más tarde." |

### Test 3: Conexión desde cualquier lugar
```bash
# Desde la tablet, abrir Chrome y probar:
https://api.mari-pepa.com/api/health

# Debe devolver:
{"status":"ok","database":"connected",...}
```

---

## 🔍 DIAGNÓSTICOS

### Ver logs de red (debug mode)
```bash
flutter logs | grep -i "network\|api\|auth"
```

### Verificar servidor de producción
```bash
curl https://api.mari-pepa.com/api/health
```

### Forzar reconexión (desde la app)
En desarrollo, se puede forzar producción con:
```dart
await NetworkService.forceProductionServer();
```

---

## ✅ CHECKLIST FINAL

- [x] Producción usa SIEMPRE `https://api.mari-pepa.com`
- [x] LAN solo se usa en desarrollo (debug)
- [x] Mensajes de error claros para el usuario
- [x] Manejo de errores en SecureStorage
- [x] Validación de input en login
- [x] Timeouts apropiados para producción
- [x] Health checks con timeout de 3s
- [x] Diagnósticos de red disponibles

---

## 🆘 SOPORTE

### Si el login SIGUE fallando:

1. **Verificar conexión a internet en la tablet:**
   - Abrir Chrome → https://www.google.com
   - Si no carga → Problema de WiFi/datos

2. **Verificar servidor de producción:**
   - Abrir Chrome → https://api.mari-pepa.com/api/health
   - Si no carga → Problema del servidor (contactar admin)

3. **Ver logs del backend:**
   ```bash
   # En el servidor
   pm2 logs gmp-api --lines 50
   ```

4. **Reinstalar app:**
   ```bash
   flutter clean
   flutter build apk --release
   flutter install
   ```

---

## 📞 CONTACTO

Para issues de producción:
- **Servidor:** pm2 status / pm2 logs gmp-api
- **Dominio:** https://api.mari-pepa.com
- **Cloudflare Tunnel:** pm2 logs mari-pepa-tunnel

---

*Fecha: 2026-03-31*  
*Versión: 3.3.1+36*  
*Estado: ✅ LISTO PARA PRODUCCIÓN*
