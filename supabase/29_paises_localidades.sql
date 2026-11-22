-- =====================================================================
--  TaListo!  ·  29 · Países, regiones y localidades (Latinoamérica)
--  · 20 países de Latinoamérica con sus departamentos, provincias,
--    estados o regiones, y sus ciudades, localidades o barrios.
--    Datos de lugares: base pública countries-states-cities-database
--    (github.com/dr5hn), licencia ODbL.
--  · Solo Uruguay queda activo. Los demás países quedan cargados y se
--    prenden desde /admin → Países cuando esté conectado su cobro.
--  · Cada cuenta guarda país, región y localidad. Si la localidad no está
--    en la lista, la persona la escribe y queda pendiente hasta que el
--    admin la apruebe, la una con otra o la rechace.
--  · Cada país tiene su moneda y sus precios (visita, urgencia y planes).
--  Correr después del 28. Después correr, en orden, las localidades:
--    29_localidades_1.sql, 29_localidades_2.sql y 29_localidades_3.sql.
--  Todo se puede correr más de una vez.
-- =====================================================================

-- 1. Clave para comparar nombres de lugares sin tildes ni mayúsculas
create or replace function public._clave_lugar(t text)
returns text language sql immutable parallel safe as $$
  select trim(regexp_replace(lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÑñÇç',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc')), '[^a-z0-9]+', ' ', 'g'));
$$;

-- 2. Tablas
create table if not exists public.paises (
  codigo           char(2) primary key,
  nombre           text not null,
  nombre_region    text not null,              -- Departamento, Provincia, Estado, Región
  nombre_localidad text not null,              -- Localidad, Municipio, Comuna…
  moneda           char(3) not null,
  simbolo          text not null,
  prefijo_tel      text not null,
  bandera          text not null,
  idioma           text not null default 'es',
  zona_horaria     text not null,
  activo           boolean not null default false,
  orden            smallint not null default 100,
  precios          jsonb not null default '{}'::jsonb,  -- en moneda local: visita_cliente, visita_profesional, urgencia_cliente, urgencia_profesional, plan_pro, plan_business
  actualizado_en   timestamptz not null default now()
);

create table if not exists public.regiones (
  id     serial primary key,
  pais   char(2) not null references public.paises(codigo) on delete cascade,
  nombre text not null,
  codigo text,
  ref    int unique,                           -- id en la base pública
  unique (pais, nombre)
);
create index if not exists regiones_pais_idx on public.regiones (pais, nombre);

create table if not exists public.localidades (
  id            serial primary key,
  region_id     int not null references public.regiones(id) on delete cascade,
  nombre        text not null check (length(trim(nombre)) between 2 and 80),
  clave         text generated always as (public._clave_lugar(nombre)) stored,
  lat           numeric(8,5),
  lng           numeric(8,5),
  poblacion     int,
  estado        text not null default 'aprobada' check (estado in ('aprobada','pendiente','rechazada')),
  propuesta_por uuid references auth.users(id) on delete set null,
  creado_en     timestamptz not null default now(),
  unique (region_id, clave)
);
create index if not exists localidades_estado_idx on public.localidades (estado) where estado <> 'aprobada';

alter table public.paises      enable row level security;
alter table public.regiones    enable row level security;
alter table public.localidades enable row level security;
drop policy if exists paises_ver on public.paises;
create policy paises_ver on public.paises for select using (true);
drop policy if exists regiones_ver on public.regiones;
create policy regiones_ver on public.regiones for select using (true);
drop policy if exists localidades_ver on public.localidades;
create policy localidades_ver on public.localidades for select
  using (estado = 'aprobada' or propuesta_por = auth.uid() or public.es_admin());
-- se escribe solo con las funciones de abajo
revoke insert, update, delete on public.paises, public.regiones, public.localidades from anon, authenticated;
grant select on public.paises, public.regiones, public.localidades to anon, authenticated;

