/**
 * Единый фон для лендинга и публичного потока /entry:
 * текстура + анимированные градиенты + движущаяся сетка (без тяжёлых видео).
 */
export default function MarketingBackdrop() {
  return (
    <div className="marketing-backdrop-root pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <img
        src="/marketing/landing-ambient-light.png"
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-[0.14]"
      />
      <div className="marketing-backdrop-aurora" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(240,253,250,0.5),transparent_42%)]" />
      <div className="marketing-backdrop-grid" />
      <div className="marketing-backdrop-shine" />
    </div>
  );
}
