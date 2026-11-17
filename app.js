if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });

  navigator.serviceWorker.register('./sw.js')
    .then((registro) => {
      console.log('[SW] Registrado con scope:', registro.scope);
    })
    .catch((error) => {
      console.error('[SW] Error al registrar:', error);
    });
}

function actualizarIndicadorRed() {
  const badge = document.getElementById('badge-red');

  if (navigator.onLine) {
    badge.textContent = 'En Línea';
    badge.className = 'badge online';
  } else {
    badge.textContent = 'Sin Conexión';
    badge.className = 'badge offline';
  }
}

function renderizarColaOutbox() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      const lista = document.getElementById('lista-outbox');
      lista.innerHTML = '';

      registros.forEach((registro) => {
        const hora = new Date(registro.fechaCreacion).toLocaleTimeString();
        const li = document.createElement('li');
        li.className = registro.estado;
        li.textContent = `${registro.titulo} | ${registro.estado} | ${hora}`;
        lista.appendChild(li);
      });
    });
}

function procesarEnvioReporte(datosFormulario) {
  const endpoint = 'https://jsonplaceholder.typicode.com/posts';

  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              });
          }
        });
    })
    .then(() => {
      return renderizarColaOutbox();
    });
}

function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

document.getElementById('form-incidencia').addEventListener('submit', (e) => {
  e.preventDefault();

  const datosFormulario = {
    titulo: document.getElementById('titulo').value,
    descripcion: document.getElementById('descripcion').value
  };

  procesarEnvioReporte(datosFormulario)
    .catch((error) => {
      console.error('[Outbox] Error al procesar el reporte:', error);
    });

  e.target.reset();
});

document.getElementById('btn-purgar').addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      const promesasDeBorrado = sincronizados.map((item) => eliminarRegistro(item.id));
      return Promise.all(promesasDeBorrado);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error al purgar registros:', error);
    });
});

window.addEventListener('online', () => {
  actualizarIndicadorRed();

  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

actualizarIndicadorRed();
renderizarColaOutbox();
