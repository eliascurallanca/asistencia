// =============================================================================
// LÓGICA DE APLICACIÓN FRONTEND - SISTEMA DE ASISTENCIA DE PRACTICANTES
// =============================================================================

// 1. CONFIGURACIÓN E INITIALIZACIÓN
var URL_SCRIPT = 'https://script.google.com/macros/s/AKfycby1b3Ev4Q8-YxvRQa8u0Qi_-MI9kU8S0MTlCb3wIG8Fe6vGHfTp93XBHKc1j_P5oUUt/exec';
var INST_LAT   = -33.4361926; // Coordenadas oficiales San Antonio 580
var INST_LNG   = -70.6488452;
var INST_RADIO = 150;        // Radio en metros

// Estado global de la aplicación
var params = new URLSearchParams(window.location.search);
var NOMBRE = params.get('nombre') || '';
var ID     = params.get('id')     || '';
var MODO_TEST = params.get('test') === 'true'; // Se activa con ?test=true en la URL

var tipoSeleccionado = null;
var ubicacionValida = false;
var geoEstadoActual = 'sin_validar'; // 'sin_validar', 'sin_permiso', 'verificada'
var gpsIntentos = 0;
var ultimaDistanciaCalculada = null;

// Inicialización de la UI al cargar
document.addEventListener('DOMContentLoaded', function() {
  inicializarTemas();
  configurarDatosPracticante();
  iniciarGeolocalizacionAutomatica();

  // Escuchar tecla Esc para volver en los formularios
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      volverRegistro();
    }
  });
});

// 2. SISTEMA DE DISEÑO Y TEMAS
function inicializarTemas() {
  var savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark-theme');
  } else if (savedTheme === 'light') {
    document.documentElement.classList.add('light-theme');
  }
}

function alternarTema() {
  var isDark = document.documentElement.classList.contains('dark-theme');
  var isLight = document.documentElement.classList.contains('light-theme');
  
  // Si no tiene clase, depende del sistema preferido
  if (!isDark && !isLight) {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('light-theme');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.add('dark-theme');
      localStorage.setItem('theme', 'dark');
    }
  } else if (isDark) {
    document.documentElement.classList.remove('dark-theme');
    document.documentElement.classList.add('light-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.classList.remove('light-theme');
    document.documentElement.classList.add('dark-theme');
    localStorage.setItem('theme', 'dark');
  }
}

// 3. DATOS DEL PRACTICANTE (DESDE QR)
function configurarDatosPracticante() {
  var nombreLabel = document.getElementById('nombreLabel');
  var saludoDinamico = document.getElementById('saludoDinamico');

  if (!NOMBRE || !ID) {
    nombreLabel.innerHTML = '<span style="color: var(--color-danger)">Acceso no válido</span>';
    saludoDinamico.textContent = 'Faltan credenciales en el código QR';
    deshabilitarBotonRegistro('Falta Nombre o ID');
    return;
  }

  // Sanitiza el nombre para mostrarlo
  var nombreLimpio = decodeURIComponent(NOMBRE);
  nombreLabel.textContent = nombreLimpio;

  // Genera un saludo dinámico según la hora del día local
  var ahora = new Date();
  var hora = ahora.getHours();
  var saludo = '¡Hola!';
  if (hora >= 5 && hora < 12) saludo = '¡Buenos días!';
  else if (hora >= 12 && hora < 19) saludo = '¡Buenas tardes!';
  else saludo = '¡Buenas noches!';

  saludoDinamico.textContent = saludo + ' Selecciona tu marca:';
  
  if (MODO_TEST) {
    activarModoPruebaExplicito(true);
  }
}

// 4. SISTEMA DE GEOLOCALIZACIÓN Y VALIDACIÓN
function iniciarGeolocalizacionAutomatica() {
  if (!NOMBRE || !ID) return;

  actualizarEstadoRadar('buscando', 'Buscando satélites GPS...');
  
  if (!navigator.geolocation) {
    actualizarEstadoRadar('error', 'Tu navegador no soporta geolocalización.');
    geoEstadoActual = 'sin_validar';
    evaluarHabilitacionBoton();
    return;
  }

  solicitarPosicion();
}

