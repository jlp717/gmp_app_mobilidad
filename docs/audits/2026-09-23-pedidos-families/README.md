# Pedidos comercial — Familias (2026-09-23)

## Evidencia

| Artefacto | Contenido |
|---|---|
| `families-db-evidence.json` | QSYS2 + `DSEDAC.FAM` (115) + ART activos (96) + impulso `003` |
| `api-contract-families.json` | Contrato live `getFamilies` / `getFamiliesDetailed` (96 + flags) |
| Jest | `backend/__tests__/pedidos_families_contract.test.js` (2 PASS) |
| Flutter | `test/features/pedidos/domain/product_family_filter_test.dart` (3 PASS) |

## Impulso (DB real)

| Campo | Valor |
|---|---|
| `CODIGOFAMILIA` | `003` |
| `DESCRIPCIONFAMILIA` | `NESTLE IMPULSO` |
| Arts activos | 191 (DSEDAC.ART y JAVIER.TEST_ART) |

## Recomendación aplicada

1. Chip **Todas** limpia familia + Nestlé.
2. Pin comercial (solo si existen en API): Impulso → Congelado → Marisco → Carne → TopFresh → Nestlé Rest. → Panamar.
3. Chip **Nestlé** (prefamily search) se mantiene.
4. Resto de familias DB con nombre real, scroll horizontal del layout existente.
5. No se inventan códigos; aliases solo renombran códigos ya presentes.