-- 3. Países (Uruguay activo; el resto listo para prender)
insert into public.paises (codigo, nombre, nombre_region, nombre_localidad, moneda, simbolo, prefijo_tel, bandera, idioma, zona_horaria, activo, orden) values
('UY','Uruguay','Departamento','Localidad o barrio','UYU','$','+598','🇺🇾','es','America/Montevideo',true,1),
('AR','Argentina','Provincia','Localidad','ARS','$','+54','🇦🇷','es','America/Argentina/Buenos_Aires',false,10),
('BO','Bolivia','Departamento','Localidad','BOB','Bs','+591','🇧🇴','es','America/La_Paz',false,10),
('BR','Brasil','Estado','Município','BRL','R$','+55','🇧🇷','pt','America/Sao_Paulo',false,10),
('CL','Chile','Región','Comuna o ciudad','CLP','$','+56','🇨🇱','es','America/Santiago',false,10),
('CO','Colombia','Departamento','Municipio','COP','$','+57','🇨🇴','es','America/Bogota',false,10),
('CR','Costa Rica','Provincia','Cantón o ciudad','CRC','₡','+506','🇨🇷','es','America/Costa_Rica',false,10),
('CU','Cuba','Provincia','Municipio','CUP','$','+53','🇨🇺','es','America/Havana',false,10),
('DO','República Dominicana','Provincia','Municipio o ciudad','DOP','RD$','+1','🇩🇴','es','America/Santo_Domingo',false,10),
('EC','Ecuador','Provincia','Cantón o ciudad','USD','$','+593','🇪🇨','es','America/Guayaquil',false,10),
('SV','El Salvador','Departamento','Municipio','USD','$','+503','🇸🇻','es','America/El_Salvador',false,10),
('GT','Guatemala','Departamento','Municipio','GTQ','Q','+502','🇬🇹','es','America/Guatemala',false,10),
('HN','Honduras','Departamento','Municipio','HNL','L','+504','🇭🇳','es','America/Tegucigalpa',false,10),
('MX','México','Estado','Municipio o localidad','MXN','$','+52','🇲🇽','es','America/Mexico_City',false,10),
('NI','Nicaragua','Departamento','Municipio','NIO','C$','+505','🇳🇮','es','America/Managua',false,10),
('PA','Panamá','Provincia','Distrito o corregimiento','USD','$','+507','🇵🇦','es','America/Panama',false,10),
('PY','Paraguay','Departamento','Ciudad','PYG','₲','+595','🇵🇾','es','America/Asuncion',false,10),
('PE','Perú','Región','Distrito o ciudad','PEN','S/','+51','🇵🇪','es','America/Lima',false,10),
('PR','Puerto Rico','Municipio','Barrio o ciudad','USD','$','+1','🇵🇷','es','America/Puerto_Rico',false,10),
('VE','Venezuela','Estado','Municipio o ciudad','VES','Bs.','+58','🇻🇪','es','America/Caracas',false,10)
on conflict (codigo) do nothing;

