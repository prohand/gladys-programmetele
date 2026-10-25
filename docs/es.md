# Programme Télé (guía de TV francesa)

Esta integración muestra en Gladys la programación de las cadenas de la TNT
francesa: lo que se emite **ahora**, lo que viene **a continuación** y lo que se
emite **esta noche**. Requiere **Gladys 5.3.0 o posterior**.

## Qué obtiene

Un dispositivo por cada cadena seleccionada (por ejemplo «Programme TV TF1»), con
3 sensores de texto:

- **En cours** (ahora) — el programa en emisión, con su horario
  (`JT 20h (20:00 - 20:45)`);
- **À suivre** (a continuación) — el siguiente programa (`20:45 · Petits plats en équilibre`);
- **Ce soir** (esta noche) — el programa en emisión a las 21:10, hora de París
  (`21:10 · Koh-Lanta`).

Los horarios se muestran siempre en la zona horaria de París.

## Configuración

1. Abra la pestaña **Configuración** de la integración.
2. Marque las **cadenas** que desea seguir (30 cadenas de la TNT disponibles).
3. Guarde: los dispositivos aparecen en la pestaña **Descubrir**, listos para añadirse.

Los sensores se actualizan cada minuto. La guía completa (8 días) se descarga
como máximo cada 6 horas.

## Widget del panel

Añada el widget **Guía de TV** a un panel (**Editar**, luego **Nuevo widget**;
Gladys 5.1 o posterior). Ajustes:

- **Mostrar**: _Ahora_ (con el tiempo restante) o _Esta noche (21:10)_;
- **Cadenas**: hasta 8 cadenas; déjelo vacío para usar las cadenas de la
  configuración de la integración.

Pulse una fila para leer el resumen del programa. El widget se actualiza solo
cuando termina un programa.

## Escenas

**Disparador «Empieza un programa de TV»** — inicia una escena cuando empieza un
programa. Filtros (vacío = cualquiera):

- **Cadenas**: una o varias cadenas;
- **Título exacto**: p. ej. `Koh-Lanta` (título exacto, mayúsculas incluidas;
  «contiene» no es posible).

Variables para las acciones siguientes: cadena, título, subtítulo, categoría,
hora de inicio, hora de fin, duración (min). Ejemplo: «Cuando empiece Koh-Lanta
en TF1, enciende la tele y envíame un mensaje».

El disparador funciona con las 30 cadenas, incluso las que no están marcadas en
la configuración. Un programa se detecta a los pocos segundos de empezar. Tras un
corte, los programas que empezaron en los últimos 5 minutos siguen activando la
escena; los anteriores no.

**Acción «Obtener la programación de una cadena»** — devuelve a la escena lo que
se emite ahora, a continuación y esta noche (texto completo, solo el título,
hora). Ejemplo: enviar cada noche a las 20:00 «Esta noche en France 2: …».

## Acciones

- **Probar la guía de TV** — descarga la guía en ese momento y muestra lo que se
  emite en la primera cadena seleccionada. Si la descarga falla, lo indica, y
  también si se sigue usando la guía anterior.

## Fuente de datos

La guía procede del feed XMLTV gratuito de [xmltvfr.fr](https://xmltvfr.fr)
(archivo TNT). Sin cuenta ni clave de API. La integración necesita acceso a
Internet.

## Solución de problemas

- **«Aucun programme»**: la fuente no tiene datos para esta cadena a esa hora.
- **Estado «Desconectado»**: el mensaje indica qué ocurre.
  - _No se puede descargar la guía de TV_: todavía no se ha podido descargar
    ninguna guía; se vuelve a intentar cada 2 minutos.
  - _La guía de TV está desactualizada_: la fuente lleva mucho tiempo sin
    responder y a la guía antigua en memoria ya no le queda nada por emitir.
  - _Gladys ha rechazado los dispositivos de las cadenas_ o _No se pueden enviar
    los programas a Gladys_: la guía está ahí, pero Gladys la ha rechazado; la
    integración lo vuelve a intentar sola cada minuto.
- Si una descarga falla mientras hay una guía anterior en memoria, se sigue
  usando esta (cubre varios días); se vuelve a intentar 15 minutos después. El
  botón **Probar la guía de TV** también lo indica.
- Consulte los registros de la integración en la pestaña **Registros** de la
  integración (o con `docker logs` en el host) con `LOG_LEVEL=debug` para ver todos los detalles.