function solicitarPosicion() {
  var opcionesGps = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  };

  navigator.geolocation.getCurrentPosition(
    function(pos) {
      gpsIntentos = 0;
      procesarPosicionGps(pos);
    },
    function(err) {
      console.warn('GPS Intento fallido. Código de error: ' + err.code);
      gpsIntentos++;
      
      // Reintentar una vez más si fue por timeout
      if (gpsIntentos < 2 && err.code === err.TIMEOUT) {
        solicitarPosicion();
      } else {
        manejarErrorGps(err);
      }
    },
    opcionesGps
  );
}

function procesarPosicionGps(pos) {
  var latUser = pos.coords.latitude;
  var lngUser = pos.coords.longitude;
  var precision = pos.coords.accuracy;

  var dist = calcularDistancia(latUser, lngUser, INST_LAT, INST_LNG);
  ultimaDistanciaCalculada = dist;

  console.log('Ubicación obtenida: Lat: ' + latUser + ', Lng: ' + lngUser + ', Precisión: ' + precision + 'm, Distancia: ' + dist + 'm');

  if (dist <= INST_RADIO) {
    ubicacionValida = true;
    geoEstadoActual = 'verificada';
    actualizarEstadoRadar('ok', 'Dentro del rango (' + Math.round(dist) + ' metros de la oficina)');
  } else {
    ubicacionValida = false;
    geoEstadoActual = 'lejos';
    actualizarEstadoRadar('lejos', 'Fuera de rango a ' + Math.round(dist) + 'm de la oficina. (Límite: ' + INST_RADIO + 'm)');
  }
  
  evaluarHabilitacionBoton();
}

function manejarErrorGps(err) {
  ubicacionValida = false;
  
  if (err.code === err.PERMISSION_DENIED) {
    actualizarEstadoRadar('error', 'Acceso a GPS denegado. Permite el GPS para registrar.');
    geoEstadoActual = 'sin_permiso';
  } else {
    actualizarEstadoRadar('error', 'Error de señal GPS (' + err.message + '). Intentando sin verificar...');
    geoEstadoActual = 'sin_validar';
  }

  evaluarHabilitacionBoton();
}