-- 4. Departamentos, provincias, estados y regiones
insert into public.regiones (pais, nombre, codigo, ref) values
('AR','Buenos Aires','B',3656),
('AR','Catamarca','K',3647),
('AR','Chaco','H',3640),
('AR','Chubut','U',3651),
('AR','Ciudad Autónoma de Buenos Aires','C',4880),
('AR','Corrientes','W',3638),
('AR','Córdoba','X',3642),
('AR','Entre Ríos','E',3654),
('AR','Formosa','P',3652),
('AR','Jujuy','Y',3645),
('AR','La Pampa','L',3655),
('AR','La Rioja','F',3653),
('AR','Mendoza','M',3646),
('AR','Misiones','N',3644),
('AR','Neuquén','Q',3648),
('AR','Río Negro','R',3639),
('AR','Salta','A',3643),
('AR','San Juan','J',3634),
('AR','San Luis','D',3636),
('AR','Santa Cruz','Z',3649),
('AR','Santa Fe','S',3641),
('AR','Santiago del Estero','G',3635),
('AR','Tierra del Fuego','V',3650),
('AR','Tucumán','T',3637),
('BO','Beni','B',3375),
('BO','Chuquisaca','H',3382),
('BO','Cochabamba','C',3381),
('BO','La Paz','L',3380),
('BO','Oruro','O',3376),
('BO','Pando','N',3379),
('BO','Potosí','P',3383),
('BO','Santa Cruz','S',3377),
('BO','Tarija','T',3378),
('BR','Acre','AC',2012),
('BR','Alagoas','AL',2007),
('BR','Amapá','AP',1999),
('BR','Amazonas','AM',2004),
('BR','Bahia','BA',2002),
('BR','Ceará','CE',2016),
('BR','Distrito Federal','DF',2017),
('BR','Espírito Santo','ES',2018),
('BR','Goiás','GO',2000),
('BR','Maranhão','MA',2015),
('BR','Mato Grosso','MT',2011),
('BR','Mato Grosso do Sul','MS',2010),
('BR','Minas Gerais','MG',1998),
('BR','Paraná','PR',2022),
('BR','Paraíba','PB',2005),
('BR','Pará','PA',2009),
('BR','Pernambuco','PE',2006),
('BR','Piauí','PI',2008),
('BR','Rio Grande do Norte','RN',2019),
('BR','Rio Grande do Sul','RS',2001),
('BR','Rio de Janeiro','RJ',1997),
('BR','Rondônia','RO',2013),
('BR','Roraima','RR',4858),
('BR','Santa Catarina','SC',2014),
('BR','Sergipe','SE',2003),
('BR','São Paulo','SP',2021),
('BR','Tocantins','TO',2020),
('CL','Aisén del General Carlos Ibañez del Campo','AI',2828),
('CL','Antofagasta','AN',2832),
('CL','Arica y Parinacota','AP',2829),
('CL','Atacama','AT',2823),
('CL','Biobío','BI',2827),
('CL','Coquimbo','CO',2825),
('CL','La Araucanía','AR',2826),
('CL','Libertador General Bernardo O''Higgins','LI',2838),
('CL','Los Lagos','LL',2835),
('CL','Los Ríos','LR',2834),
('CL','Magallanes y de la Antártica Chilena','MA',2836),
('CL','Maule','ML',2833),
('CL','Región Metropolitana de Santiago','RM',2824),
('CL','Tarapacá','TA',2837),
('CL','Valparaíso','VS',2830),
('CL','Ñuble','NB',2831),
('CO','Amazonas','AMA',2895),
('CO','Antioquia','ANT',2890),
('CO','Arauca','ARA',2881),
('CO','Atlántico','ATL',2880),
('CO','Bogotá D.C.','DC',4921),
('CO','Bolívar','BOL',2893),
('CO','Boyacá','BOY',2903),
('CO','Caldas','CAL',2887),
('CO','Caquetá','CAQ',2891),
('CO','Casanare','CAS',2892),
('CO','Cauca','CAU',2884),
('CO','Cesar','CES',2899),
('CO','Chocó','CHO',2876),
('CO','Cundinamarca','CUN',2875),
('CO','Córdoba','COR',2898),
('CO','Guainía','GUA',2882),
('CO','Guaviare','GUV',2888),
('CO','Huila','HUI',4871),
('CO','La Guajira','LAG',2889),
('CO','Magdalena','MAG',2886),
('CO','Meta','MET',2878),
('CO','Nariño','NAR',2897),
('CO','Norte de Santander','NSA',2877),
('CO','Putumayo','PUT',2896),
('CO','Quindío','QUI',2874),
('CO','Risaralda','RIS',2879),
('CO','San Andrés, Providencia y Santa Catalina','SAP',2900),
('CO','Santander','SAN',2901),
('CO','Sucre','SUC',2902),
('CO','Tolima','TOL',2883),
('CO','Valle del Cauca','VAC',2904),
('CO','Vaupés','VAU',2885),
('CO','Vichada','VID',2894),
('CR','Alajuela','A',1215),
('CR','Cartago','C',1211),
('CR','Guanacaste','G',1209),
('CR','Heredia','H',1212),
('CR','Limón','L',1213),
('CR','Puntarenas','P',1210),
('CR','San José','SJ',1214),
('CU','Artemisa','15',283),
('CU','Camagüey','09',286),
('CU','Ciego de Ávila','08',282),
('CU','Cienfuegos','06',287),
('CU','Granma','12',275),
('CU','Guantánamo','14',285),
('CU','Havana','03',272),
('CU','Holguín','11',279),
('CU','Isla de la Juventud','99',278),
('CU','Las Tunas','10',281),
('CU','Matanzas','04',284),
('CU','Mayabeque','16',276),
('CU','Pinar del Río','01',277),
('CU','Sancti Spíritus','07',274),
('CU','Santiago de Cuba','13',273),
('CU','Villa Clara','05',280),
('DO','Azua','02',4114),
('DO','Baoruco','03',4105),
('DO','Barahona','04',4090),
('DO','Dajabón','05',4107),
('DO','Distrito Nacional','01',4095),
('DO','Duarte','06',4113),
('DO','El Seibo','08',4086),
('DO','Elías Piña','07',5539),
('DO','Espaillat','09',4102),
('DO','Hato Mayor','30',4106),
('DO','Hermanas Mirabal','19',4089),
('DO','Independencia','10',4097),
('DO','La Altagracia','11',4109),
('DO','La Romana','12',4087),
('DO','La Vega','13',4116),
('DO','María Trinidad Sánchez','14',4094),
('DO','Monseñor Nouel','28',4099),
('DO','Monte Cristi','15',4115),
('DO','Monte Plata','29',4111),
('DO','Pedernales','16',4101),
('DO','Peravia','17',4096),
('DO','Puerto Plata','18',4092),
('DO','Samaná','20',4103),
('DO','San Cristóbal','21',4091),
('DO','San José de Ocoa','31',4112),
('DO','San Juan','22',4098),
('DO','San Pedro de Macorís','23',4110),
('DO','Santiago','25',4108),
('DO','Santiago Rodríguez','26',4100),
('DO','Santo Domingo','32',4093),
('DO','Sánchez Ramírez','24',4088),
('DO','Valverde','27',4104),
('EC','Azuay','A',2923),
('EC','Bolívar','B',2920),
('EC','Carchi','C',2915),
('EC','Cañar','F',2917),
('EC','Chimborazo','H',2925),
('EC','Cotopaxi','X',2921),
('EC','El Oro','O',2924),
('EC','Esmeraldas','E',2922),
('EC','Galápagos','W',2905),
('EC','Guayas','G',2914),
('EC','Imbabura','I',2911),
('EC','Loja','L',5068),
('EC','Los Ríos','R',2910),
('EC','Manabí','M',2913),
('EC','Morona-Santiago','S',2918),
('EC','Napo','N',2916),
('EC','Orellana','D',2926),
('EC','Pastaza','Y',2907),
('EC','Pichincha','P',2927),
('EC','Santa Elena','SE',2912),
('EC','Santo Domingo de los Tsáchilas','SD',2919),
('EC','Sucumbíos','U',2906),
('EC','Tungurahua','T',2908),
('EC','Zamora Chinchipe','Z',2909),
('GT','Alta Verapaz','16',3671),
('GT','Baja Verapaz','15',3674),
('GT','Chimaltenango','04',3675),
('GT','Chiquimula','20',3666),
('GT','El Progreso','02',3662),
('GT','Escuintla','05',3677),
('GT','Guatemala','01',3672),
('GT','Huehuetenango','13',3670),
('GT','Izabal','18',3659),
('GT','Jalapa','21',3658),
('GT','Jutiapa','22',3673),
('GT','Petén','17',3669),
('GT','Quetzaltenango','09',3668),
('GT','Quiché','14',3657),
('GT','Retalhuleu','11',3664),
('GT','Sacatepéquez','03',3676),
('GT','San Marcos','12',3667),
('GT','Santa Rosa','06',3665),
('GT','Sololá','07',3661),
('GT','Suchitepéquez','10',3660),
('GT','Totonicapán','08',3663),
('GT','Zacapa','19',5239),
('HN','Atlántida','AT',4047),
('HN','Bay Islands','IB',4045),
('HN','Choluteca','CH',4041),
('HN','Colón','CL',4051),
('HN','Comayagua','CM',4042),
('HN','Copán','CP',4049),
('HN','Cortés','CR',4046),
('HN','El Paraíso','EP',4043),
('HN','Francisco Morazán','FM',4052),
('HN','Gracias a Dios','GD',4048),
('HN','Intibucá','IN',4044),
('HN','La Paz','LP',4058),
('HN','Lempira','LE',4054),
('HN','Ocotepeque','OC',4056),
('HN','Olancho','OL',4050),
('HN','Santa Bárbara','SB',4053),
('HN','Valle','VA',4055),
('HN','Yoro','YO',4057),
('MX','Aguascalientes','AGU',3456),
('MX','Baja California','BCN',3457),
('MX','Baja California Sur','BCS',3460),
('MX','Campeche','CAM',3475),
('MX','Chiapas','CHP',3451),
('MX','Chihuahua','CHH',3447),
('MX','Ciudad de México','CMX',3473),
('MX','Coahuila de Zaragoza','COA',3471),
('MX','Colima','COL',3472),
('MX','Durango','DUR',3453),
('MX','Estado de México','MEX',3450),
('MX','Guanajuato','GUA',3469),
('MX','Guerrero','GRO',3459),
('MX','Hidalgo','HID',3470),
('MX','Jalisco','JAL',4857),
('MX','Michoacán de Ocampo','MIC',3474),
('MX','Morelos','MOR',3465),
('MX','Nayarit','NAY',3477),
('MX','Nuevo León','NLE',3452),
('MX','Oaxaca','OAX',3448),
('MX','Puebla','PUE',3476),
('MX','Querétaro','QUE',3455),
('MX','Quintana Roo','ROO',3467),
('MX','San Luis Potosí','SLP',3461),
('MX','Sinaloa','SIN',3449),
('MX','Sonora','SON',3468),
('MX','Tabasco','TAB',3454),
('MX','Tamaulipas','TAM',3463),
('MX','Tlaxcala','TLA',3458),
('MX','Veracruz de Ignacio de la Llave','VER',3464),
('MX','Yucatán','YUC',3466),
('MX','Zacatecas','ZAC',3462),
('NI','Boaco','BO',946),
('NI','Carazo','CA',950),
('NI','Chinandega','CI',954),
('NI','Chontales','CO',940),
('NI','Estelí','ES',945),
('NI','Granada','GR',943),
('NI','Jinotega','JI',955),
('NI','León','LE',944),
('NI','Madriz','MD',948),
('NI','Managua','MN',941),
('NI','Masaya','MS',953),
('NI','Matagalpa','MT',947),
('NI','North Caribbean Coast','AN',951),
('NI','Nueva Segovia','NS',4964),
('NI','Rivas','RI',942),
('NI','Río San Juan','SJ',949),
('NI','South Caribbean Coast','AS',952),
('PA','Bocas del Toro','1',1393),
('PA','Chiriquí','4',1397),
('PA','Coclé','2',1387),
('PA','Colón','3',1386),
('PA','Darién','5',1385),
('PA','Emberá-Wounaan Comarca','EM',1396),
('PA','Guna','KY',1388),
('PA','Herrera','6',1389),
('PA','Los Santos','7',1390),
('PA','Naso Tjër Di','NT',5686),
('PA','Ngöbe-Buglé Comarca','NB',1391),
('PA','Panamá','8',1395),
('PA','Panamá Oeste','10',1394),
('PA','Veraguas','9',1392),
('PE','Amazonas','AMA',3685),
('PE','Apurímac','APU',3699),
('PE','Arequipa','ARE',3681),
('PE','Ayacucho','AYA',3692),
('PE','Cajamarca','CAJ',3688),
('PE','Callao','CAL',3701),
('PE','Cusco','CUS',3691),
('PE','Huancavelica','HUV',3679),
('PE','Huánuco','HUC',3687),
('PE','Ica','ICA',3700),
('PE','Junín','JUN',3693),
('PE','La Libertad','LAL',3683),
('PE','Lambayeque','LAM',3702),
('PE','Lima','LIM',3695),
('PE','Lima Metropolitana','LMA',5687),
('PE','Loreto','LOR',4922),
('PE','Madre de Dios','MDD',3678),
('PE','Moquegua','MOQ',3698),
('PE','Pasco','PAS',3686),
('PE','Piura','PIU',3697),
('PE','Puno','PUN',3682),
('PE','San Martín','SAM',3694),
('PE','Tacna','TAC',3696),
('PE','Tumbes','TUM',3689),
('PE','Ucayali','UCA',3684),
('PE','Áncash','ANC',3680),
('PR','Adjuntas','001',5134),
('PR','Aguada','003',5135),
('PR','Aguadilla','005',5136),
('PR','Aguas Buenas','007',5137),
('PR','Aibonito','009',5138),
('PR','Arecibo','AR',5081),
('PR','Arroyo','015',5141),
('PR','Añasco','011',5139),
('PR','Barceloneta','017',5142),
('PR','Barranquitas','019',5143),
('PR','Bayamón','BY',5076),
('PR','Cabo Rojo','023',5145),
('PR','Caguas','CG',5079),
('PR','Camuy','027',5147),
('PR','Canóvanas','029',5148),
('PR','Carolina','CL',5077),
('PR','Cataño','033',5150),
('PR','Cayey','035',5151),
('PR','Ceiba','037',5152),
('PR','Ciales','039',5153),
('PR','Cidra','041',5154),
('PR','Coamo','043',5155),
('PR','Comerío','045',5156),
('PR','Corozal','047',5157),
('PR','Culebra','049',5158),
('PR','Dorado','051',5159),
('PR','Fajardo','053',5160),
('PR','Florida','054',5161),
('PR','Guayama','057',5163),
('PR','Guayanilla','059',5164),
('PR','Guaynabo','GN',5080),
('PR','Gurabo','063',5166),
('PR','Guánica','055',5162),
('PR','Hatillo','065',5167),
('PR','Hormigueros','067',5168),
('PR','Humacao','069',5169),
('PR','Isabela','071',5170),
('PR','Jayuya','073',5171),
('PR','Juana Díaz','075',5172),
('PR','Juncos','077',5173),
('PR','Lajas','079',5174),
('PR','Lares','081',5175),
('PR','Las Marías','083',5176),
('PR','Las Piedras','085',5177),
('PR','Loíza','087',5178),
('PR','Luquillo','089',5179),
('PR','Manatí','091',5180),
('PR','Maricao','093',5181),
('PR','Maunabo','095',5182),
('PR','Mayagüez','MG',5083),
('PR','Moca','099',5184),
('PR','Morovis','101',5185),
('PR','Naguabo','103',5186),
('PR','Naranjito','105',5187),
('PR','Orocovis','107',5188),
('PR','Patillas','109',5189),
('PR','Peñuelas','111',5190),
('PR','Ponce','PO',5078),
('PR','Quebradillas','115',5192),
('PR','Rincón','117',5193),
('PR','Río Grande','119',5194),
('PR','Sabana Grande','121',5195),
('PR','Salinas','123',5196),
('PR','San Germán','125',5197),
('PR','San Juan','SJ',5075),
('PR','San Lorenzo','129',5199),
('PR','San Sebastián','131',5200),
('PR','Santa Isabel','133',5201),
('PR','Toa Alta','135',5202),
('PR','Toa Baja','TB',5082),
('PR','Trujillo Alto','TA',5084),
('PR','Utuado','141',5205),
('PR','Vega Alta','143',5206),
('PR','Vega Baja','145',5207),
('PR','Vieques','147',5208),
('PR','Villalba','149',5209),
('PR','Yabucoa','151',5210),
('PR','Yauco','153',5211),
('PY','Alto Paraguay','16',2785),
('PY','Alto Paraná','10',2784),
('PY','Amambay','13',2782),
('PY','Asuncion','ASU',5221),
('PY','Boquerón','19',2780),
('PY','Caaguazú','5',2773),
('PY','Caazapá','6',2775),
('PY','Canindeyú','14',2771),
('PY','Central','11',2777),
('PY','Concepción','1',2779),
('PY','Cordillera','3',2783),
('PY','Guairá','4',2772),
('PY','Itapúa','7',2778),
('PY','Misiones','8',2786),
('PY','Paraguarí','9',2774),
('PY','Presidente Hayes','15',2770),
('PY','San Pedro','2',2776),
('PY','Ñeembucú','12',2781),
('SV','Ahuachapán','AH',4139),
('SV','Cabañas','CA',4132),
('SV','Chalatenango','CH',4131),
('SV','Cuscatlán','CU',4137),
('SV','La Libertad','LI',4134),
('SV','La Paz','PA',4136),
('SV','La Unión','UN',4138),
('SV','Morazán','MO',4130),
('SV','San Miguel','SM',4135),
('SV','San Salvador','SS',4133),
('SV','San Vicente','SV',4127),
('SV','Santa Ana','SA',4128),
('SV','Sonsonate','SO',4140),
('SV','Usulután','US',4129),
('UY','Artigas','AR',3205),
('UY','Canelones','CA',3213),
('UY','Cerro Largo','CL',3211),
('UY','Colonia','CO',3208),
('UY','Durazno','DU',3209),
('UY','Flores','FS',3203),
('UY','Florida','FD',3217),
('UY','Lavalleja','LA',3215),
('UY','Maldonado','MA',3206),
('UY','Montevideo','MO',3218),
('UY','Paysandú','PA',3212),
('UY','Rivera','RV',3207),
('UY','Rocha','RO',3216),
('UY','Río Negro','RN',3210),
('UY','Salto','SA',3220),
('UY','San José','SJ',3204),
('UY','Soriano','SO',3219),
('UY','Tacuarembó','TA',3221),
('UY','Treinta y Tres','TT',3214),
('VE','Amazonas','Z',2044),
('VE','Anzoátegui','B',2050),
('VE','Apure','C',4856),
('VE','Aragua','D',2047),
('VE','Barinas','E',2049),
('VE','Bolívar','F',2039),
('VE','Carabobo','G',2040),
('VE','Cojedes','H',2034),
('VE','Delta Amacuro','Y',2051),
('VE','Dependencias Federales','W',2046),
('VE','Distrito Capital','A',4855),
('VE','Falcón','I',2035),
('VE','Guárico','J',2045),
('VE','La Guaira','X',2055),
('VE','Lara','K',2038),
('VE','Miranda','M',2037),
('VE','Monagas','N',2054),
('VE','Mérida','L',2053),
('VE','Nueva Esparta','O',2052),
('VE','Portuguesa','P',2036),
('VE','Sucre','R',2056),
('VE','Trujillo','T',2043),
('VE','Táchira','S',2048),
('VE','Yaracuy','U',2041),
('VE','Zulia','V',2042)
on conflict do nothing;

