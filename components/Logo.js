export default function Logo({ grande = false }) {
  const tam = grande ? 48 : 34;
  return (
    <span className="inline-flex items-center gap-2.5">
      <img
        src="/logo.png"
        alt=""
        width={tam}
        height={tam}
        className="shrink-0 shadow-[0_6px_20px_rgb(23_107_168/0.35)]"
        style={{ width: tam, height: tam, borderRadius: tam * 0.22 }}
      />
      <span className={`${grande ? 'text-3xl' : 'text-lg'} font-extrabold tracking-tight text-tinta-100`}>
        Ta<span className="text-[#ec8328]">Listo!</span>
      </span>
    </span>
  );
}
