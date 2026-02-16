# 🎯 ÍNDICE DE PROMPTS & RECURSOS (v3.0)

## 📁 ARCHIVOS (4 archivos clave)

### 1. 📘 MASTER_OPTIMIZATION_PROMPT.md (~970 líneas)
**Qué es:** Documento maestro completo con estado actual, análisis, PASO 8 y 9 detallados

**Estado:** v3.0 - Actualizado con PASOS 1-7 completados + dual-codebase alert

**Para qué:**
- ✅ Referencia técnica profunda
- ✅ Documentación del estado actual (qué está hecho, qué falta)
- ✅ Detalle de PASO 8 (Testing) y PASO 9 (Migración)
- ✅ Ubicaciones exactas de SQL injection en legacy

---

### 2. 📋 CLAUDE_MASTER_PROMPT_COPYPASTE.txt (~530 líneas)
**Qué es:** Versión v3.0 para COPIAR Y PEGAR a Claude

**Estado:** v3.0 - Refleja estado real del proyecto

**Para qué:**
- ✅ Copiar completo a Claude
- ✅ Claude sabe qué está hecho (PASOS 1-7) y qué falta (8-9)
- ✅ Incluye instrucciones para parche seguridad legacy

**Cómo:**
```
1. Copia TODO el contenido de CLAUDE_MASTER_PROMPT_COPYPASTE.txt
2. Pega en tu chat con Claude
3. Pide: "Implementa PASO 8" o "Implementa PASO 9"
4. O: "Aplica parche de seguridad en legacy JS"
```

---

### 3. 📖 COMO_USAR_PROMPTS.md
**Qué es:** Guía de cómo usar los prompts, ejemplos paso a paso, checklist

**Para qué lo uses:**
- ✅ Entender cómo trabajar con Claude módulo por módulo
- ✅ Ver ejemplos de prompts específicos para cada PASO
- ✅ Flujo recomendado de 6 días
- ✅ Solucionar problemas comunes

**Cómo lo usas:**
- Léelo para entender la metodología
- Usa los ejemplos de prompts cuando hables con Claude
- Sigue el checklist para cada PASO

---

## 🚀 INICIO RÁPIDO (5 minutos)

### Paso 1: Preparación
```bash
# 1. Abre CLAUDE_MASTER_PROMPT_COPYPASTE.txt
# 2. Cópialo enterito (Ctrl+A, Ctrl+C)
# 3. Abre https://claude.ai
# 4. Pega en un nuevo chat
```

### Paso 2: Empezar PASO 1
```
Escribe en el chat:

"Perfecto, tengo todo el contexto. 

Ahora necesito que implementes PASO 1: Validación Input

Específicamente:
- Crea backend/utils/validators.js
- Joi schemas para todos los endpoints
- Función validate() que rechace SQL injection
- Tests exhaustivos (unit tests)
- Production-ready

Adelante 🚀"
```

### Paso 3: Recibe código
Claude generará:
- Code files (`backend/utils/validators.js`)
- Test files (`test/validators.test.js`)
- Documentación del cambio
- Explanations del por qué

---

## 📊 CONTENIDO DE CADA ARCHIVO

### MASTER_OPTIMIZATION_PROMPT.md - SECCIONES

```
1. Encabezado ejecutivo para Claude
2. Contexto del proyecto (stack, problemas, objetivos)
3. Instrucciones ejecutivas para IA
4. Testing & Validation requerido
5. Orden crítico de implementación (PASOS 1-9)
6. Implementación detallada por módulo (9 módulos)
7. Métricas finales (Antes vs Después)
8. Notas críticas & edge cases
9. Checklist final de validación
10. Referencias técnicas
```

### CLAUDE_MASTER_PROMPT_COPYPASTE.txt - LO MÁS IMPORTANTE

```
- Encabezado claro: "PARA CLAUDE"
- Contexto resumido (problemas, objetivos)
- Instrucciones ejecutivas
- Testing requirements
- PASOS 1-9 (qué, por qué, tiempo)
- Métricas esperadas
- Red flags
- Checklist final
```

### COMO_USAR_PROMPTS.md - OPERACIONAL

```
- Cómo usar con Claude (3 opciones)
- Flujo recomendado (6 días)
- Ejemplos de prompts por PASO
- Qué esperar
- Errores comunes
- Checklist antes de usar
```

