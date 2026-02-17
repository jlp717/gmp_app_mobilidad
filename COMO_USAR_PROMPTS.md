# 📌 CÓMO USAR LOS PROMPTS MAESTRO

## 📁 Archivos Generados

1. **MASTER_OPTIMIZATION_PROMPT.md** (941 líneas)
   - Documento completo y profesional
   - Para referencia, análisis profundo, documentación
   - Incluye todo: contexto, problemas, soluciones, testing, métricas

2. **CLAUDE_MASTER_PROMPT_COPYPASTE.txt**
   - Versión simplificada, sin markdown complicado
   - **ESTA es la que copias y pegas a Claude**
   - Más fácil de leer en Chat de OpenAI/Claude

---

## 🚀 CÓMO USARLO CON CLAUDE

### OPCIÓN 1: Chat Simple (Recomendado para pequeños módulos)

```
1. Abre https://claude.ai (o tu interface de Claude)
2. Copia el contenido de CLAUDE_MASTER_PROMPT_COPYPASTE.txt
3. Pega en nuevo chat
4. Espera respuesta de Claude
5. Luego dile:

"Perfecto. Ahora implementa el PASO 1 (Validación Input). 
Necesito:
- Archivo backend/utils/validators.js completo
- Tests unitarios (rechaza SQL injection, acepta datos válidos)
- Documentación en comentarios
Adelante 🚀"

6. Claude implementará el código
7. Crea/actualiza archivos con el código que genera
8. Cuando termines PASO 1, pide PASO 2, etc.
```

### OPCIÓN 2: Con Adjuntos (Mejor para contexto completo)

```
1. En Claude, adjunta todo tu código:
   - Carpeta lib/
   - Carpeta backend/
   - pubspec.yaml
   - package.json
   - Etc.

2. En el mensaje dí:

"Adjunto todo mi código GMP App.

Aquí está el MASTER_OPTIMIZATION_PROMPT para optimizar.
[Copia contenido de CLAUDE_MASTER_PROMPT_COPYPASTE.txt]

Empecemos por PASO 1 (Validación Input).
Código production-ready, tests exhaustivos. 🚀"

3. Claude verá todo tu código + el prompt
4. Implementará cambios específicos a tu codebase
5. Resultado: código muy optimizado
```

### OPCIÓN 3: Modular (Recomendado - Más control)

```
Si quieres hacer módulo por módulo con máximo control:

# Para PASO 1: Validación Input
"Según MASTER_OPTIMIZATION_PROMPT, PASO 1 es validación input.
Quiero que:
1. Crees backend/utils/validators.js con Joi schemas
2. Incluyas middleware validate()
3. Agregues tests que rechacen SQL injection
4. Todo production-ready

Adjunto el MASTER_OPTIMIZATION_PROMPT abajo:
[Copia el contenido]"

# Para PASO 2: Servicios de Datos
"PASO 2 es servicios centralizados.
Quiero que refactorices la lógica duplicada de 
commissions.js, objectives.js y repartidor.js
en una clase VendorDataService centralizada.

[Copia el contenido del prompt]"

# Y así sucesivamente...
```

---

## ⚡ FLUJO RECOMENDADO

### Día 1: Setup & Validación
- [ ] PASO 1 completo (validators.js + tests)
- [ ] PASO 2 completo (vendorDataService.js + tests)

### Día 2-3: Performance Brutal
- [ ] PASO 3 completo (query optimization + índices DB)
- [ ] PASO 4 completo (caché Redis sistemático)

### Día 4: UX
- [ ] PASO 5 completo (paginación + lazy loading)

### Día 5: Refactoring
- [ ] PASO 6 completo (refactorizar rutas backend)
- [ ] PASO 7 completo (refactorizar providers Flutter)

### Día 6: Finalización
- [ ] PASO 8 completo (testing exhaustivo)
- [ ] PASO 9 completo (documentación + rollback)

**Total: ~6 días de trabajo intenso con Claude**

---

## 💬 EJEMPLOS DE PROMPTS POR PASO

### PARA PASO 1: Validación Input

```
Según el MASTER_OPTIMIZATION_PROMPT, necesito implementar PASO 1: Validación Input.

Crea backend/utils/validators.js con:

1. Joi schemas para:
   - dashboardMetrics
   - commissionsSummary
   - objectivesSummary
   - repartidorCollections
   - etc.

2. Middleware validate() que:
   - Valida query params
   - Rechaza SQL injection (ej: "1'; DROP TABLE--")
   - Rechaza tipos incorrectos
   - Stripea unknown fields

3. Funciones helper:
   - parseVendorCodes(str) → [1, 2, 3]
   - buildVendorFilter(codes) → {placeholders, values}
   - sanitizeClientId(str) → 'ABC123'
   - validateDateRange(...)

4. Tests completos que verifiquen:
   - Rechaza: "1'; DROP TABLE--", "5 OR 1=1", etc.
   - Rechaza: year=1900, month=13, etc.
   - Acepta: '5,10,15', year=2026, month=2, etc.
   - Stripea campos extra

Código production-ready, error handling exhaustivo, comentarios claros.

ADJUNTO EL PROMPT MAESTRO:
[COPIA DE CLAUDE_MASTER_PROMPT_COPYPASTE.txt]
```