-- 5. Lugar de cada cuenta
alter table public.perfiles add column if not exists pais char(2) references public.paises(codigo);
alter table public.perfiles add column if not exists region_id int references public.regiones(id) on delete set null;
alter table public.perfiles add column if not exists localidad_id int references public.localidades(id) on delete set null;
update public.perfiles set pais = 'UY' where pais is null;
alter table public.perfiles alter column pais set default 'UY';
create index if not exists perfiles_lugar_idx on public.perfiles (pais, region_id, localidad_id);

-- La región tiene que ser del país y la localidad de la región (si no, quedan vacías)
create or replace function public._perfil_validar_lugar()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.region_id is not null and not exists (select 1 from public.regiones r where r.id = new.region_id and r.pais = new.pais) then
    new.region_id := null;
  end if;
  if new.localidad_id is not null and (new.region_id is null or not exists (
      select 1 from public.localidades l where l.id = new.localidad_id and l.region_id = new.region_id and l.estado <> 'rechazada')) then
    new.localidad_id := null;
  end if;
  return new;
end $$;
drop trigger if exists talisto_perfil_lugar on public.perfiles;
create trigger talisto_perfil_lugar
  before insert or update of pais, region_id, localidad_id on public.perfiles
  for each row execute function public._perfil_validar_lugar();

