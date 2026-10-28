export default function Logo({ grande = false }) {
  const caja = grande ? 'h-12 w-12 rounded-2xl' : 'h-8 w-8 rounded-xl';
  const texto = grande ? 'text-3xl' : 'text-lg';
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className={`${caja} grid place-items-center bg-menta-500 text-navy-950 shadow-[0_6px_20px_rgb(44_199_155/0.35)]`}>
        <svg viewBox="0 0 24 24" className={grande ? 'h-7 w-7' : 'h-5 w-5'} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5 10 17 19 7" />
        </svg>
      </span>
      <span className={`${texto} font-extrabold tracking-tight text-tinta-100`}>
        Ta<span className="text-menta-400">Listo!</span>
      </span>
    </span>
  );
}
