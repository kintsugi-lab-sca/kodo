---
name: kodo-capture
description: Captura una idea al inbox global de kodo (~/.kodo/inbox.md) sin salir de lo que estás haciendo. Úsala cuando el operador suelte una idea, un pendiente o una nota que no pertenece a la tarea en curso y no quiere perder el hilo. Shellea el comando de captura de kodo y nunca escribe el fichero del inbox por su cuenta.
argument-hint: "<texto de la idea>"
allowed-tools: Bash(kodo capture *)
---

# Kodo Capture

Manda el texto del operador al inbox global de kodo sin abandonar la tarea en curso. Esta skill hace **una sola cosa**: ejecutar el comando de captura de kodo con el texto tal cual llegó. El triage viene después, en otro sitio.

## Invocación canónica

<!-- kodo:capture:invocacion -->
```bash
kodo capture --origin skill -- "<texto>"
```

Sustituye `<texto>` por lo que el operador haya tecleado y escápalo al pasarlo a la tool `Bash`. Esa línea es el contrato de esta skill: está congelada por un test del repo y no se edita a mano.

## Reglas

1. **El texto va como un solo argumento.** Si contiene comillas, escápalas al construir la llamada a la tool. Nunca lo partas en varios argumentos: el comando espera exactamente uno.
2. **Los flags van siempre antes del separador `--`.** Si aparecieran después, el parser los leería como parte del texto capturado. El separador es load-bearing: sin él, un texto que empieza por guion aborta la captura.
3. **El texto se pasa verbatim.** No lo reescribas, no lo resumas, no lo traduzcas, no le corrijas la ortografía y no le añadas contexto de la sesión que el operador no haya tecleado (ficheros abiertos, contenido del repo, transcripción de la conversación). Lo que el operador escribió es lo que se guarda.
4. **No derives ni inventes el proyecto.** El comando hereda el directorio de trabajo de la sesión y kodo calcula el tag por su cuenta. Ninguna decisión tuya entra en ese campo.
5. **Si no hay texto, pregunta al operador.** No ejecutes el comando con el argumento vacío.
6. **Si el comando termina con código distinto de 0, reporta su stderr verbatim y detente.** Nunca reintentes escribiendo el fichero del inbox a mano: kodo tiene un único writer y ese writer es el comando.
7. **Esta skill solo captura.** Para listar, enrutar o descartar está `kodo inbox`. No ofrezcas triage aquí.

## Confirmación

Cuando el comando termina bien, imprime su propia confirmación con el identificador de la captura y el comando de enrutado sugerido. Muéstrasela al operador tal cual y no la reformatees.