// 5. CÁLCULO DE DISTANCIA (FÓRMULA DE HAVERSINE)
function calcularDistancia(lat1, lng1, lat2, lng2) {
  var R = 6371000; // Radio de la Tierra en metros
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLng/2) * Math.sin(dLng/2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// 6. ACCIONES DE LA INTERFAZ
function seleccionarTipo(tipo) {
  if (!NOMBRE || !ID) return;

  tipoSeleccionado = tipo;
  
  // Estilo visual activo
  document.getElementById('btnEntrada').classList.toggle('activo', tipo === 'Entrada');
  document.getElementById('btnSalida').classList.toggle('activo', tipo === 'Salida');
  
  evaluarHabilitacionBoton();
}

function evaluarHabilitacionBoton() {
  var btn = document.getElementById('btnRegistrar');
  
  if (!tipoSeleccionado) {
    deshabilitarBotonRegistro('Selecciona Entrada/Salida');
    return;
  }

  // Si está muy lejos y NO es modo simulación
  if (geoEstadoActual === 'lejos') {
    deshabilitarBotonRegistro('Registro Bloqueado (Fuera de Rango)');
    return;
  }

  // Si no hay permisos de GPS y no se ha denegado (todavía buscando)
  if (geoEstadoActual === 'sin_validar' && document.getElementById('radarStatusText').classList.contains('buscando')) {
    deshabilitarBotonRegistro('Esperando señal GPS...');
    return;
  }

  // En cualquier otro caso (está cerca, o falló el GPS sin permiso/error y se permite guardar con flag)
  habilitarBotonRegistro();
}

function habilitarBotonRegistro() {
  var btn = document.getElementById('btnRegistrar');
  btn.disabled = false;
  btn.classList.add('listo');
  btn.textContent = 'REGISTRAR ' + tipoSeleccionado.toUpperCase();
}

function deshabilitarBotonRegistro(mensaje) {
  var btn = document.getElementById('btnRegistrar');
  btn.disabled = true;
  btn.classList.remove('listo');
  btn.textContent = mensaje;
}

function actualizarEstadoRadar(estado, texto) {
  var wrapper = document.getElementById('radarWrapper');
  var textEl = document.getElementById('radarStatusText');
  var badgeIcon = document.getElementById('radarIcon');

  // Limpia clases
  wrapper.className = 'radar-wrapper ' + estado;
  textEl.className = 'radar-status-text ' + estado;
  textEl.textContent = texto;

  // Cambia el emoji interno
  if (estado === 'buscando') badgeIcon.textContent = '📡';
  else if (estado === 'ok') badgeIcon.textContent = '✅';
  else if (estado === 'lejos') badgeIcon.textContent = '❌';
  else if (estado === 'error') badgeIcon.textContent = '⚠️';
}

// 7. ENVÍO DE DATOS A GOOGLE SHEETS
function iniciarRegistro() {
  if (!tipoSeleccionado || !NOMBRE || !ID) return;

  // Si la ubicación está bloqueada por rango, no procede
  if (geoEstadoActual === 'lejos') {
    alert('No puedes registrar tu asistencia desde fuera de las dependencias de la oficina.');
    return;
  }

  var btn = document.getElementById('btnRegistrar');
  btn.disabled = true;
  btn.classList.remove('listo');
  btn.classList.add('cargando-btn');
  btn.textContent = 'ENVIANDO REGISTRO...';

  // Arma la URL GET para Apps Script
  var url = URL_SCRIPT
    + '?accion=registrar'
    + '&nombre=' + encodeURIComponent(NOMBRE)
    + '&id='     + encodeURIComponent(ID)
    + '&tipo='   + encodeURIComponent(tipoSeleccionado)
    + '&geo='    + encodeURIComponent(geoEstadoActual);

  console.log('Enviando registro: ' + url);

  fetch(url, { method: 'GET', redirect: 'follow' })
    .then(function(r) { 
      if (!r.ok) throw new Error('Error en la respuesta del servidor');
      return r.json(); 
    })
    .then(function(data) {
      if (data.exito) {
        mostrarPantallaResultado('exito', data);
      } else {
        mostrarPantallaResultado('error', { mensaje: data.error || 'No se pudo procesar.' });
      }
    })
    .catch(function(err) {
      console.error(err);
      mostrarPantallaResultado('error', { mensaje: 'Problema de conexión con la base de datos.' });
    });
}

function enviarCorreccion() {
  var motivo = document.getElementById('tipoCorreccion').value;
  var detalle = document.getElementById('detalleCorreccion').value.trim();

  if (!motivo) {
    alert('Por favor selecciona el motivo de la corrección.');
    return;
  }
  if (!detalle) {
    alert('Por favor describe brevemente lo ocurrido para que tu supervisor lo revise.');
    return;
  }

  var btn = document.getElementById('btnEnviarCorreccion');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  var url = URL_SCRIPT
    + '?accion=correccion'
    + '&nombre='  + encodeURIComponent(NOMBRE)
    + '&id='      + encodeURIComponent(ID)
    + '&motivo='  + encodeURIComponent(motivo)
    + '&detalle=' + encodeURIComponent(detalle);

  console.log('Enviando corrección: ' + url);

  fetch(url, { method: 'GET', redirect: 'follow' })
    .then(function(r) { 
      if (!r.ok) throw new Error('Error de servidor');
      return r.json(); 
    })
    .then(function(data) {
      if (data.exito) {
        mostrarPantallaResultado('correccion', data);
      } else {
        alert('Error: ' + (data.error || 'No se pudo enviar la solicitud.'));
        btn.disabled = false;
        btn.textContent = 'Enviar solicitud';
      }
    })
    .catch(function(err) {
      console.error(err);
      alert('Error de conexión al enviar la solicitud. Reintente.');
      btn.disabled = false;
      btn.textContent = 'Enviar solicitud';
    });
}

// 8. CONTROL DE PANTALLAS (TRANSICIONES)
function mostrarCorreccion() {
  document.getElementById('panelRegistro').style.display = 'none';
  document.getElementById('panelCorreccion').style.display = 'block';
  // Hacer focus al select
  document.getElementById('tipoCorreccion').focus();
}

function volverRegistro() {
  // Limpia formularios de corrección
  document.getElementById('tipoCorreccion').value = '';
  document.getElementById('detalleCorreccion').value = '';
  document.getElementById('btnEnviarCorreccion').disabled = false;
  document.getElementById('btnEnviarCorreccion').textContent = 'Enviar solicitud';

  // Mostrar pantallas principales
  document.getElementById('panelCorreccion').style.display = 'none';
  document.getElementById('panelResultado').style.display = 'none';
  document.getElementById('panelRegistro').style.display = 'block';
  
  // Re-evaluar GPS
  iniciarGeolocalizacionAutomatica();
}

function mostrarPantallaResultado(tipo, data) {
  // Ocultar paneles de trabajo
  document.getElementById('panelRegistro').style.display = 'none';
  document.getElementById('panelCorreccion').style.display = 'none';

  var panelRes = document.getElementById('panelResultado');
  
  // Limpiar clases previas
  panelRes.className = 'resultado-pantalla';
  
  var badge = document.getElementById('resBadge');
  var titulo = document.getElementById('resTitulo');
  var tiempo = document.getElementById('resTiempo');
  var statusPill = document.getElementById('resStatus');
  var botonAccion = document.getElementById('resBotonAccion');

  if (tipo === 'exito') {
    if (data.tipo === 'Entrada') {
      panelRes.classList.add('exito-entrada');
      badge.textContent = '🌅';
      titulo.textContent = 'Entrada Registrada';
    } else {
      panelRes.classList.add('exito-salida');
      badge.textContent = '🏃';
      titulo.textContent = 'Salida Registrada';
    }
    
    tiempo.textContent = data.fecha + ' - ' + data.hora;
    
    // Configuración del Status Pill
    statusPill.style.display = 'inline-block';
    statusPill.className = 'resultado-status-pill';
    
    if (data.estado.indexOf('Atrasado') !== -1) {
      statusPill.classList.add('status-atrasado');
      statusPill.textContent = 'Atrasado';
    } else if (data.estado.indexOf('Salida anticipada') !== -1) {
      statusPill.classList.add('status-anticipado');
      statusPill.textContent = 'Salida Anticipada';
    } else if (data.estado.indexOf('Sin') !== -1) {
      statusPill.classList.add('status-pendiente');
      statusPill.textContent = data.estado;
    } else {
      statusPill.classList.add('status-normal');
      statusPill.textContent = 'Normal';
    }

    botonAccion.textContent = 'Entendido';

  } else if (tipo === 'correccion') {
    panelRes.classList.add('correccion-pantalla');
    badge.textContent = '📩';
    titulo.textContent = 'Solicitud Enviada';
    tiempo.textContent = data.fecha + ' - ' + data.hora;
    
    statusPill.style.display = 'inline-block';
    statusPill.className = 'resultado-status-pill status-pendiente';
    statusPill.textContent = 'Pendiente de Revisión';
    
    botonAccion.textContent = 'Volver al Inicio';

  } else {
    // Caso de error
    panelRes.classList.add('error-pantalla');
    badge.textContent = '❌';
    titulo.textContent = 'Error de Registro';
    tiempo.textContent = data.mensaje || 'Inténtelo de nuevo más tarde.';
    statusPill.style.display = 'none';
    
    botonAccion.textContent = 'Reintentar';
  }

  panelRes.style.display = 'block';
}

// 9. FUNCIONES DE PRUEBA (DESARROLLADOR)
// Permite simular que estás dentro de la oficina haciendo doble clic en el ícono del logo
var clickCount = 0;
function gatillarModoPrueba() {
  clickCount++;
  if (clickCount >= 5) {
    clickCount = 0;
    activarModoPruebaExplicito(!MODO_TEST);
  }
  // Resetear el conteo tras 2 segundos de inactividad
  setTimeout(function() { clickCount = 0; }, 2000);
}

function activarModoPruebaExplicito(activar) {
  MODO_TEST = activar;
  if (MODO_TEST) {
    ubicacionValida = true;
    geoEstadoActual = 'verificada';
    actualizarEstadoRadar('ok', '⚡ MODO SIMULACIÓN: Ubicación forzada dentro del rango (50m)');
    evaluarHabilitacionBoton();
    console.log('⚡ Modo simulación GPS activado para pruebas locales.');
  } else {
    iniciarGeolocalizacionAutomatica();
    console.log('🔌 Modo simulación GPS desactivado.');
  }
}