-- 6. Elegir o proponer una localidad
create or replace function public._localidad_resolver(p_region int, p_localidad int, p_nueva text, p_usuario uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v int;
  v_nombre text := nullif(regexp_replace(trim(coalesce(p_nueva, '')), '\s+', ' ', 'g'), '');
begin
  if p_localidad is not null then
    select l.id into v from public.localidades l
     where l.id = p_localidad and l.region_id = p_region and l.estado <> 'rechazada';
    if v is not null then return v; end if;
  end if;
  if v_nombre is null then return null; end if;
  if length(v_nombre) < 2 or length(v_nombre) > 80 then
    raise exception 'El nombre de la localidad tiene que tener entre 2 y 80 letras';
  end if;
  select l.id into v from public.localidades l
   where l.region_id = p_region and l.clave = public._clave_lugar(v_nombre) and l.estado <> 'rechazada';
  if v is not null then return v; end if;
  if exists (select 1 from public.localidades l where l.region_id = p_region and l.clave = public._clave_lugar(v_nombre)) then
    raise exception 'Esa localidad no se puede agregar: elegí una de la lista';
  end if;
  insert into public.localidades (region_id, nombre, estado, propuesta_por)
  values (p_region, v_nombre, 'pendiente', p_usuario)
  returning id into v;
  return v;
end $$;
revoke execute on function public._localidad_resolver(int, int, text, uuid) from public, anon, authenticated;

-- Buscar localidades de una región (para elegir al crear la cuenta)
create or replace function public.localidades_buscar(p_region int, p_texto text default '')
returns json language sql stable security definer set search_path = public as $$
  with q as (select public._clave_lugar(p_texto) c)
  select coalesce(json_agg(json_build_object('id', x.id, 'nombre', x.nombre, 'pendiente', x.estado = 'pendiente')
                           order by x.pref desc, x.poblacion desc nulls last, x.nombre), '[]'::json)
    from (select l.id, l.nombre, l.estado, l.poblacion, (l.clave like q.c || '%') as pref
            from public.localidades l, q
           where l.region_id = p_region
             and (l.estado = 'aprobada' or (l.estado = 'pendiente' and l.propuesta_por = auth.uid()))
             and (q.c = '' or l.clave like '%' || q.c || '%')
           order by (l.clave like q.c || '%') desc, l.poblacion desc nulls last, l.nombre
           limit 30) x;
$$;
grant execute on function public.localidades_buscar(int, text) to anon, authenticated;

-- 7. Al crear la cuenta: guarda también el lugar (si algo no cuadra, queda para completar después)
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m        jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_rol    text := coalesce(m->>'rol', 'cliente');
  v_nombre text := coalesce(m->>'nombre', '');
  v_pais   text;
  v_region int;
  v_loc    int;
begin
  if v_rol not in ('cliente','profesional') then v_rol := 'cliente'; end if;
  begin
    select p.codigo into v_pais from public.paises p where p.codigo = upper(m->>'pais') and p.activo;
    if v_pais is not null and coalesce(m->>'region_id', '') ~ '^\d+$' then
      select r.id into v_region from public.regiones r where r.id = (m->>'region_id')::int and r.pais = v_pais;
      if v_region is not null then
        v_loc := public._localidad_resolver(v_region,
                   case when coalesce(m->>'localidad_id', '') ~ '^\d+$' then (m->>'localidad_id')::int end,
                   m->>'localidad_nueva', new.id);
      end if;
    end if;
  exception when others then
    v_region := null; v_loc := null;
  end;
  insert into public.perfiles (id, rol, nombre, email, telefono, pais, region_id, localidad_id)
  values (new.id, v_rol, v_nombre, new.email, m->>'telefono', coalesce(v_pais, 'UY'), v_region, v_loc)
  on conflict (id) do nothing;
  if v_rol = 'profesional' then
    insert into public.profesionales (id, nombre_publico) values (new.id, v_nombre)
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

-- 8. Mi ubicación (ver y cambiar)
create or replace function public._ubicacion(p_usuario uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'pais', pa.codigo, 'pais_nombre', pa.nombre, 'bandera', pa.bandera,
    'nombre_region', pa.nombre_region, 'nombre_localidad', pa.nombre_localidad,
    'region_id', r.id, 'region', r.nombre,
    'localidad_id', l.id, 'localidad', l.nombre, 'localidad_pendiente', l.estado = 'pendiente')
    from public.perfiles pe
    left join public.paises pa on pa.codigo = pe.pais
    left join public.regiones r on r.id = pe.region_id
    left join public.localidades l on l.id = pe.localidad_id
   where pe.id = p_usuario;
$$;
revoke execute on function public._ubicacion(uuid) from public, anon, authenticated;

create or replace function public.mi_ubicacion()
returns json language sql stable security definer set search_path = public as $$
  select public._ubicacion(auth.uid());
$$;
grant execute on function public.mi_ubicacion() to authenticated;

create or replace function public.mi_ubicacion_guardar(p_pais text, p_region int, p_localidad int default null, p_localidad_nueva text default null)
returns json language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); pa public.paises; v_region int; v_loc int;
begin
  if u is null then raise exception 'Tenés que entrar a tu cuenta'; end if;
  select * into pa from public.paises where codigo = upper(p_pais);
  if pa.codigo is null or not pa.activo then raise exception 'TaListo! todavía no está disponible en ese país'; end if;
  select r.id into v_region from public.regiones r where r.id = p_region and r.pais = pa.codigo;
  if v_region is null then raise exception 'Elegí tu %', lower(pa.nombre_region); end if;
  v_loc := public._localidad_resolver(v_region, p_localidad, p_localidad_nueva, u);
  if v_loc is null then raise exception 'Elegí o escribí tu %', lower(pa.nombre_localidad); end if;
  update public.perfiles set pais = pa.codigo, region_id = v_region, localidad_id = v_loc where id = u;
  return public._ubicacion(u);