### PARA PASO 3: Query Optimization

```
Según MASTER_OPTIMIZATION_PROMPT, PASO 3 es Query Optimization.

Necesito que:

1. Identifiques queries secuenciales en:
   - routes/dashboard.js (metrics)
   - routes/commissions.js (summary)
   - routes/objectives.js (summary)
   - routes/repartidor.js (collections)

2. Las conviertas a Promise.all():
   - ❌ await query1; await query2; await query3;
   - ✅ const [r1, r2, r3] = await Promise.all([query1, query2, query3]);

3. Elimines subconsultas anidadas (repartidor.js líneas 303-346):
   - ❌ COALESCE((SELECT...FROM CAC CAC2 WHERE...))
   - ✅ LEFT JOIN con índices

4. Crees SQL para índices DB2:
   - IDX_OPP_REPARTIDOR_PERIODO
   - IDX_CPC_CLIENTE
   - IDX_LACLAE_VENDOR_YEAR

5. Incluyas tests de performance:
   - Medir latencia antes/después
   - Verificar que Promise.all es más rápido
   - Benchmark de queries

Espero ver 50x+ mejora en latencia.

ADJUNTO MASTER PROMPT:
[COPIA]
```

---

## 🎯 QUÉ ESPERAR DE CLAUDE

✅ **RECIBIRÁS:**
- Código completo, production-ready
- Tests unitarios + integration tests
- Documentación clara en comentarios
- Before/after benchmarks
- Explicación de cambios

❌ **NO RECIBIRÁS:**
- Pseudo-código ("implement like this...")
- Sugerencias vagas
- Tests mínimos
- Omisión de edge cases

---

## 📋 CHECKLIST ANTES DE USAR

- [ ] Tienes acceso a Claude (claude.ai o API)
- [ ] Has leído el MASTER_OPTIMIZATION_PROMPT.md
- [ ] Tienes copias de seguridad de tu código (git branch)
- [ ] Entiendes qué es cada PASO
- [ ] Sabes cómo crear archivos en tu workspace
- [ ] Puedes ejecutar tests (`npm test`)

---

## 🔄 DESPUÉS DE CADA PASO

1. **Implementa el código** que Claude genera
2. **Corre los tests**: `npm test`
3. **Verifica el before/after**:
   ```bash
   # Mide latencia antes
   npm run test:performance -- --baseline
   
   # Mide latencia después
   npm run test:performance -- --compare baseline.json
   ```
4. **Si falla algo**: Pregunta a Claude qué pasó
5. **Si funciona**: Continúa con siguiente PASO

---

## 🚨 ERRORES COMUNES

### ❌ "Claude no entiende mi código"
**Solución:** Adjunta TODO el contexto (archivos relevantes) + el prompt maestro

### ❌ "El código que genera no funciona"
**Solución:** Pídele que incluya error handling y tests para validar

### ❌ "No implementa tests"
**Solución:** En el prompt dile explícitamente "Necesito tests exhaustivos"

### ❌ "Falta documentación"
**Solución:** Pídele "Incluye comentarios explicando la lógica" en cada función

---

## 📞 SI TIENES DUDAS

Si algo no queda claro en los pasos, pregunta a Claude directamente:

```
"No entiendo por qué hacemos [X]. ¿Puedes explicar mejor?"
```

Claude puede:
- Explicar la lógica
- Mostrar ejemplos
- Resolver dudas técnicas
- Proponer alternativas

---

## 🎓 APRENDER DEL PROCESO

Mientras Claude implementa, APRENDERÁS:
- Cómo hacer queries eficientes
- Patrones de caching y validación
- Testing profesional
- Arquitectura sin código duplicado
- Seguridad en APIs

Usa esto como **master class de optimización** 🚀

---

**EMPEZAR AHORA:**

1. Copia contenido de `CLAUDE_MASTER_PROMPT_COPYPASTE.txt`
2. Abre https://claude.ai (o tu herramienta)
3. Pega el contenido
4. Dile: "Implementa PASO 1 - Validación Input"
5. Espera código production-ready
6. Repite para PASOS 2-9

**¡Buena suerte! 🚀**
