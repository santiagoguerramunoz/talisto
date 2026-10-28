import { fechaISO, minutos, minutosDeFecha, combinar } from './fechas';

// ¿El horario fijo se hace en esta fecha?
export function bloqueActivoEn(bloque, fecha) {
  const iso = fechaISO(fecha);
  const dow = new Date(fecha).getDay();
  if (!(bloque.dias || []).map(Number).includes(dow)) return false;
  if (iso < bloque.fecha_desde) return false;
  if (bloque.fecha_hasta && iso > bloque.fecha_hasta) return false;
  if ((bloque.bloques_excepciones || []).some((e) => e.fecha === iso)) return false;
  return true;
}

export function indexarClientes(clientes = []) {
  const porId = {};
  const direccionPorId = {};
  clientes.forEach((c) => {
    porId[c.id] = c;
    (c.direcciones || []).forEach((d) => {
      direccionPorId[d.id] = { ...d, cliente_id: c.id };
    });
  });
  return { porId, direccionPorId };
}

// Turnos + horarios fijos + órdenes de empresa de un día, como una sola lista ordenada
export function eventosDelDia({ fecha, turnos = [], bloques = [], ordenes = [], indice }) {
  const iso = fechaISO(fecha);
  const { porId = {}, direccionPorId = {} } = indice || {};
  const lista = [];

  turnos
    .filter((t) => t.estado !== 'cancelado' && fechaISO(new Date(t.inicio)) === iso)
    .forEach((t) => {
      const cliente = t.cliente_id ? porId[t.cliente_id] : null;
      const ini = minutosDeFecha(t.inicio);
      const finDate = new Date(t.fin);
      const fin = fechaISO(finDate) === iso ? minutosDeFecha(finDate) : 24 * 60;
      lista.push({
        key: `t-${t.id}`,
        clase: 'turno',
        ini,
        fin: Math.max(fin, ini + 15),
        titulo: cliente?.nombre || t.titulo || 'Turno',
        color: cliente?.color || '#94a3b8',
        cliente,
        direccion: t.direccion_id ? direccionPorId[t.direccion_id] : null,
        estado: t.estado,
        monto: t.monto_acordado,
        tipo: t.tipo,
        flexible: !!t.flexible,
        turno: t,
      });
    });

  bloques
    .filter((b) => bloqueActivoEn(b, fecha))
    .forEach((b) => {
      const cliente = b.cliente_id ? porId[b.cliente_id] : null;
      lista.push({
        key: `b-${b.id}-${iso}`,
        clase: 'bloque',
        ini: minutos(b.hora_inicio),
        fin: minutos(b.hora_fin),
        titulo: cliente?.nombre || b.titulo || 'Horario fijo',
        color: cliente?.color || '#94a3b8',
        cliente,
        direccion: b.direccion_id ? direccionPorId[b.direccion_id] : null,
        estado: 'fijo',
        monto: b.monto,
        bloque: b,
        fecha: iso,
      });
    });

  // Órdenes de empresa (ej. tickets de Grupo Gamma). Sin horario: toman la franja fija de esa empresa ese día.
  ordenes
    .filter((o) => o.estado !== 'cancelado' && o.fecha === iso)
    .forEach((o) => {
      const empresa = porId[o.empresa_id];
      let ini;
      let fin;
      const sinHora = !o.hora_inicio;
      if (!sinHora) {
        ini = minutos(o.hora_inicio);
        fin = o.hora_fin ? minutos(o.hora_fin) : ini + 60;
      } else {
        const franja = bloques.find((b) => b.cliente_id === o.empresa_id && bloqueActivoEn(b, fecha));
        ini = franja ? minutos(franja.hora_inicio) : 8 * 60;
        fin = franja ? minutos(franja.hora_fin) : 18 * 60;
      }
      const identificador = o.numero_ticket ? `Tk ${o.numero_ticket}` : o.numero_cliente ? `Cliente ${o.numero_cliente}` : 'Orden';
      lista.push({
        key: `o-${o.id}`,
        clase: 'orden',
        ini,
        fin: Math.max(fin, ini + 15),
        titulo: `${empresa?.nombre || 'Empresa'} · ${identificador}`,
        color: empresa?.color || '#94a3b8',
        cliente: empresa,
        direccion:
          o.direccion || (o.lat !== null && o.lat !== undefined)
            ? { id: `o-${o.id}`, etiqueta: o.cliente_final || identificador, direccion: o.direccion || '', referencia: o.referencia, lat: o.lat, lng: o.lng }
            : null,
        estado: o.estado,
        sinHora,
        orden: o,
      });
    });

  return lista.sort((a, b) => a.ini - b.ini || a.fin - b.fin);
}

// Reparte en columnas los eventos que se superponen (vista de día)
export function distribuirColumnas(eventos) {
  const ordenados = eventos.map((e) => ({ ...e })).sort((a, b) => a.ini - b.ini || b.fin - a.fin);
  const resultado = [];
  let grupo = [];
  let finGrupo = -Infinity;

  const cerrarGrupo = () => {
    const columnas = [];
    grupo.forEach((ev) => {
      let c = columnas.findIndex((fin) => fin <= ev.ini);
      if (c === -1) {
        c = columnas.length;
        columnas.push(ev.fin);
      } else {
        columnas[c] = ev.fin;
      }
      ev.col = c;
    });
    grupo.forEach((ev) => {
      ev.ncols = columnas.length;
      resultado.push(ev);
    });
    grupo = [];
  };

  ordenados.forEach((ev) => {
    if (ev.ini >= finGrupo) {
      cerrarGrupo();
      finGrupo = -Infinity;
    }
    grupo.push(ev);
    finGrupo = Math.max(finGrupo, ev.fin);
  });
  cerrarGrupo();
  return resultado;
}

// Horarios fijos que chocan con un turno nuevo (para avisar antes de guardar)
export function choquesConBloques({ fecha, desde, hasta, bloques = [], indice }) {
  const ini = minutos(desde);
  const fin = minutos(hasta);
  return bloques
    .filter((b) => bloqueActivoEn(b, combinar(fecha, '00:00')))
    .filter((b) => minutos(b.hora_inicio) < fin && minutos(b.hora_fin) > ini)
    .map((b) => indice?.porId?.[b.cliente_id]?.nombre || b.titulo || 'un horario fijo');
}
