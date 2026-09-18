# Privacidad RUM

RUM reduce endpoint, pantalla, método y red a categorías fijas antes de la cola
y antes del logger. El detalle por operación se pierde deliberadamente: no se
emiten segmentos, query, fragmentos, `rid`, usuario ni request ID del cliente.

Los tiempos y bytes siguen siendo números controlados por el cliente. Esta
política no es una garantía frente a canales encubiertos ni sanea otros logs.