end $$;
grant execute on function public.mi_ubicacion_guardar(text, int, int, text) to authenticated;

-- 9. Administración
-- Localidades que propusieron los usuarios y esperan revisión
create or replace function public.admin_localidades_pendientes()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo el administrador'; end if;
  return (
    select coalesce(json_agg(json_build_object(
             'id', l.id, 'nombre', l.nombre, 'region_id', r.id, 'region', r.nombre,
             'pais', pa.codigo, 'pais_nombre', pa.nombre, 'bandera', pa.bandera, 'creado_en', l.creado_en,
             'propuesta_por', pe.nombre, 'email', pe.email,
             'cuentas', (select count(*) from public.perfiles x where x.localidad_id = l.id)) order by l.creado_en), '[]'::json)
      from public.localidades l
      join public.regiones r on r.id = l.region_id
      join public.paises pa on pa.codigo = r.pais
      left join public.perfiles pe on pe.id = l.propuesta_por
     where l.estado = 'pendiente');
end $$;
grant execute on function public.admin_localidades_pendientes() to authenticated;

-- aprobar (con otro nombre si hace falta), unir con una que ya existe o rechazar
create or replace function public.admin_localidad_resolver(p_id int, p_accion text, p_nombre text default null, p_unir_con int default null)
returns json language plpgsql security definer set search_path = public as $$
declare l public.localidades; v_nombre text := nullif(regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), '');
begin
  if not public.es_admin() then raise exception 'Solo el administrador'; end if;
  select * into l from public.localidades where id = p_id;
  if l.id is null then raise exception 'Esa localidad ya no existe'; end if;
  if p_accion = 'aprobar' then
    if v_nombre is not null and public._clave_lugar(v_nombre) <> l.clave then
      if exists (select 1 from public.localidades x where x.region_id = l.region_id and x.clave = public._clave_lugar(v_nombre) and x.id <> l.id) then
        raise exception 'Ya existe "%" en esa zona: usá Unir', v_nombre;
      end if;
    end if;
    update public.localidades set estado = 'aprobada', nombre = coalesce(v_nombre, nombre) where id = l.id;
  elsif p_accion = 'unir' then
    if not exists (select 1 from public.localidades x where x.id = p_unir_con and x.region_id = l.region_id and x.estado = 'aprobada' and x.id <> l.id) then
      raise exception 'Elegí una localidad aprobada de la misma zona';
    end if;
    update public.perfiles set localidad_id = p_unir_con where localidad_id = l.id;
    delete from public.localidades where id = l.id;
  elsif p_accion = 'rechazar' then
    update public.perfiles set localidad_id = null where localidad_id = l.id;
    update public.localidades set estado = 'rechazada' where id = l.id;
  else
    raise exception 'Acción desconocida';
  end if;
  return json_build_object('ok', true);
