# Secrets de firma y distribución Android

## Secrets de GitHub

| Secret | Requerido | Uso |
|---|---:|---|
| `ANDROID_KEYSTORE_BASE64` | Sí | Keystore Android codificado en Base64. |
| `ANDROID_KEYSTORE_PASSWORD` | Sí | Contraseña del keystore. |
| `ANDROID_KEY_ALIAS` | Sí | Alias de la clave de subida. |
| `ANDROID_KEY_PASSWORD` | Sí | Contraseña de la clave. |
| `TELEGRAM_BOT_TOKEN` | Sí | Token del bot que notifica releases. |
| `TELEGRAM_CHAT_ID` | Sí | Chat o canal receptor. |
| `FIREBASE_CLI_TOKEN` | Sí para distribuir | Autenticación de Fastlane con Firebase App Distribution. Sin este secret, CI conserva quality, build y artifacts, pero omite distribución Firebase. |
| `FIREBASE_APP_ID` | Sí para distribuir | App ID Android de Firebase. Sin este secret, CI omite distribución Firebase. |
| `PLAY_SERVICE_ACCOUNT_JSON` | No | JSON completo de service account para lane alternativa `internal` de Google Play. |

## Alta o actualización con GitHub CLI

Ejecutar desde un equipo autorizado. No pasar secretos mediante `--body`: los argumentos pueden quedar visibles en historial o procesos. Para valores breves, usar el prompt interactivo:

```bash
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS
gh secret set ANDROID_KEY_PASSWORD
gh secret set TELEGRAM_BOT_TOKEN
gh secret set TELEGRAM_CHAT_ID
gh secret set FIREBASE_CLI_TOKEN
gh secret set FIREBASE_APP_ID
```

Para secretos almacenados en archivos seguros, usar stdin:

```bash
gh secret set ANDROID_KEYSTORE_BASE64 < "<RUTA_SEGURA_AL_BASE64>"
gh secret set PLAY_SERVICE_ACCOUNT_JSON < "<RUTA_SEGURA_AL_JSON>"
```

También puede codificarse el keystore sin guardar el Base64 ni exponerlo en argumentos:

```bash
base64 -w 0 "<RUTA_SEGURA_AL_KEYSTORE>" | gh secret set ANDROID_KEYSTORE_BASE64
```

## Procedimiento 1: rotación rutinaria de credenciales y tokens

Aplicar a tokens renovables y valores de distribución; no cambia la clave de firma Android.

1. Crear el reemplazo desde el proveedor correspondiente.
2. Actualizar el secret mediante prompt interactivo o stdin y comprobar su presencia con `gh secret list`; GitHub no permite leer el valor.
3. Ejecutar `workflow_dispatch` y confirmar quality, build, artifacts y distribución/notificación aplicables.
4. Revocar el valor anterior y auditar uso inesperado:
   - **GitHub Secrets**: `gh secret delete <NOMBRE_ANTERIOR>` cuando corresponda, crear el reemplazo y revisar logs de Actions.
   - **Firebase CLI**: revocar el token anterior desde la cuenta autorizada, generar otro y actualizar `FIREBASE_CLI_TOKEN` sin pasarlo por argumentos de shell.
   - **Telegram**: revocar el token con BotFather, actualizar `TELEGRAM_BOT_TOKEN` y comprobar el chat receptor.
   - **Service account de Google Play**: si `PLAY_SERVICE_ACCOUNT_JSON` está comprometido, deshabilitar o eliminar la key en Google Cloud Console → IAM → Service Accounts → Keys, crear reemplazo solo si sigue siendo necesario y auditar logs de IAM. Como mejora futura, preferir Workload Identity Federation sin claves persistentes.

## Procedimiento 2: compromiso de la clave de firma (keystore)

> **Advertencia:** un APK firmado con una clave nueva no puede actualizar instalaciones existentes distribuidas por Firebase App Distribution. Esos dispositivos requieren desinstalación y reinstalación, o una migración de firma compatible planificada antes del cambio.

1. Registrar el fingerprint actual antes de revocar o reemplazar nada:

   ```bash
   keytool -list -v -keystore "<RUTA_SEGURA_AL_KEYSTORE_ACTUAL>" -alias "<ALIAS_ACTUAL>"
   ```

2. Generar el nuevo keystore en un equipo autorizado. `keytool` pedirá contraseñas de forma interactiva; no incluirlas en argumentos ni scripts:

   ```bash
   keytool -genkeypair -v -keystore "<RUTA_SEGURA>/upload-keystore.jks" -alias "<NUEVO_ALIAS>" -keyalg RSA -keysize 2048 -validity 10000
   ```

3. Verificar y registrar el fingerprint nuevo antes de distribuir:

   ```bash
   keytool -list -v -keystore "<RUTA_SEGURA>/upload-keystore.jks" -alias "<NUEVO_ALIAS>"
   ```

4. Actualizar los cuatro secrets `ANDROID_*` mediante prompt o stdin y ejecutar un build de verificación.
5. Para Firebase App Distribution, coordinar reinstalación de dispositivos o completar la migración de firma antes de publicar el APK nuevo.
6. Para Google Play, usar Google Play App Signing: solicitar reset de la upload key. La clave de firma gestionada por Google no cambia y los usuarios existentes mantienen la ruta de actualización.
7. Revocar y destruir de forma segura copias comprometidas solo después de validar la sustitución y el plan de recuperación.

Mantener copia cifrada y probada del keystore fuera del repositorio. No guardar secretos en issues, artifacts, logs ni documentación.
