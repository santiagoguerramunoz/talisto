// Ingresos y gastos por mes, a partir de presupuestos, trabajos B2B, turnos y gastos
import { importeOrden } from './liquidacion';
import { numero, r2, totalesMateriales } from './precios';
import { esFinalizado } from './trabajos';

export const COLOR_INGRESOS = '#1ea47f';
export const COLOR_GASTOS = '#d9731c';

const dos = (n) => String(n).padStart(2, '0');
export const claveMes = ({ anio, mes }) => `${anio}-${dos(mes)}`;
const mesDeFecha = (iso) => String(iso || '').slice(0, 7);
const mesDeInstante = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}`;
};

export function movimientos({ presupuestos = [], ordenes = [], turnos = [], gastos = [] }) {
  const ingresos = [];
  const costos = [];

  presupuestos
    .filter((p) => p.estado === 'aceptado' && p.aceptado_en)
    .forEach((p) => {
      const mes = mesDeFecha(p.aceptado_en);
      ingresos.push({ mes, fuente: 'presupuestos', monto: Number(p.subtotal || 0), iva: Number(p.iva || 0), cobrado: !!p.cobrado_en, ref: p });
      if (Number(p.costo_total)) costos.push({ mes, fuente: 'materiales', monto: Number(p.costo_total) });
    });

  ordenes.filter(esFinalizado).forEach((o) => {
    const mes = mesDeFecha(o.fecha);
    ingresos.push({ mes, fuente: 'b2b', empresa_id: o.empresa_id, monto: importeOrden(o) || 0, ref: o });
    const costo = totalesMateriales(o.materiales || []).costo;
    if (costo) costos.push({ mes, fuente: 'materiales', monto: costo });
  });

  turnos
    .filter((t) => t.estado === 'realizado')
    .forEach((t) => {
      const mes = mesDeInstante(t.inicio);
      if (t.tipo === 'visita') {
        const neto = (numero(t.precio_visita) ?? 0) - (numero(t.comision) ?? 0);
        if (neto > 0) ingresos.push({ mes, fuente: 'visitas', monto: neto, ref: t });
      } else if (numero(t.monto_acordado)) {
        ingresos.push({ mes, fuente: 'turnos', monto: numero(t.monto_acordado), ref: t });
      }
    });

  gastos.forEach((g) => costos.push({ mes: mesDeFecha(g.fecha), fuente: 'gastos', categoria: g.categoria, monto: Number(g.monto || 0) }));

  return { ingresos, costos };
}

const suma = (lista) => r2(lista.reduce((s, m) => s + m.monto, 0));

export function resumenMes(movs, mes) {
  const ing = movs.ingresos.filter((m) => m.mes === mes);
  const cos = movs.costos.filter((m) => m.mes === mes);
  const de = (fuente) => ing.filter((m) => m.fuente === fuente);

  const pres = de('presupuestos');
  const b2b = de('b2b');
  const porEmpresa = {};
  b2b.forEach((m) => {
    porEmpresa[m.empresa_id] = porEmpresa[m.empresa_id] || { total: 0, cantidad: 0 };
    porEmpresa[m.empresa_id].total = r2(porEmpresa[m.empresa_id].total + m.monto);
    porEmpresa[m.empresa_id].cantidad += 1;
  });
  const gastos = cos.filter((m) => m.fuente === 'gastos');
  const porCategoria = {};
  gastos.forEach((m) => {
    porCategoria[m.categoria] = r2((porCategoria[m.categoria] || 0) + m.monto);
  });

  const ingresos = suma(ing);
  const costos = suma(cos);
  return {
    ingresos,
    costos,
    resultado: r2(ingresos - costos),
    margen: ingresos > 0 ? Math.round(((ingresos - costos) / ingresos) * 1000) / 10 : null,
    presupuestos: {
      total: suma(pres),
      cantidad: pres.length,
      cobrado: suma(pres.filter((m) => m.cobrado)),
      porCobrar: suma(pres.filter((m) => !m.cobrado)),
      iva: r2(pres.reduce((s, m) => s + (m.iva || 0), 0)),
    },
    b2b: { total: suma(b2b), cantidad: b2b.length, porEmpresa },
    turnos: { total: suma(de('turnos')), cantidad: de('turnos').length },
    visitas: { total: suma(de('visitas')), cantidad: de('visitas').length },
    materiales: suma(cos.filter((m) => m.fuente === 'materiales')),
    gastos: { total: suma(gastos), cantidad: gastos.length, porCategoria },
  };
}

// Serie de varios meses para el gráfico: [{ clave, anio, mes, ingresos, costos, resultado }]
export function serieMeses(movs, periodos) {
  return periodos.map((p) => {
    const clave = claveMes(p);
    const ingresos = suma(movs.ingresos.filter((m) => m.mes === clave));
    const costos = suma(movs.costos.filter((m) => m.mes === clave));
    return { ...p, clave, ingresos, costos, resultado: r2(ingresos - costos) };
  });
}