end $$;
grant execute on function public.admin_localidad_resolver(int, text, text, int) to authenticated;

-- Países: moneda, precios, nombres y activo
create or replace function public.admin_pais_guardar(p_codigo text, p jsonb)
returns public.paises language plpgsql security definer set search_path = public as $$
declare pa public.paises; k text; v jsonb; pr jsonb;
begin
  if not public.es_admin() then raise exception 'Solo el administrador'; end if;
  select * into pa from public.paises where codigo = upper(p_codigo);
  if pa.codigo is null then raise exception 'Ese país no existe'; end if;
  if p ? 'activo' and (p->>'activo')::boolean is distinct from pa.activo then
    if (p->>'activo')::boolean and pa.codigo <> 'UY' then
      raise exception 'Para abrir % falta conectar el cobro de ese país (Mercado Pago de %) y que Match cobre en su moneda', pa.nombre, pa.nombre;
    end if;
    if not (p->>'activo')::boolean and not exists (select 1 from public.paises x where x.activo and x.codigo <> pa.codigo) then
      raise exception 'Tiene que quedar al menos un país activo';
    end if;
  end if;
  if p ? 'precios' then
    pr := '{}'::jsonb;
    for k, v in select * from jsonb_each(coalesce(p->'precios', '{}'::jsonb)) loop
      if k not in ('visita_cliente','visita_profesional','urgencia_cliente','urgencia_profesional','plan_pro','plan_business') then continue; end if;
      if v is null or v = 'null'::jsonb or v #>> '{}' = '' then continue; end if;
      if (v #>> '{}') !~ '^\d+(\.\d{1,2})?$' then raise exception 'Los precios son números sin signo'; end if;
      pr := pr || jsonb_build_object(k, (v #>> '{}')::numeric);
    end loop;
    if (pr->>'visita_profesional')::numeric > (pr->>'visita_cliente')::numeric
       or (pr->>'urgencia_profesional')::numeric > (pr->>'urgencia_cliente')::numeric then
      raise exception 'Lo que recibe el técnico no puede ser más que lo que paga el cliente';
    end if;
  end if;
  update public.paises set
    activo           = coalesce((p->>'activo')::boolean, activo),
    nombre_region    = coalesce(nullif(trim(p->>'nombre_region'), ''), nombre_region),
    nombre_localidad = coalesce(nullif(trim(p->>'nombre_localidad'), ''), nombre_localidad),
    simbolo          = coalesce(nullif(trim(p->>'simbolo'), ''), simbolo),
    orden            = coalesce((p->>'orden')::smallint, orden),
    precios          = coalesce(pr, precios),
    actualizado_en   = now()
   where codigo = pa.codigo
  returning * into pa;
  return pa;
end $$;
grant execute on function public.admin_pais_guardar(text, jsonb) to authenticated;

-- Cuántas cuentas hay en cada zona (para planificar técnicos, proveedores y publicidad local)
create or replace function public.admin_cuentas_por_zona(p_pais text)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo el administrador'; end if;
  return (
    select coalesce(json_agg(json_build_object('region_id', z.region_id, 'region', z.region,
             'clientes', z.clientes, 'profesionales', z.profesionales, 'localidades', z.localidades)
             order by z.clientes + z.profesionales desc, z.region nulls last), '[]'::json)
      from (select r.id region_id, coalesce(r.nombre, 'Sin completar') region,
                   count(*) filter (where pe.rol = 'cliente') clientes,
                   count(*) filter (where pe.rol = 'profesional') profesionales,
                   count(distinct pe.localidad_id) localidades
              from public.perfiles pe
              left join public.regiones r on r.id = pe.region_id
             where pe.pais = upper(p_pais)
             group by r.id, r.nombre) z);
end $$;
grant execute on function public.admin_cuentas_por_zona(text) to authenticated;

revoke execute on function public.admin_localidades_pendientes(), public.admin_localidad_resolver(int, text, text, int),
  public.admin_pais_guardar(text, jsonb), public.admin_cuentas_por_zona(text), public.mi_ubicacion(),
  public.mi_ubicacion_guardar(text, int, int, text) from anon;

notify pgrst, 'reload schema';

-- =====================================================================
-- LISTO. Ahora corré 29_localidades_1.sql, 29_localidades_2.sql y 29_localidades_3.sql.
-- =====================================================================