---

## 💡 ESTRATEGIA RECOMENDADA

### OPCIÓN A: Modular (Recomendado - máximo control)

Haz un PASO a la vez:

```
DÍA 1:
1. PASO 1 (validators.js) con Claude
2. Integra código en tu repo
3. Corre tests

DÍA 2:
1. PASO 2 (vendorDataservice.js) con Claude
2. Integra código
3. Corre tests

... y así sucesivamente
```

**Ventaja:** Control total, entiendes cada cambio profundamente  
**Tiempo:** 6-7 días

### OPCIÓN B: Rápido (Todo a Claude de una)

```
1. Copia CLAUDE_MASTER_PROMPT_COPYPASTE.txt completo
2. Pégalo a Claude con archivos adjuntos
3. Dile: "Implementa TODOS los PASOS 1-9"
4. Claude genera todo el código

Claude hará PASOS 1-9 en un chat continuo.
```

**Ventaja:** Rápido, no necesitas orchestrar  
**Tiempo:** 2-3 días  
**Desventaja:** Menos control, más cambios a la vez

### OPCIÓN C: Híbrida (Recomendada)

```
Semana 1:
- PASOS 1-3 (validación + servicios + queries) = CRITICIDAD MÁXIMA
- Haz en paralelo en 2-3 chats diferentes con Claude

Semana 2:
- PASOS 4-7 (caché + paginación + refactoring) = IMPLEMENTACIÓN
- Haz secuencialmente pero rápido

Semana 3:
- PASOS 8-9 (testing + docs) = VALIDACIÓN
```

**Ventaja:** Balance entre velocidad y control  
**Tiempo:** 10-12 días

---

## 🎯 QUÉ ESPERAR POR PASO

### PASO 1: Validación Input
- **Archivos nuevos:** `backend/utils/validators.js`
- **Tests:** `test/unit/validators.test.js`
- **Líneas de código:** 300-400
- **Tiempo con Claude:** 1-2 horas
- **Impacto:** 🔒 Seguridad crítica (cierra SQL injection)

### PASO 2: Servicios Centralizados
- **Archivos nuevos:** `backend/services/vendorDataService.js`
- **Tests:** `test/unit/vendorDataService.test.js`
- **Líneas de código:** 400-600
- **Tiempo con Claude:** 2-3 horas
- **Impacto:** 🔄 Elimina 1500+ líneas duplicadas

### PASO 3: Query Optimization
- **Archivos modificados:** `routes/*.js`, `config/db.js`
- **SQL scripts:** Índices DB2
- **Tests:** Performance benchmarks
- **Tiempo con Claude:** 3-4 horas
- **Impacto:** ⚡ -70% latencia (15s → 2-3s)

### PASO 4: Caché Redis
- **Archivos nuevos:** `backend/services/queryCache.js`
- **Tests:** Cache hit/miss validation
- **Tiempo con Claude:** 2-3 horas
- **Impacto:** 💾 Cache hit rate >70%

### PASO 5: Paginación
- **Backend:** Parámetros `page/limit` en todos endpoints
- **Frontend:** Scroll lazy loading
- **Tests:** Pagination flow E2E
- **Tiempo con Claude:** 2-3 horas
- **Impacto:** 📱 UX 10x mejor, -90% parsing

### PASO 6-7: Refactoring
- **Backend:** Reescribir 3 archivos (2000+ líneas)
- **Frontend:** Actualizar providers
- **Tests:** Integration tests E2E
- **Tiempo con Claude:** 4-5 horas
- **Impacto:** 📦 Código limpio, mantenible

### PASO 8: Testing Exhaustivo
- **Tests:** Unit + Integration + Performance + Security
- **Coverage:** >70%
- **Tiempo con Claude:** 3-4 horas
- **Impacto:** ✅ Confianza en código

### PASO 9: Documentación
- **Archivos:** API docs, migration scripts, rollback
- **Tiempo con Claude:** 1-2 horas
- **Impacto:** 📚 Transferencia de conocimiento

---

## 📈 RESULTADOS ESPERADOS

### Antes (Línea Base)
```
Latencia endpoints: 10-20 segundos
Código duplicado: 1500+ líneas
SQL injection vulnerabilities: 5+
Paginación: ninguna
Cache hit rate: 0%
Test coverage: <5%
```

