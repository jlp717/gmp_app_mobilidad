# ADR 0001: Riverpod para estado de aplicación

## Decisión

Riverpod 2.5 es único framework para estado nuevo. `ChangeNotifier` queda congelado: no se crean ficheros ni APIs nuevas sobre él. `setState` queda limitado a estado efímero de UI.

## Contexto y alternativas

Código actual es híbrido: pantallas Riverpod conviven con `ChangeNotifier` legado. Riverpod ya está declarado y usado en features, con providers que separan lectura de estado y dependencias. Descartados Bloc por introducir segundo patrón y provider clásico por solapar Riverpod.

## Consecuencias

Features nuevas usan providers/notifiers Riverpod. Migraciones son incrementales, una feature por PR, sin cambiar comportamiento observable.