### Después (Target Final)
```
Latencia endpoints: <500ms (30-40x más rápido)
Código duplicado: 0 líneas
SQL injection vulnerabilities: 0
Paginación: 100% implementada
Cache hit rate: >70%
Test coverage: >70%
```

---

## 🚨 CRÍTICO ANTES DE EMPEZAR

### Requerimientos
- [ ] Tienes Git (para hacer branches)
- [ ] Acceso a Claude (claude.ai o API)
- [ ] Backend con Node.js + npm instalado
- [ ] Frontend con Flutter instalado
- [ ] Puedes ejecutar tests (`npm test`)
- [ ] Tienes BD2 accesible

### Backup
- [ ] ✅ Haz un branch nuevo: `git checkout -b optimization/master`
- [ ] ✅ Commit inicial de estado actual
- [ ] ✅ Backup de .env, keys, credenciales

### Haz pruebas de baseline
```bash
# Mide latencia ACTUAL
npm run test:performance -- --baseline

# Corre tests ACTUALES
npm test

# Builds ACTUALES
npm run build
```

---

## ❓ PREGUNTAS FRECUENTES

**V: ¿Cuánto tiempo toma todo?**  
R: 5-6 días si haces modular (un PASO por día). 2-3 días si das todo a Claude de una.

**V: ¿Es difícil integrar el código de Claude?**  
R: No, Claude da código listo para pegar. Solo copias, das `npm install` (si hay deps nuevas), y testeas.

**V: ¿Qué pasa si algo falla?**  
R: Tienes git branch, haces rollback con `git reset --hard`. O pregunta a Claude qué pasó.

**V: ¿Claude rompe features existentes?**  
R: Si le dices "no rompas features existentes", Claude lo respeta y hace tests E2E.

**V: ¿Necesito entender todo el código?**  
R: No completamente, pero sí debes leer el MASTER_OPTIMIZATION_PROMPT.md para entender la visión.

**V: ¿Puedo hacer solo algunos PASOS?**  
R: Sí, pero el orden importa. Validación (PASO 1) es requisito para Seguridad. Queries (PASO 3) es requisito para Performance.

---

## 📞 SOPORTE

Si algo no funciona:

1. **Lee el error** que genera Claude o npm
2. **Pregunta a Claude:** "Por qué esto falla? [error]"
3. **Verifica assumptions:** ¿Es la versión de Node correcta? ¿Redis running?
4. **Rollback si necesario:** `git reset --hard`

---

## 🎓 BONUS: Aprender en el Proceso

Mientras haces esto, APRENDERÁS:
- ✅ Query optimization en DB2
- ✅ Caching strategies (Redis)
- ✅ Security best practices
- ✅ Testing profesional (Jest, Supertest)
- ✅ Refactoring sin romper features
- ✅ Performance engineering
- ✅ Flutter optimization

**Esto es básicamente un master class de 6 días.**

---

## 🏁 SUMMARY DE ARCHIVOS

| Archivo | Líneas | Usar Para | Acción |
|---------|--------|-----------|--------|
| MASTER_OPTIMIZATION_PROMPT.md | 941 | Referencia técnica, documentación | Leer completamente |
| CLAUDE_MASTER_PROMPT_COPYPASTE.txt | 450 | Copiar&pegar a Claude | Copiar código completo |
| COMO_USAR_PROMPTS.md | 400 | Guía operacional, ejemplos | Leer para metodología |
| README_RESULTADOS.md | TBD | Documentar resultados finales | Crear después de cada PASO |

---

## 🚀 EMPEZAR AHORA MISMO

### En 5 minutos:
```bash
# 1. Abre CLAUDE_MASTER_PROMPT_COPYPASTE.txt
cat CLAUDE_MASTER_PROMPT_COPYPASTE.txt

# 2. Cópialo
# Ctrl+A, Ctrl+C (selecciona todo, copia)

# 3. Abre Claude
# https://claude.ai

# 4. Nuevo chat, pega contenido

# 5. Pide PASO 1
# "Implementa PASO 1: Validación Input"

# 6. Recibes código production-ready
```

---

**Creado:** Feb 14, 2026  
**Status:** ✅ LISTO PARA LANZAR  
**Próximo paso:** Copia y pega a Claude 🚀

¡BUENA SUERTE! 💪
